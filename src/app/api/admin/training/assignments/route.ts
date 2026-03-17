import { NextResponse } from "next/server";
import { requireAdmin, verifyRequestAuth, unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await verifyRequestAuth(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const url = new URL(request.url);
    const employeeId = url.searchParams.get("employeeId");
    const moduleId = url.searchParams.get("moduleId");

    let q = adminDb.collection("trainingAssignments").orderBy("assignedAt", "desc") as FirebaseFirestore.Query;
    if (employeeId) q = q.where("employeeId", "==", employeeId);
    if (moduleId) q = q.where("moduleId", "==", moduleId);

    const snapshot = await q.limit(200).get();
    const assignments = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ assignments });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
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

    const batch = adminDb.batch();
    const now = new Date();
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
        assignedBy: adminUser.uid,
        assignedAt: now,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        status: "assigned",
      });
    }
    await batch.commit();

    return NextResponse.json({ assigned: employeeIds.length });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
