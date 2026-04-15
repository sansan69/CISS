import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
import { generatePayslipPdf } from "@/lib/payroll/payslip";
import type { PayrollCycle, PayrollEntry } from "@/types/payroll";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const guard = await requireGuard(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const entryDoc = await adminDb.collection("payrollEntries").doc(id).get();
    if (!entryDoc.exists) {
      return NextResponse.json({ error: "Payroll entry not found" }, { status: 404 });
    }

    const data = entryDoc.data() ?? {};
    if (data.employeeDocId !== guard.employeeDocId) {
      return unauthorizedResponse("Not authorized to view this payslip.");
    }

    const entry = { id: entryDoc.id, ...data } as PayrollEntry;
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
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return unauthorizedResponse(message);
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
