import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { calculateEPF, calculateESIC, calculatePT, calculateTDS, calculateLOP, round2 } from "@/lib/payroll/calculate";
import { aggregateAttendance } from "@/lib/payroll/attendance-aggregator";

const KERALA_DEFAULTS = {
  epf: {
    employeeRate: 0.12,
    employerEpsRate: 0.0833,
    employerEpfRate: 0.0367,
    wageCeiling: 15000,
    maxEmployerContribution: 1800,
  },
  esic: {
    employeeRate: 0.0075,
    employerRate: 0.0325,
    grossWageCeiling: 21000,
  },
  professionalTax: {
    state: "Kerala",
    slabs: [
      { upTo: 11999, monthly: 0 },
      { upTo: 17999, monthly: 120 },
      { upTo: 29999, monthly: 180 },
      { upTo: null, monthly: 200 },
    ],
  },
  tds: {
    regime: "new" as const,
    standardDeduction: 75000,
    slabs: [
      { upTo: 300000, rate: 0 },
      { upTo: 700000, rate: 0.05 },
      { upTo: 1000000, rate: 0.10 },
      { upTo: 1200000, rate: 0.15 },
      { upTo: 1500000, rate: 0.20 },
      { upTo: null, rate: 0.30 },
    ],
  },
  bonus: { rate: 0.0833, minimumWageBase: 7000 },
  gratuity: { rate: 0.0481, minimumYearsForPayout: 5 },
};

export async function POST(request: Request) {
  try {
    const decoded = await requireAdmin(request);
    const body = await request.json();
    const { period, clientId } = body as { period: string; clientId?: string };

    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json({ error: "Invalid period. Use YYYY-MM format." }, { status: 400 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    // Check if cycle already exists
    const existingCycles = await adminDb
      .collection("payrollCycles")
      .where("period", "==", period)
      .get();

    if (!existingCycles.empty && !clientId) {
      return NextResponse.json(
        { error: `Payroll cycle for ${period} already exists.`, cycleId: existingCycles.docs[0].id },
        { status: 409 }
      );
    }

    const [yearStr, monthStr] = period.split("-");
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);

    // Create cycle doc
    const cycleRef = await adminDb.collection("payrollCycles").add({
      period,
      month,
      year,
      status: "processing",
      totalEmployees: 0,
      totalGross: 0,
      totalNetPay: 0,
      totalEPF: 0,
      totalESIC: 0,
      totalPT: 0,
      totalTDS: 0,
      processedBy: decoded.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    const cycleId = cycleRef.id;

    // Fetch employees
    let empQuery = adminDb.collection("employees").where("status", "==", "Active");
    if (clientId) {
      empQuery = adminDb
        .collection("employees")
        .where("status", "==", "Active")
        .where("clientId", "==", clientId) as typeof empQuery;
    }

    const empSnap = await empQuery.limit(500).get();

    // Fetch compliance settings
    const compDoc = await adminDb.collection("complianceSettings").doc("global").get();
    const compliance = compDoc.exists ? (compDoc.data() as typeof KERALA_DEFAULTS) : KERALA_DEFAULTS;

    let totalEmployees = 0;
    let totalGross = 0;
    let totalNetPay = 0;
    let totalEPF = 0;
    let totalESIC = 0;
    let totalPT = 0;
    let totalTDS = 0;

    // Process in batches of 500
    const BATCH_SIZE = 499;
    let batch = adminDb.batch();
    let batchCount = 0;

    for (const empDoc of empSnap.docs) {
      const emp = empDoc.data();

      // Fetch salary assignment
      const salaryDoc = await adminDb.collection("employeeSalaries").doc(empDoc.id).get();
      if (!salaryDoc.exists) continue; // skip employees with no salary

      const salary = salaryDoc.data()!;
      const grossMonthly: number = salary.grossMonthly ?? 0;

      // Aggregate attendance
      const attendance = await aggregateAttendance(empDoc.id, period, adminDb);

      // Calculate LOP deduction
      const lopDeduction = calculateLOP(grossMonthly, attendance.workingDays, attendance.lopDays);
      const effectiveGross = round2(grossMonthly - lopDeduction);

      // Calculate EPF (on basic salary — approximate as 50% of gross if no component data)
      const epfBase = round2(effectiveGross * 0.5);
      const epfResult = calculateEPF(epfBase, compliance.epf);

      // Calculate ESIC
      const esicResult = calculateESIC(effectiveGross, compliance.esic);

      // Calculate PT
      const pt = calculatePT(effectiveGross, compliance.professionalTax.slabs);

      // Calculate TDS
      const tds = calculateTDS(grossMonthly, compliance.tds);

      const totalDeductions = round2(
        epfResult.employeeEPF +
        (esicResult?.employeeESIC ?? 0) +
        pt +
        tds +
        lopDeduction
      );

      const netPay = round2(effectiveGross - epfResult.employeeEPF - (esicResult?.employeeESIC ?? 0) - pt - tds);

      const entryRef = adminDb.collection("payrollEntries").doc();
      batch.set(entryRef, {
        cycleId,
        period,
        employeeId: empDoc.id,
        employeeName: emp.name ?? "",
        employeeCode: emp.employeeCode ?? emp.guardId ?? "",
        clientId: emp.clientId ?? "",
        clientName: emp.clientName ?? "",
        district: emp.district ?? "",
        workingDays: attendance.workingDays,
        presentDays: attendance.presentDays,
        lopDays: attendance.lopDays,
        overtimeHours: attendance.overtimeHours,
        overtimeAmount: 0,
        earnings: {
          basic: epfBase,
          hra: round2(effectiveGross * 0.2),
          da: 0,
          conveyance: 0,
          specialAllowance: round2(effectiveGross - epfBase - round2(effectiveGross * 0.2)),
          otherAllowances: 0,
          overtimeAmount: 0,
          grossEarnings: effectiveGross,
        },
        deductions: {
          epfEmployee: epfResult.employeeEPF,
          esicEmployee: esicResult?.employeeESIC ?? 0,
          professionalTax: pt,
          tds,
          lopDeduction,
          otherDeductions: 0,
          totalDeductions,
        },
        employerContributions: {
          epfEmployer: epfResult.totalEmployerEPF,
          esicEmployer: esicResult?.employerESIC ?? 0,
        },
        netPay,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });

      batchCount++;
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        batch = adminDb.batch();
        batchCount = 0;
      }

      totalEmployees++;
      totalGross += effectiveGross;
      totalNetPay += netPay;
      totalEPF += epfResult.employeeEPF;
      totalESIC += esicResult?.employeeESIC ?? 0;
      totalPT += pt;
      totalTDS += tds;
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    // Update cycle with totals
    await cycleRef.update({
      status: "review",
      totalEmployees,
      totalGross: round2(totalGross),
      totalNetPay: round2(totalNetPay),
      totalEPF: round2(totalEPF),
      totalESIC: round2(totalESIC),
      totalPT: round2(totalPT),
      totalTDS: round2(totalTDS),
      processedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      cycleId,
      totalEmployees,
      totalGross: round2(totalGross),
      totalNetPay: round2(totalNetPay),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    console.error("Payroll run error:", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
