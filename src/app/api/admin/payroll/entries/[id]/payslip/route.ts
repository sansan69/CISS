import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { generatePayslipPdf } from "@/lib/payroll/payslip";
import type { PayrollCycle, PayrollEntry } from "@/types/payroll";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const entryDoc = await adminDb.collection("payrollEntries").doc(id).get();
    if (!entryDoc.exists) {
      return NextResponse.json({ error: "Payroll entry not found" }, { status: 404 });
    }

    const entry = { id: entryDoc.id, ...entryDoc.data() } as PayrollEntry;
    const cycleDoc = await adminDb.collection("payrollCycles").doc(entry.cycleId).get();
    const cycle = cycleDoc.exists ? ({ id: cycleDoc.id, ...cycleDoc.data() } as PayrollCycle) : null;

    const pdfBytes = await generatePayslipPdf({ entry, cycle, companyName: "CISS Workforce" });
    const filename = `payslip-${entry.employeeCode || entry.employeeId}-${entry.period}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
