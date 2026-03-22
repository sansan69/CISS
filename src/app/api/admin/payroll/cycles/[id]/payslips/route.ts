import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const entriesSnap = await adminDb.collection("payrollEntries").where("cycleId", "==", id).get();
    if (entriesSnap.empty) {
      return NextResponse.json({ error: "No payroll entries found for this cycle." }, { status: 404 });
    }

    const batch = adminDb.batch();
    for (const doc of entriesSnap.docs) {
      batch.update(doc.ref, {
        payslipUrl: `/api/admin/payroll/entries/${doc.id}/payslip`,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    return NextResponse.json({ success: true, generatedCount: entriesSnap.size });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
