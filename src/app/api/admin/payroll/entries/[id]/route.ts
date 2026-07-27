import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
export const runtime = "nodejs";

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

    const entryRef = adminDb.collection("payrollEntries").doc(id);

    await adminDb.runTransaction(async (tx) => {
      const entryDoc = await tx.get(entryRef);
      if (!entryDoc.exists) {
        throw Object.assign(new Error("Entry not found"), { statusCode: 404 });
      }
      const existing = entryDoc.data() as {
        cycleId?: string;
        netPay?: number;
        earnings?: Record<string, unknown>;
        deductions?: Record<string, unknown>;
      };

      const updates: Record<string, unknown> = {
        status: "adjusted",
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (netPay !== undefined) updates.netPay = netPay;
      if (adminNotes !== undefined) updates.adminNotes = adminNotes;
      if (earnings !== undefined) {
        const existingEarnings = existing.earnings ?? {};
        updates.earnings = { ...existingEarnings, ...earnings };
      }
      if (deductions !== undefined) {
        const existingDeductions = existing.deductions ?? {};
        updates.deductions = { ...existingDeductions, ...deductions };
      }

      if (existing.cycleId) {
        const cycleEntriesSnap = await tx.get(
          adminDb.collection("payrollEntries").where("cycleId", "==", existing.cycleId),
        );
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

        tx.update(adminDb.collection("payrollCycles").doc(existing.cycleId), {
          ...totals,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      tx.update(entryRef, updates as FirebaseFirestore.UpdateData<Record<string, unknown>>);
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    const status = typeof (err as { statusCode?: unknown }).statusCode === "number"
      ? (err as { statusCode: number }).statusCode
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
