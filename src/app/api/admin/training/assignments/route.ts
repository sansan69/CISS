import { NextResponse } from "next/server";
import {
  verifyRequestAuth,
  requireAdminOrFieldOfficer,
  hasAdminAccess,
  hasFieldOfficerAccess,
  unauthorizedResponse,
} from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    const token = await verifyRequestAuth(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const url = new URL(request.url);
    const employeeId = url.searchParams.get("employeeId");
    const moduleId = url.searchParams.get("moduleId");

    let q = adminDb.collection("trainingAssignments").orderBy("assignedAt", "desc") as FirebaseFirestore.Query;
    if (employeeId) q = q.where("employeeId", "==", employeeId);
    if (moduleId) q = q.where("moduleId", "==", moduleId);

    const snapshot = await q.limit(500).get();
    let assignments = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string; district?: string }));

    if (!hasAdminAccess(token) && hasFieldOfficerAccess(token)) {
      const districts = Array.isArray(token.assignedDistricts) ? token.assignedDistricts : [];
      assignments = assignments.filter((a) => typeof a.district === "string" && districts.includes(a.district));
    }

    return NextResponse.json({ assignments });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdminOrFieldOfficer(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as {
      employeeIds?: string[];
      employeeId?: string;
      employeeName?: string;
      clientId?: string;
      clientName?: string;
      district?: string;
      moduleId?: string;
      moduleName?: string;
      moduleCategory?: string;
      dueDate?: string;
    };

    const employeeIds = body.employeeIds ?? (body.employeeId ? [body.employeeId] : []);
    if (!employeeIds.length || !body.moduleId) {
      return NextResponse.json({ error: "employeeIds and moduleId are required." }, { status: 400 });
    }

    const isFO = !hasAdminAccess(actor) && hasFieldOfficerAccess(actor);
    if (isFO) {
      const districts = Array.isArray(actor.assignedDistricts) ? actor.assignedDistricts : [];
      if (!body.district || !districts.includes(body.district)) {
        return NextResponse.json(
          { error: "Field officers can only assign training within their assigned districts." },
          { status: 403 },
        );
      }
    }

    const batch = adminDb.batch();
    const now = new Date();
    const role = isFO ? "fieldOfficer" : "admin";
    for (const eid of employeeIds) {
      const ref = adminDb.collection("trainingAssignments").doc();
      batch.set(ref, {
        employeeId: eid,
        employeeName: body.employeeName ?? "",
        clientId: body.clientId ?? "",
        clientName: body.clientName ?? "",
        district: body.district ?? "",
        moduleId: body.moduleId,
        moduleName: body.moduleName ?? "",
        moduleCategory: body.moduleCategory ?? "safety",
        assignedBy: actor.uid,
        assignedByRole: role,
        assignedAt: now,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        status: "assigned",
      });
    }
    await batch.commit();

    return NextResponse.json({ assigned: employeeIds.length });
  } catch (error: any) {
    const msg = error?.message || "Unauthorized";
    const status = msg.includes("required") ? 403 : 401;
    return unauthorizedResponse(msg, status);
  }
}
