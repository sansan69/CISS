import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import type { PayrollEntry } from "@/types/payroll";

function formatLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const cycleDoc = await adminDb.collection("payrollCycles").doc(id).get();
    if (!cycleDoc.exists) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
    }

    const cycleData = cycleDoc.data() as { period?: string } | undefined;
    const cyclePeriod = cycleData?.period || "payroll";

    const entriesSnap = await adminDb
      .collection("payrollEntries")
      .where("cycleId", "==", id)
      .get();

    const entries = entriesSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as PayrollEntry)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    const breakdownKeys = Array.from(
      entries.reduce((set, entry) => {
        Object.keys(entry.earnings.componentBreakdown ?? {}).forEach((key) => set.add(key));
        return set;
      }, new Set<string>()),
    );

    const fixedHeaders = [
      "Employee Name",
      "Employee Code",
      "Client",
      "District",
      "Present Days",
      "Payable Days",
      "Working Days",
      "Gross Earnings",
    ];
    const componentHeaders = breakdownKeys.map((key) => formatLabel(key));
    const deductionHeaders = [
      "EPF Employee",
      "ESIC Employee",
      "Professional Tax",
      "TDS",
      "Other Deductions",
      "Total Deductions",
      "EPF Employer",
      "ESIC Employer",
      "Net Pay",
      "Status",
      "Notes",
    ];

    const rows = entries.map((entry) => [
      entry.employeeName,
      entry.employeeCode,
      entry.clientName,
      entry.district,
      entry.presentDays,
      entry.payableDays ?? entry.presentDays,
      entry.workingDays,
      entry.earnings.grossEarnings,
      ...breakdownKeys.map((key) => entry.earnings.componentBreakdown?.[key] ?? 0),
      entry.deductions.epfEmployee,
      entry.deductions.esicEmployee,
      entry.deductions.professionalTax,
      entry.deductions.tds,
      entry.deductions.otherDeductions,
      entry.deductions.totalDeductions,
      entry.employerContributions.epfEmployer,
      entry.employerContributions.esicEmployer,
      entry.netPay,
      entry.status,
      entry.adminNotes ?? "",
    ]);

    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      [...fixedHeaders, ...componentHeaders, ...deductionHeaders],
      ...rows,
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Payroll");

    const arrayBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    return new NextResponse(Buffer.from(arrayBuffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=\"CISS_Payroll_${cyclePeriod}.xlsx\"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to export payroll worksheet.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
