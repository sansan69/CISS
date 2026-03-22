import { PDFDocument, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { PayrollCycle, PayrollEntry } from "@/types/payroll";

function drawLabelValue(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  fonts: { regular: Awaited<ReturnType<PDFDocument["embedFont"]>>; bold: Awaited<ReturnType<PDFDocument["embedFont"]>> },
) {
  page.drawText(label, {
    x,
    y,
    size: 10,
    font: fonts.regular,
    color: rgb(0.43, 0.48, 0.55),
  });
  page.drawText(value, {
    x,
    y: y - 14,
    size: 11,
    font: fonts.bold,
    color: rgb(0.09, 0.13, 0.19),
  });
}

function formatAmount(value: number) {
  return `Rs ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function generatePayslipPdf(args: {
  entry: PayrollEntry;
  cycle: PayrollCycle | null;
  companyName?: string;
}) {
  const { entry, cycle, companyName = "CISS Workforce" } = args;
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: 760, width: 595, height: 82, color: rgb(0.01, 0.3, 0.52) });
  page.drawText(companyName, { x: 36, y: 804, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Payslip", { x: 36, y: 780, size: 13, font: regular, color: rgb(0.95, 0.97, 0.99) });
  page.drawText(cycle?.period ?? entry.period, { x: 470, y: 792, size: 16, font: bold, color: rgb(1, 1, 1) });

  let cursorY = 728;
  drawLabelValue(page, "Employee", entry.employeeName, 36, cursorY, { regular, bold });
  drawLabelValue(page, "Code", entry.employeeCode || "NA", 220, cursorY, { regular, bold });
  drawLabelValue(page, "Client", entry.clientName || "NA", 360, cursorY, { regular, bold });
  cursorY -= 56;
  drawLabelValue(page, "District", entry.district || "NA", 36, cursorY, { regular, bold });
  drawLabelValue(page, "Present / Working", `${entry.presentDays}/${entry.workingDays}`, 220, cursorY, { regular, bold });
  drawLabelValue(page, "LOP Days", String(entry.lopDays), 360, cursorY, { regular, bold });

  cursorY -= 76;
  page.drawText("Earnings", { x: 36, y: cursorY, size: 14, font: bold, color: rgb(0.01, 0.3, 0.52) });
  page.drawText("Deductions", { x: 320, y: cursorY, size: 14, font: bold, color: rgb(0.01, 0.3, 0.52) });
  cursorY -= 24;

  const earningRows = [
    ["Basic", entry.earnings.basic],
    ["HRA", entry.earnings.hra],
    ["DA", entry.earnings.da],
    ["Conveyance", entry.earnings.conveyance],
    ["Special Allowance", entry.earnings.specialAllowance],
    ["Other Allowances", entry.earnings.otherAllowances],
    ["Overtime", entry.earnings.overtimeAmount],
    ["Gross Earnings", entry.earnings.grossEarnings],
  ] as const;

  const deductionRows = [
    ["EPF", entry.deductions.epfEmployee],
    ["ESIC", entry.deductions.esicEmployee],
    ["Professional Tax", entry.deductions.professionalTax],
    ["TDS", entry.deductions.tds],
    ["LOP Deduction", entry.deductions.lopDeduction],
    ["Other Deductions", entry.deductions.otherDeductions],
    ["Total Deductions", entry.deductions.totalDeductions],
  ] as const;

  const rowHeight = 24;
  for (let index = 0; index < Math.max(earningRows.length, deductionRows.length); index += 1) {
    const y = cursorY - index * rowHeight;
    const earning = earningRows[index];
    const deduction = deductionRows[index];

    if (earning) {
      page.drawText(earning[0], { x: 36, y, size: 10, font: regular, color: rgb(0.2, 0.24, 0.29) });
      page.drawText(formatAmount(earning[1]), { x: 200, y, size: 10, font: bold, color: rgb(0.09, 0.13, 0.19) });
    }
    if (deduction) {
      page.drawText(deduction[0], { x: 320, y, size: 10, font: regular, color: rgb(0.2, 0.24, 0.29) });
      page.drawText(formatAmount(deduction[1]), { x: 500, y, size: 10, font: bold, color: rgb(0.09, 0.13, 0.19) });
    }
  }

  const totalsY = cursorY - Math.max(earningRows.length, deductionRows.length) * rowHeight - 26;
  page.drawRectangle({ x: 36, y: totalsY - 16, width: 523, height: 60, color: rgb(0.95, 0.97, 0.99) });
  page.drawText("Net Pay", { x: 54, y: totalsY + 14, size: 12, font: regular, color: rgb(0.43, 0.48, 0.55) });
  page.drawText(formatAmount(entry.netPay), { x: 54, y: totalsY - 8, size: 22, font: bold, color: rgb(0.01, 0.3, 0.52) });

  page.drawText(
    `Employer Contributions: EPF ${formatAmount(entry.employerContributions.epfEmployer)}  |  ESIC ${formatAmount(entry.employerContributions.esicEmployer)}`,
    { x: 36, y: 118, size: 10, font: regular, color: rgb(0.35, 0.39, 0.45) },
  );
  page.drawText(
    entry.adminNotes?.trim() ? `Admin Note: ${entry.adminNotes}` : "Generated from CISS Workforce payroll engine.",
    { x: 36, y: 92, size: 10, font: regular, color: rgb(0.35, 0.39, 0.45) },
  );
  page.drawText("This is a system-generated payslip.", {
    x: 36,
    y: 68,
    size: 9,
    font: regular,
    color: rgb(0.55, 0.58, 0.63),
  });

  return pdfDoc.save();
}
