import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import {
  applyWageComponents,
  calculateEPF,
  calculateESIC,
  calculatePT,
  calculateTDS,
  computeEpfApplicableWage,
  prorateAmount,
  round2,
  summarizeNamedEarnings,
} from "@/lib/payroll/calculate";
import { aggregateAttendance } from "@/lib/payroll/attendance-aggregator";
import { aggregateApprovedLeave } from "@/lib/payroll/leave-aggregator";
import { cloneComplianceSettings } from "@/lib/payroll/defaults";
import type { ComplianceSettings, EmployeeSalary, SalaryStructure, WageComponent } from "@/types/payroll";

type ClientDocShape = {
  name?: string;
  clientName?: string;
  uniformAllowanceMonthly?: number;
  fieldAllowanceMonthly?: number;
};

function buildGenericBreakdown(grossMonthly: number) {
  const basic = round2(grossMonthly * 0.5);
  const hra = round2(basic * 0.2);
  const specialAllowance = round2(Math.max(0, grossMonthly - basic - hra));
  return {
    basic,
    hra,
    special_allowance: specialAllowance,
  };
}

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

    const existingCycles = await adminDb.collection("payrollCycles").where("period", "==", period).get();
    const conflictingCycle = existingCycles.docs.find((doc) => {
      const data = doc.data() as { clientId?: string | null };
      return (data.clientId || null) === (clientId || null);
    });

    if (conflictingCycle) {
      return NextResponse.json(
        { error: `Payroll cycle for ${period} already exists.`, cycleId: conflictingCycle.id },
        { status: 409 },
      );
    }

    const [yearStr, monthStr] = period.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const compDoc = await adminDb.collection("complianceSettings").doc("global").get();
    const compliance = (compDoc.exists ? compDoc.data() : cloneComplianceSettings()) as ComplianceSettings;

    let employeeQuery: FirebaseFirestore.Query = adminDb.collection("employees").where("status", "==", "Active");
    if (clientId) {
      employeeQuery = employeeQuery.where("clientId", "==", clientId);
    }
    const employeeSnapshot = await employeeQuery.limit(500).get();

    const cycleRef = await adminDb.collection("payrollCycles").add({
      period,
      month,
      year,
      clientId: clientId ?? null,
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

    const salaryCache = new Map<string, EmployeeSalary>();
    const structureCache = new Map<string, SalaryStructure>();
    const wageConfigCache = new Map<string, WageComponent[]>();
    const clientCache = new Map<string, ClientDocShape>();

    async function getSalary(employeeId: string) {
      if (salaryCache.has(employeeId)) return salaryCache.get(employeeId) ?? null;
      const salaryDoc = await adminDb.collection("employeeSalaries").doc(employeeId).get();
      const salary = salaryDoc.exists ? ({ id: salaryDoc.id, ...salaryDoc.data() } as EmployeeSalary) : null;
      if (salary) salaryCache.set(employeeId, salary);
      return salary;
    }

    async function getStructure(structureId?: string | null) {
      if (!structureId) return null;
      if (structureCache.has(structureId)) return structureCache.get(structureId) ?? null;
      const structureDoc = await adminDb.collection("salaryStructures").doc(structureId).get();
      const structure = structureDoc.exists ? ({ id: structureDoc.id, ...structureDoc.data() } as SalaryStructure) : null;
      if (structure) structureCache.set(structureId, structure);
      return structure;
    }

    async function getWageConfig(targetClientId?: string | null) {
      if (!targetClientId) return [] as WageComponent[];
      if (wageConfigCache.has(targetClientId)) return wageConfigCache.get(targetClientId) ?? [];
      const configDoc = await adminDb.collection("clientWageConfig").doc(targetClientId).get();
      const components = configDoc.exists ? ((configDoc.data()?.components ?? []) as WageComponent[]) : [];
      wageConfigCache.set(targetClientId, components);
      return components;
    }

    async function getClientDoc(targetClientId?: string | null) {
      if (!targetClientId) return null;
      if (clientCache.has(targetClientId)) return clientCache.get(targetClientId) ?? null;
      const clientDoc = await adminDb.collection("clients").doc(targetClientId).get();
      const clientData = clientDoc.exists ? (clientDoc.data() as ClientDocShape) : null;
      if (clientData) clientCache.set(targetClientId, clientData);
      return clientData;
    }

    let totalEmployees = 0;
    let totalGross = 0;
    let totalNetPay = 0;
    let totalEPF = 0;
    let totalESIC = 0;
    let totalPT = 0;
    let totalTDS = 0;

    const BATCH_SIZE = 450;
    let batch = adminDb.batch();
    let batchCount = 0;

    for (const employeeDoc of employeeSnapshot.docs) {
      const employee = employeeDoc.data() as {
        name?: string;
        firstName?: string;
        lastName?: string;
        employeeCode?: string;
        guardId?: string;
        clientId?: string;
        clientName?: string;
        district?: string;
      };

      const salary = await getSalary(employeeDoc.id);
      if (!salary) continue;

      const structure = await getStructure(salary.structureId);
      const clientDoc = await getClientDoc(employee.clientId || salary.clientId);
      const wageComponents = await getWageConfig(employee.clientId || salary.clientId);
      const structureAmounts =
        structure?.componentAmounts && Object.keys(structure.componentAmounts).length > 0
          ? structure.componentAmounts
          : applyWageComponents(salary.grossMonthly, wageComponents);

      const baseComponentAmounts =
        structureAmounts && Object.keys(structureAmounts).length > 0
          ? structureAmounts
          : buildGenericBreakdown(salary.grossMonthly);

      const mergedComponentAmounts: Record<string, number> = {
        ...baseComponentAmounts,
        ...(salary.componentOverrides ?? {}),
      };

      if (clientDoc?.uniformAllowanceMonthly) {
        mergedComponentAmounts.uniform_allowance =
          (mergedComponentAmounts.uniform_allowance ?? 0) + clientDoc.uniformAllowanceMonthly;
      }
      if (clientDoc?.fieldAllowanceMonthly) {
        mergedComponentAmounts.field_allowance =
          (mergedComponentAmounts.field_allowance ?? 0) + clientDoc.fieldAllowanceMonthly;
      }

      const attendance = await aggregateAttendance(employeeDoc.id, period, adminDb);
      const leave = await aggregateApprovedLeave(employeeDoc.id, period, adminDb);
      const payableDays = Math.min(
        attendance.workingDays,
        attendance.presentDays + leave.approvedPaidLeaveDays,
      );
      const lopDays = Math.max(
        0,
        attendance.workingDays - attendance.presentDays - leave.approvedPaidLeaveDays,
      );

      const proratedComponents = Object.fromEntries(
        Object.entries(mergedComponentAmounts).map(([componentId, amount]) => [
          componentId,
          prorateAmount(amount, attendance.workingDays, attendance.workingDays - lopDays),
        ]),
      );

      const earningsSummary = summarizeNamedEarnings(proratedComponents, wageComponents);
      const grossEarnings = round2(
        Object.values(proratedComponents).reduce((sum, amount) => sum + amount, 0),
      );
      const lopDeduction = round2(
        Object.values(mergedComponentAmounts).reduce((sum, amount) => sum + amount, 0) - grossEarnings,
      );
      const epfBase = computeEpfApplicableWage(proratedComponents, wageComponents);
      const epfResult = calculateEPF(epfBase, compliance.epf);
      const esicResult = calculateESIC(grossEarnings, compliance.esic);
      const pt = calculatePT(grossEarnings, compliance.professionalTax.slabs);
      const tds = calculateTDS(grossEarnings, {
        ...compliance.tds,
        regime: salary.taxRegime ?? compliance.tds.regime,
      });
      const totalDeductions = round2(
        epfResult.employeeEPF +
        (esicResult?.employeeESIC ?? 0) +
        pt +
        tds +
        lopDeduction
      );
      const netPay = round2(
        grossEarnings - epfResult.employeeEPF - (esicResult?.employeeESIC ?? 0) - pt - tds,
      );

      const entryRef = adminDb.collection("payrollEntries").doc();
      batch.set(entryRef, {
        cycleId: cycleRef.id,
        period,
        employeeId: employeeDoc.id,
        employeeName:
          employee.name ||
          [employee.firstName, employee.lastName].filter(Boolean).join(" ") ||
          "Unnamed employee",
        employeeCode: employee.employeeCode ?? employee.guardId ?? "",
        clientId: employee.clientId ?? salary.clientId ?? "",
        clientName: employee.clientName ?? clientDoc?.name ?? clientDoc?.clientName ?? "",
        district: employee.district ?? "",
        workingDays: attendance.workingDays,
        presentDays: attendance.presentDays,
        payableDays,
        approvedPaidLeaveDays: leave.approvedPaidLeaveDays,
        approvedUnpaidLeaveDays: leave.approvedUnpaidLeaveDays,
        lopDays,
        overtimeHours: attendance.overtimeHours,
        overtimeAmount: 0,
        earnings: {
          ...earningsSummary,
          overtimeAmount: 0,
          grossEarnings,
          componentBreakdown: proratedComponents,
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
        payslipUrl: `/api/admin/payroll/entries/${entryRef.id}/payslip`,
        salaryStructureId: salary.structureId ?? structure?.id ?? null,
        salaryStructureName: salary.structureName ?? structure?.name ?? "",
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });

      batchCount += 1;
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        batch = adminDb.batch();
        batchCount = 0;
      }

      totalEmployees += 1;
      totalGross += grossEarnings;
      totalNetPay += netPay;
      totalEPF += epfResult.employeeEPF;
      totalESIC += esicResult?.employeeESIC ?? 0;
      totalPT += pt;
      totalTDS += tds;
    }

    if (batchCount > 0) {
      await batch.commit();
    }

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
      cycleId: cycleRef.id,
      totalEmployees,
      totalGross: round2(totalGross),
      totalNetPay: round2(totalNetPay),
    });
  } catch (err: unknown) {
    console.error("Payroll run error:", err);
    const message = err instanceof Error ? err.message : "Payroll processing failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
