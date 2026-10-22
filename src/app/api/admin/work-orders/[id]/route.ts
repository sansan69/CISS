import { NextResponse } from "next/server";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  verifyRequestAuth,
  requireAdminOrFieldOfficer,
  requireAdmin,
  unauthorizedResponse,
  type AppDecodedToken,
} from "@/lib/server/auth";
import {
  buildServerCreateAudit,
  buildServerUpdateAudit,
} from "@/lib/server/audit";
import { cleanupOrphanWorkOrderImports } from "@/lib/server/work-order-import-cleanup";
import { canonicalizeDistrictList, districtMatches } from "@/lib/districts";
import { resolveDutySupervisor, recheckSupervisor, transactionSite, resolveDutySite, assertDistrict } from "@/lib/server/duties/scope";
import { requestId, version, documentId, receiptRef, fingerprint, replayReceipt, assertVersion, DutyError, dutyErrorResponse, hash, readJson } from "@/lib/server/duties/requests";
import { pickSameDateConflictCandidateIds, findRosterConflictGuard } from "@/lib/server/duties/roster-conflicts";
import { retryOnContention } from "@/lib/server/duties/retry";
import { buildExamRosterNotificationWrites, transactionNotificationReader, dispatchDutyNotifications } from "@/lib/server/duties/notifications";
import { employeeMatchesAnyDistrict } from "@/lib/employees/visibility";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";
export const runtime = "nodejs";

class WorkOrderAssignmentError extends Error {
  constructor(message: string, readonly status: number, readonly code: string = status === 403 ? "wrong_scope" : status === 404 ? "duty_not_found" : status === 400 ? "invalid_body" : "roster_conflict") {
    super(message);
  }
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeGender(value: unknown): "Male" | "Female" | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "male") return "Male";
  if (normalized === "female") return "Female";
  return "";
}

async function getAssignedDistricts(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
) {
  const { requireActiveFieldOfficerProfile } = await import("@/lib/server/linked-profiles");
  return (await requireActiveFieldOfficerProfile(adminDb, decoded)).assignedDistricts;
}

function getRequestedGuardIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new WorkOrderAssignmentError("assignedGuards must be an array.", 400);
  }
  const ids = value.map((guard) => {
    if (!guard || typeof guard !== "object") {
      throw new WorkOrderAssignmentError("Every assigned guard must contain a valid uid.", 400);
    }
    return documentId(normalizeText((guard as { uid?: unknown }).uid));
  });
  if (ids.some((id) => !id)) {
    throw new WorkOrderAssignmentError("Every assigned guard must contain a valid uid.", 400);
  }
  if (new Set(ids).size !== ids.length) {
    throw new WorkOrderAssignmentError("The same guard cannot be assigned more than once.", 400);
  }
  return ids;
}

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const supervisor=await resolveDutySupervisor(request);
    const {db:adminDb}=await import("@/lib/firebaseAdmin");
    const {id}=await params;
    documentId(id);
    const snapshot=await adminDb.collection("workOrders").doc(id).get();
    if(!snapshot.exists)throw new DutyError(404,"duty_not_found","Work order not found.");
    const data=snapshot.data()!;
    if(!supervisor.isAdmin) assertDistrict(supervisor,(await resolveDutySite(adminDb,normalizeText(data.siteId))).district);
    return NextResponse.json({id,...data});
  } catch(error) { return dutyErrorResponse(error); }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const decoded = await verifyRequestAuth(request,true);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;
    documentId(id);
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DutyError(400,"invalid_body","Invalid work-order body.");
    const supervisor = await resolveDutySupervisor(request);
    const isAdmin = supervisor.isAdmin;
    if (body.clientRequestId !== undefined) requestId(body.clientRequestId);
    if (body.expectedVersion !== undefined) version(body.expectedVersion);
    let notificationIds: string[] = [];

    if ("assignmentHistory" in body) {
      throw new DutyError(400,"invalid_body","assignmentHistory cannot be updated via this route.");
    }

    const validTopLevel = [
      "maleGuardsRequired",
      "femaleGuardsRequired",
      "totalManpower",
      "assignedGuards",
      "examName",
    ];
    if (!isAdmin && Object.keys(body).some((key) => !["assignedGuards", "clientRequestId", "expectedVersion"].includes(key))) {
      throw new DutyError(403,"wrong_role","Field officers can update guard assignments only.");
    }

    const filtered: Record<string, unknown> = {};
    for (const key of validTopLevel) {
      if (key in body) {
        filtered[key] = body[key];
      }
    }

    if ("maleGuardsRequired" in filtered || "femaleGuardsRequired" in filtered) {
      const male = Number(filtered.maleGuardsRequired ?? 0);
      const female = Number(filtered.femaleGuardsRequired ?? 0);
      filtered.maleGuardsRequired = male;
      filtered.femaleGuardsRequired = female;
      filtered.totalManpower = male + female;
    }

    if (Object.keys(filtered).length === 0) {
      throw new DutyError(400,"invalid_body","No valid fields to update.");
    }

    if ("assignedGuards" in filtered) {
      const requestedGuardIds = getRequestedGuardIds(filtered.assignedGuards);
      const assignedDistricts = supervisor.assignedDistricts;
      const receipt = body.clientRequestId ? receiptRef(adminDb,"exam_roster",decoded.uid,id,body.clientRequestId) : null;
      const payloadFingerprint = fingerprint(body);
      const eventRef = adminDb.collection("workOrderAssignmentEvents").doc();

      // Lock contention is transient: retry instead of failing the save.
      notificationIds = await retryOnContention(() => adminDb.runTransaction(async (transaction) => {
        const currentSupervisor = await recheckSupervisor(transaction, supervisor);
        const workOrderRef = adminDb.collection("workOrders").doc(id);
        const workOrderSnapshot = await transaction.get(workOrderRef);
        if (!workOrderSnapshot.exists) {
          throw new WorkOrderAssignmentError("Work order not found.", 404);
        }
        const workOrder = workOrderSnapshot.data() ?? {};
        const site = await transactionSite(transaction, normalizeText(workOrder.siteId));
        const district = site.district;
        assertDistrict(currentSupervisor, district);
        if (!isOperationalWorkOrderClientName(normalizeText(workOrder.clientName))) {
          throw new WorkOrderAssignmentError("Only TCS ad-hoc work orders can be assigned here.", 400);
        }
        if (normalizeText(workOrder.recordStatus || "active").toLowerCase() !== "active") {
          throw new WorkOrderAssignmentError("This work order is no longer active.", 409, "duty_cancelled");
        }
        if (receipt) {
          const replay = replayReceipt(await transaction.get(receipt), payloadFingerprint);
          if (replay) return replay.eventIds ?? [];
        }
        if (body.expectedVersion !== undefined) assertVersion(body.expectedVersion,Number(workOrder.assignmentVersion ?? 0),{assignmentVersion:Number(workOrder.assignmentVersion ?? 0)});
        if (
          !isAdmin &&
          (currentSupervisor.assignedDistricts.length === 0 ||
            !currentSupervisor.assignedDistricts.some((assigned) => districtMatches(assigned, district)))
        ) {
          throw new WorkOrderAssignmentError(
            "This work order is outside your assigned districts.",
            403,
          );
        }

        const employeeRefs = requestedGuardIds.map((guardId) =>
          adminDb.collection("employees").doc(guardId),
        );
        const employeeSnapshots =
          employeeRefs.length > 0 ? await transaction.getAll(...employeeRefs) : [];
        const canonicalGuards = employeeSnapshots.map((employeeSnapshot) => {
          if (!employeeSnapshot.exists) {
            throw new WorkOrderAssignmentError("One or more selected guards no longer exist.", 409);
          }
          const employee = employeeSnapshot.data() ?? {};
          if (employee.active === false || employee.deprovisioned === true || normalizeText(employee.status || "active").toLowerCase() !== "active") {
            throw new WorkOrderAssignmentError(
              `${normalizeText(employee.fullName || employee.employeeId || "A selected guard")} is not active.`,
              409,
            );
          }
          if (district && !employeeMatchesAnyDistrict(employee, [district])) {
            throw new WorkOrderAssignmentError(
              `${normalizeText(employee.fullName || employee.employeeId || "A selected guard")} is outside the work-order district.`,
              409,
            );
          }
          const gender = normalizeGender(employee.gender);
          if (!gender) {
            throw new WorkOrderAssignmentError(
              `${normalizeText(employee.fullName || employee.employeeId || "A selected guard")} needs a Male or Female gender value before assignment.`,
              409,
            );
          }
          return {
            uid: employeeSnapshot.id,
            name: normalizeText(employee.fullName || employee.name || "Guard"),
            employeeId: normalizeText(employee.employeeId),
            gender,
          };
        });

        const maleRequired = Math.max(0, Number(workOrder.maleGuardsRequired ?? 0));
        const femaleRequired = Math.max(0, Number(workOrder.femaleGuardsRequired ?? 0));
        const maleAssigned = canonicalGuards.filter((guard) => guard.gender === "Male").length;
        const femaleAssigned = canonicalGuards.filter((guard) => guard.gender === "Female").length;
        if (requestedGuardIds.length > 0 && workOrder.date) {
          // A guard may hold one duty per date. Read the day's duties as a plain
          // query and re-read only the ones that already mention these guards:
          // a transactional query read would lock every duty on the date and make
          // simultaneous saves in other centres abort each other.
          const sameDateSnapshot = await adminDb
            .collection("workOrders")
            .where("date", "==", workOrder.date)
            .get();
          const conflictRefs = pickSameDateConflictCandidateIds(
            sameDateSnapshot.docs,
            id,
            canonicalGuards,
          ).map((conflictId) => adminDb.collection("workOrders").doc(conflictId));
          if (conflictRefs.length > 0) {
            const conflictedDuties = await transaction.getAll(...conflictRefs);
            for (const otherDoc of conflictedDuties) {
              if (otherDoc.id === id) continue;
              const other = otherDoc.data() ?? {};
              if (normalizeText(other.recordStatus || "active").toLowerCase() !== "active") continue;
              const conflictingGuard = findRosterConflictGuard(other.assignedGuards, canonicalGuards);
              if (conflictingGuard) {
                throw new WorkOrderAssignmentError(
                  `${conflictingGuard.name} is already assigned to ${normalizeText(other.siteName || "another centre")} on this date.`,
                  409,
                );
              }
            }
          }
        }

        const previousGuards = Array.isArray(workOrder.assignedGuards)
          ? workOrder.assignedGuards
          : [];
        const sameRoster = hash(previousGuards.slice().sort((a: any,b: any)=>String(a.uid).localeCompare(String(b.uid)))) === hash(canonicalGuards.slice().sort((a,b)=>a.uid.localeCompare(b.uid)));
        if (sameRoster) {
          if (receipt) transaction.create(receipt,{fingerprint:payloadFingerprint,eventIds:[],createdAt:new Date()});
          return [];
        }
        // Keep removed membership in this work order's own authoritative data so a
        // removed guard's own cancelled duty stays visible; reassignment clears it.
        const assignedGuardIds = new Set(canonicalGuards.map((guard) => guard.uid));
        const cancelledGuards = new Map<string, unknown>();
        const cancelledRoster = Array.isArray(workOrder.cancelledAssignedGuards)
          ? workOrder.cancelledAssignedGuards
          : [];
        for (const guard of [...cancelledRoster, ...previousGuards]) {
          const uid =
            guard && typeof guard === "object"
              ? normalizeText((guard as { uid?: unknown }).uid)
              : normalizeText(guard);
          if (!uid || assignedGuardIds.has(uid)) continue;
          cancelledGuards.set(uid, guard && typeof guard === "object" ? guard : { uid });
        }
        const cancelledAssignedGuards = [...cancelledGuards.values()];
        const assignmentVersion = Number(workOrder.assignmentVersion ?? 0) + 1;
        const notifications = await buildExamRosterNotificationWrites(transactionNotificationReader(transaction),id,{...workOrder,district},{...workOrder,district,assignedGuards:canonicalGuards},assignmentVersion);
        transaction.update(workOrderRef, {
          assignedGuards: canonicalGuards,
          cancelledAssignedGuards,
          assignmentVersion,
          assignmentReviewRequired: false,
          assignmentStatus:
            maleAssigned >= maleRequired && femaleAssigned >= femaleRequired
              ? "ready"
              : canonicalGuards.length === 0
                ? "unassigned"
                : "partial",
          ...buildServerUpdateAudit({
            uid: decoded.uid,
            email: decoded.email,
          }),
        });
        transaction.set(eventRef, {
          id: eventRef.id,
          workOrderId: id,
          siteId: normalizeText(workOrder.siteId),
          siteName: normalizeText(workOrder.siteName),
          district,
          examCode: normalizeText(workOrder.examCode),
          assignmentVersion,
          previousGuardIds: previousGuards
            .map((guard) =>
              guard && typeof guard === "object"
                ? normalizeText((guard as { uid?: unknown }).uid)
                : normalizeText(guard),
            )
            .filter(Boolean),
          assignedGuardIds: canonicalGuards.map((guard) => guard.uid),
          ...buildServerCreateAudit({
            uid: decoded.uid,
            email: decoded.email,
          }),
        });
        for (const notification of notifications) transaction.create(notification.ref,notification.data);
        if (receipt) transaction.create(receipt,{fingerprint:payloadFingerprint,eventIds:notifications.map(n=>n.ref.id),createdAt:new Date()});
        return notifications.map(n=>n.ref.id);
      }, { maxAttempts: 5 }));
    } else {
      notificationIds = await adminDb.runTransaction(async (transaction) => {
        const ref = adminDb.collection("workOrders").doc(id);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new DutyError(404,"duty_not_found","Work order not found.");
        const previous = snapshot.data()!;
        const assignmentVersion = Number(previous.assignmentVersion ?? 0) + 1;
        const notifications = await buildExamRosterNotificationWrites(transactionNotificationReader(transaction),id,previous,{...previous,...filtered},assignmentVersion);
        transaction.update(ref,{...filtered,assignmentVersion,...buildServerUpdateAudit({uid:decoded.uid,email:decoded.email})});
        for (const notification of notifications) transaction.create(notification.ref,notification.data);
        return notifications.map(n=>n.ref.id);
      });
    }

    await dispatchDutyNotifications(notificationIds);
    return NextResponse.json({ id });
  } catch (error: any) {
    if (error instanceof WorkOrderAssignmentError) return NextResponse.json({error:error.message,code:error.code},{status:error.status});
    return dutyErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;
    const workOrderRef = adminDb.collection("workOrders").doc(id);
    const snapshot = await workOrderRef.get();
    if (!snapshot.exists) {
      return NextResponse.json({ ok: true, deleted: false, importsDeleted: 0 });
    }

    const deletedWorkOrder = snapshot.data() ?? {};
    const todosSnap = await adminDb
      .collection("workOrderTodos")
      .where("workOrderId", "==", id)
      .get();
    const batch = adminDb.batch();
    batch.delete(workOrderRef);
    todosSnap.docs.forEach((todoDoc) => batch.delete(todoDoc.ref));
    await batch.commit();
    const importsDeleted = await cleanupOrphanWorkOrderImports(adminDb, [deletedWorkOrder]);

    return NextResponse.json({
      ok: true,
      deleted: true,
      importsDeleted,
      todosDeleted: todosSnap.size,
    });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    if (error?.message?.includes("Missing bearer") || error?.message?.includes("token")) {
      return unauthorizedResponse(error.message, 401);
    }
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
