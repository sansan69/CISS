import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { cleanupOrphanWorkOrderImports } from "@/lib/server/work-order-import-cleanup";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";

export const runtime = "nodejs";

// POST /api/admin/work-orders/bulk-delete
// Body: { examName: string, examCode?: string } or { workOrderIds: string[] }
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    if (Array.isArray(body.workOrderIds)) {
      const ids: string[] = Array.from(
        new Set(
          body.workOrderIds
            .filter((id: unknown): id is string => typeof id === "string")
            .map((id: string) => id.trim())
            .filter(Boolean),
        ),
      );
      if (ids.length === 0) {
        return NextResponse.json({ error: "workOrderIds must include at least one id." }, { status: 400 });
      }

      const deletedWorkOrders: Array<Record<string, unknown>> = [];
      let batch = adminDb.batch();
      let operationCount = 0;
      for (const id of ids) {
        const ref = adminDb.collection("workOrders").doc(id);
        const snapshot = await ref.get();
        if (!snapshot.exists) {
          continue;
        }
        deletedWorkOrders.push(snapshot.data() ?? {});
        batch.delete(ref);
        operationCount += 1;
        if (operationCount >= 450) {
          await batch.commit();
          batch = adminDb.batch();
          operationCount = 0;
        }
      }
      if (operationCount > 0) {
        await batch.commit();
      }

      const importsDeleted = await cleanupOrphanWorkOrderImports(adminDb, deletedWorkOrders);

      return NextResponse.json({
        deleted: deletedWorkOrders.length,
        importsDeleted,
        message: `Deleted ${deletedWorkOrders.length} work order${deletedWorkOrders.length === 1 ? "" : "s"}.`,
      });
    }

    const examName = body.examName;
    const examCode = body.examCode;
    if (!examName || typeof examName !== "string") {
      return NextResponse.json({ error: "examName is required" }, { status: 400 });
    }

    const workOrderRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    const importRefs = new Map<string, FirebaseFirestore.DocumentReference>();

    if (examCode && typeof examCode === "string") {
      const workOrdersByCode = await adminDb
        .collection("workOrders")
        .where("examCode", "==", examCode)
        .get();
      workOrdersByCode.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        const data = doc.data();
        if (isOperationalWorkOrderClientName(typeof data.clientName === "string" ? data.clientName : "")) {
          workOrderRefs.set(doc.id, doc.ref);
        }
      });

      const importsByCode = await adminDb
        .collection("workOrderImports")
        .where("examCode", "==", examCode)
        .get();
      importsByCode.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        importRefs.set(doc.id, doc.ref);
      });
    }

    const workOrdersByName = await adminDb
      .collection("workOrders")
      .where("examName", "==", examName)
      .get();
    workOrdersByName.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
      const data = doc.data();
      if (isOperationalWorkOrderClientName(typeof data.clientName === "string" ? data.clientName : "")) {
        workOrderRefs.set(doc.id, doc.ref);
      }
    });

    const importsByName = await adminDb
      .collection("workOrderImports")
      .where("examName", "==", examName)
      .get();
    importsByName.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
      importRefs.set(doc.id, doc.ref);
    });

    if (workOrderRefs.size === 0 && importRefs.size === 0) {
      return NextResponse.json({ deleted: 0, importsDeleted: 0, message: "No work orders found for this exam." });
    }

    let batch = adminDb.batch();
    let operationCount = 0;
    const commitIfNeeded = async () => {
      if (operationCount >= 450) {
        await batch.commit();
        batch = adminDb.batch();
        operationCount = 0;
      }
    };

    for (const ref of workOrderRefs.values()) {
      batch.delete(ref);
      operationCount += 1;
      await commitIfNeeded();
    }

    for (const ref of importRefs.values()) {
      batch.delete(ref);
      operationCount += 1;
      await commitIfNeeded();
    }

    if (operationCount > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      deleted: workOrderRefs.size,
      importsDeleted: importRefs.size,
      examName,
      message: `Deleted ${workOrderRefs.size} work order(s) and ${importRefs.size} import record(s) for ${examName}.`,
    });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    return NextResponse.json(
      { error: error?.message || "Bulk delete failed" },
      { status: 500 }
    );
  }
}
