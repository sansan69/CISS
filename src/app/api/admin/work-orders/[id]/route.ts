import { NextResponse } from "next/server";
import { verifyRequestAuth, requireAdminOrFieldOfficer, requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerUpdateAudit } from "@/lib/server/audit";
import { cleanupOrphanWorkOrderImports } from "@/lib/server/work-order-import-cleanup";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = requireAdminOrFieldOfficer(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;
    const body = await request.json();

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

    const updateData: Record<string, unknown> = {
      ...filtered,
      ...buildServerUpdateAudit({
        uid: adminUser.uid,
        email: adminUser.email,
      }),
    };

    await adminDb.collection("workOrders").doc(id).update(updateData);

    return NextResponse.json({ id });
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
    await workOrderRef.delete();
    const importsDeleted = await cleanupOrphanWorkOrderImports(adminDb, [deletedWorkOrder]);

    return NextResponse.json({ ok: true, deleted: true, importsDeleted });
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
