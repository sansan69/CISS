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
    const existing = entryDoc.data() as { cycleId?: string; netPay?: number };

    const updates: Record<string, unknown> = {
      status: "adjusted",
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (netPay !== undefined) updates.netPay = netPay;
    if (adminNotes !== undefined) updates.adminNotes = adminNotes;
    if (earnings !== undefined) updates.earnings = earnings;
    if (deductions !== undefined) updates.deductions = deductions;

    await adminDb.collection("payrollEntries").doc(id).update(updates);

    if (existing.cycleId) {
      const cycleEntriesSnap = await adminDb
        .collection("payrollEntries")
        .where("cycleId", "==", existing.cycleId)
        .get();

      const totals = cycleEntriesSnap.docs.reduce(
        (acc, doc) => {
          const data = doc.id === id ? { ...doc.data(), ...updates } : doc.data();
          acc.totalGross += Number(data.earnings?.grossEarnings ?? 0);
          acc.totalNetPay += Number(data.netPay ?? 0);
          acc.totalEPF += Number(data.deductions?.epfEmployee ?? 0);
          acc.totalESIC += Number(data.deductions?.esicEmployee ?? 0);
          acc.totalPT += Number(data.deductions?.professionalTax ?? 0);
          acc.totalTDS += Number(data.deductions?.tds ?? 0);
          return acc;
        },
        { totalGross: 0, totalNetPay: 0, totalEPF: 0, totalESIC: 0, totalPT: 0, totalTDS: 0 },
      );

      await adminDb.collection("payrollCycles").doc(existing.cycleId).update({
        ...totals,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
