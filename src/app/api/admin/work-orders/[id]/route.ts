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
import { employeeMatchesAnyDistrict } from "@/lib/employees/visibility";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";
import { isAssignedGuardMatch } from "@/lib/work-orders/assignment-match";
export const runtime = "nodejs";

class WorkOrderAssignmentError extends Error {
  constructor(message: string, readonly status: number) {
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
  const snapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(1)
    .get();
  if (!snapshot.empty) {
    const districts = snapshot.docs[0].data().assignedDistricts;
    if (Array.isArray(districts)) {
      return canonicalizeDistrictList(
        districts.filter((district): district is string => typeof district === "string"),
      );
    }
  }
  return canonicalizeDistrictList(
    Array.isArray(decoded.assignedDistricts)
      ? decoded.assignedDistricts.filter((district): district is string => typeof district === "string")
      : [],
  );
}

function getRequestedGuardIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new WorkOrderAssignmentError("assignedGuards must be an array.", 400);
  }
  const ids = value.map((guard) => {
    if (!guard || typeof guard !== "object") {
      throw new WorkOrderAssignmentError("Every assigned guard must contain a valid uid.", 400);
    }
    return normalizeText((guard as { uid?: unknown }).uid);
  });
  if (ids.some((id) => !id)) {
    throw new WorkOrderAssignmentError("Every assigned guard must contain a valid uid.", 400);
  }
  if (new Set(ids).size !== ids.length) {
    throw new WorkOrderAssignmentError("The same guard cannot be assigned more than once.", 400);
  }
  return ids;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const decoded = requireAdminOrFieldOfficer(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;

    const snapshot = await adminDb.collection("workOrders").doc(id).get();
    if (!snapshot.exists) {
      return NextResponse.json({ error: "Work order not found" }, { status: 404 });
    }
    const data = snapshot.data() ?? {};
    if (hasFieldOfficerAccess(decoded)) {
      const assignedDistricts = await getAssignedDistricts(adminDb, decoded);
      const district = normalizeText(data.district);
      if (
        assignedDistricts.length === 0 ||
        !assignedDistricts.some((assigned) => districtMatches(assigned, district))
      ) {
        return unauthorizedResponse("This work order is outside your assigned districts.", 403);
      }
    }

    return NextResponse.json({ id, ...data });
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const decoded = requireAdminOrFieldOfficer(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;
    const body = await request.json();
    const isAdmin = hasAdminAccess(decoded);

    if ("assignmentHistory" in body) {
      return NextResponse.json(
        { error: "assignmentHistory cannot be updated via this route." },
        { status: 400 }
      );
    }

    const validTopLevel = [
      "maleGuardsRequired",
      "femaleGuardsRequired",
      "totalManpower",
      "assignedGuards",
      "examName",
    ];
    if (!isAdmin && Object.keys(body).some((key) => key !== "assignedGuards")) {
      return unauthorizedResponse("Field officers can update guard assignments only.", 403);
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
      return NextResponse.json(
        { error: "No valid fields to update." },
        { status: 400 }
      );
    }

    if ("assignedGuards" in filtered) {
      const requestedGuardIds = getRequestedGuardIds(filtered.assignedGuards);
      const assignedDistricts = isAdmin ? [] : await getAssignedDistricts(adminDb, decoded);
      const eventRef = adminDb.collection("workOrderAssignmentEvents").doc();

      await adminDb.runTransaction(async (transaction) => {
        const workOrderRef = adminDb.collection("workOrders").doc(id);
        const workOrderSnapshot = await transaction.get(workOrderRef);
        if (!workOrderSnapshot.exists) {
          throw new WorkOrderAssignmentError("Work order not found.", 404);
        }
        const workOrder = workOrderSnapshot.data() ?? {};
        const district = normalizeText(workOrder.district);
        if (!isOperationalWorkOrderClientName(normalizeText(workOrder.clientName))) {
          throw new WorkOrderAssignmentError("Only TCS ad-hoc work orders can be assigned here.", 400);
        }
        if (normalizeText(workOrder.recordStatus || "active").toLowerCase() !== "active") {
          throw new WorkOrderAssignmentError("This work order is no longer active.", 409);
        }
        if (
          !isAdmin &&
          (assignedDistricts.length === 0 ||
            !assignedDistricts.some((assigned) => districtMatches(assigned, district)))
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
          if (normalizeText(employee.status || "active").toLowerCase() !== "active") {
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
          const sameDateSnapshot = await transaction.get(
            adminDb.collection("workOrders").where("date", "==", workOrder.date),
          );
          for (const otherDoc of sameDateSnapshot.docs) {
            if (otherDoc.id === id) continue;
            const other = otherDoc.data();
            if (normalizeText(other.recordStatus || "active").toLowerCase() !== "active") continue;
            const conflictingGuard = canonicalGuards.find((guard) =>
              isAssignedGuardMatch(other.assignedGuards, guard.uid, guard.employeeId),
            );
            if (conflictingGuard) {
              throw new WorkOrderAssignmentError(
                `${conflictingGuard.name} is already assigned to ${normalizeText(other.siteName || "another centre")} on this date.`,
                409,
              );
            }
          }
        }

        const previousGuards = Array.isArray(workOrder.assignedGuards)
          ? workOrder.assignedGuards
          : [];
        const assignmentVersion = Number(workOrder.assignmentVersion ?? 0) + 1;
        transaction.update(workOrderRef, {
          assignedGuards: canonicalGuards,
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
      });
    } else {
      await adminDb.collection("workOrders").doc(id).update({
        ...filtered,
        ...buildServerUpdateAudit({
          uid: decoded.uid,
          email: decoded.email,
        }),
      });
    }

    return NextResponse.json({ id });
  } catch (error: any) {
    if (error instanceof WorkOrderAssignmentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    if (error?.message?.includes("Missing bearer") || error?.message?.includes("token")) {
      return unauthorizedResponse(error.message, 401);
    }
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
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
