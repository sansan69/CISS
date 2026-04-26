import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export const runtime = "nodejs";

// POST /api/admin/work-orders/bulk-delete
// Body: { examName: string, examCode?: string }
export async function POST(request: NextRequest) {
  try {
    const adminUser = await requireAdmin(request);
    const body = await request.json();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const examName = body.examName;
    const examCode = body.examCode;
    if (!examName || typeof examName !== "string") {
      return NextResponse.json({ error: "examName is required" }, { status: 400 });
    }

    // Prefer deleting by examCode (stable key). Fall back to examName.
    let snapshot = null as any;
    if (examCode && typeof examCode === "string") {
      snapshot = await adminDb
        .collection("workOrders")
        .where("examCode", "==", examCode)
        .where("recordStatus", "==", "active")
        .get();
    }

    if (!snapshot || snapshot.empty) {
      snapshot = await adminDb
        .collection("workOrders")
        .where("examName", "==", examName)
        .where("recordStatus", "==", "active")
        .get();
    }

    if (snapshot.empty) {
      return NextResponse.json({ deleted: 0, message: "No active work orders found for this exam." });
    }

    const batch = adminDb.batch();
    let deletedCount = 0;

    snapshot.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
      batch.update(doc.ref, {
        recordStatus: "cancelled",
        cancelledByBulkDelete: true,
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: adminUser.uid,
      });
      deletedCount++;
    });

    await batch.commit();

    return NextResponse.json({
      deleted: deletedCount,
      examName,
      message: `Cancelled ${deletedCount} work order(s) for ${examName}.`,
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
