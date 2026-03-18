import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ branchId: string; month: string }> }
) {
  try {
    const decoded = await requireAdmin(request);
    const { branchId, month } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const snapshot = await adminDb
      .collection("branchExpenses")
      .where("branchId", "==", branchId)
      .where("month", "==", month)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: "Expense sheet not found" }, { status: 404 });
    }

    const doc = snapshot.docs[0];
    await doc.ref.update({
      status: "approved",
      approvedBy: decoded.uid,
      approvedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}
