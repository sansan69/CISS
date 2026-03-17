import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const { netPay, adminNotes, earnings, deductions } = body;

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const entryDoc = await adminDb.collection("payrollEntries").doc(id).get();
    if (!entryDoc.exists) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {
      status: "adjusted",
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (netPay !== undefined) updates.netPay = netPay;
    if (adminNotes !== undefined) updates.adminNotes = adminNotes;
    if (earnings !== undefined) updates.earnings = earnings;
    if (deductions !== undefined) updates.deductions = deductions;

    await adminDb.collection("payrollEntries").doc(id).update(updates);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
