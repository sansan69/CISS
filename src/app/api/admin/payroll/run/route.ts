import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import {
  applySavedWageTemplate,
  calculateEPF,
  calculateESIC,
  calculatePT,
  calculateTDS,
  computeEpfApplicableWage,
  derivePayrollTemplateFromWageConfig,
  prorateAmount,
  round2,
  summarizeNamedEarnings,
} from "@/lib/payroll/calculate";
import { aggregateAttendance } from "@/lib/payroll/attendance-aggregator";
import { cloneComplianceSettings } from "@/lib/payroll/defaults";
import { runChunked, buildSelfUrl } from "@/lib/server/self-queue";
import type { ClientWageConfig, ComplianceSettings, WageComponent, WageTemplateRule } from "@/types/payroll";
export const runtime = "nodejs";
export const maxDuration = 300;

const CHUNK_SIZE = 25;

function normalizeDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function getTdsProjectionMonths(period: string, joiningDate: unknown) {
  const [periodYear, periodMonth] = period.split("-").map(Number);
  const financialYearStartYear = periodMonth >= 4 ? periodYear : periodYear - 1;
  const financialYearEnd = new Date(financialYearStartYear + 1, 2, 31);
  const defaultMonths =
    (financialYearEnd.getFullYear() - periodYear) * 12 +
    (financialYearEnd.getMonth() - (periodMonth - 1)) +
    1;

  const joinedAt = normalizeDate(joiningDate);
  if (!joinedAt) return defaultMonths;

  const periodStart = new Date(periodYear, periodMonth - 1, 1);
  const projectionStart = joinedAt > periodStart
    ? new Date(joinedAt.getFullYear(), joinedAt.getMonth(), 1)
    : periodStart;

  if (projectionStart > financialYearEnd) return 1;
  return (
    (financialYearEnd.getFullYear() - projectionStart.getFullYear()) * 12 +
    (financialYearEnd.getMonth() - projectionStart.getMonth()) +
    1
  );
}

type ClientDocShape = {
  name?: string;
  clientName?: string;
  nationalHolidayList?: string[];
  uniformAllowanceMonthly?: number;
  fieldAllowanceMonthly?: number;
};

export async function POST(request: Request) {
  let cycleRef: FirebaseFirestore.DocumentReference | null = null;
  try {
    const decoded = await requireAdmin(request);
    const body = await request.json();
    const { period, clientId } = body as { period: string; clientId?: string };

    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json({ error: "Invalid period. Use YYYY-MM format." }, { status: 400 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const [yearStr, monthStr] = period.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    // ── Atomically create the payroll cycle ──
    const cycleDocId = clientId ? `${period}_${clientId}` : period;
    const potentialCycleRef = adminDb.collection("payrollCycles").doc(cycleDocId);

    await adminDb.runTransaction(async (transaction) => {
      const existing = await transaction.get(potentialCycleRef);
      if (existing.exists) {
        throw Object.assign(
          new Error(`Payroll cycle for ${period} already exists.`),
          { statusCode: 409, cycleId: cycleDocId },
        );
      }
      transaction.create(potentialCycleRef, {
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
    });

    cycleRef = potentialCycleRef;

    const compDoc = await adminDb.collection("complianceSettings").doc("global").get();
    const compliance = (compDoc.exists ? compDoc.data() : cloneComplianceSettings()) as ComplianceSettings;

    const selfUrl = buildSelfUrl(request.url, "/api/admin/payroll/run");
    const cronSecret = process.env.CRON_SECRET || "";

    const result = await runChunked(
      {
        stateCollection: "payrollCycles",
        jobId: cycleDocId,
        budgetMs: 50_000,
        selfUrl,
        cronSecret,
        cursorKey: "progress",
      },
      // ── claim: next 25 employees ──
      async (tx, cursor) => {
        let query: FirebaseFirestore.Query = adminDb
          .collection("employees")
          .where("status", "==", "Active")
          .orderBy("__name__")
          .limit(CHUNK_SIZE);

        if (clientId) {
          query = query.where("clientId", "==", clientId);
        }

        if (cursor) {
          const cursorDocRef = adminDb
            .collection("employees")
            .doc(cursor as string);
          const cursorDoc = await tx.get(cursorDocRef);
          if (cursorDoc.exists) {
            query = query.startAfter(cursorDoc);
          }
        }

        const snapshot = await query.get();
        if (snapshot.empty) {
          return { chunk: null, cursor: null };
        }

        return {
          chunk: snapshot.docs,
          cursor: snapshot.docs[snapshot.docs.length - 1].id,
        };
      },
      // ── process: compute pay and write entries for 25 employees ──
      async (docs) => {
        const wageConfigCache = new Map<string, ClientWageConfig | null>();
        const payrollTemplateCache = new Map<
          string,
          { grossMonthly: number; componentAmounts: Record<string, number> } | null
        >();
        const clientCache = new Map<string, ClientDocShape>();

        async function getWageConfig(targetClientId?: string | null) {
          if (!targetClientId) return null;
          if (wageConfigCache.has(targetClientId)) return wageConfigCache.get(targetClientId) ?? null;
          const configDoc = await adminDb.collection("clientWageConfig").doc(targetClientId).get();
          const config = configDoc.exists ? ({ id: configDoc.id, ...configDoc.data() } as ClientWageConfig) : null;
          wageConfigCache.set(targetClientId, config);
          return config;
        }

        async function getPayrollTemplate(targetClientId?: string | null) {
          if (!targetClientId) return null;
          if (payrollTemplateCache.has(targetClientId)) {
            return payrollTemplateCache.get(targetClientId) ?? null;
          }
          const wageConfig = await getWageConfig(targetClientId);
          const wageComponents = (wageConfig?.components ?? []) as WageComponent[];
          const template = derivePayrollTemplateFromWageConfig(wageComponents);
          payrollTemplateCache.set(targetClientId, template);
          return template;
        }

        async function getClientDoc(targetClientId?: string | null) {
          if (!targetClientId) return null;
          if (clientCache.has(targetClientId)) return clientCache.get(targetClientId) ?? null;
          const clientDoc = await adminDb.collection("clients").doc(targetClientId).get();
          const clientData = clientDoc.exists ? (clientDoc.data() as ClientDocShape) : null;
          if (clientData) clientCache.set(targetClientId, clientData);
          return clientData;
        }

        let chunkProcessed = 0;
        let chunkGross = 0;
        let chunkNetPay = 0;
        let chunkEPF = 0;
        let chunkESIC = 0;
        let chunkPT = 0;
        let chunkTDS = 0;
        const chunkSkipped: Array<{ name: string; clientId: string | null; reason: string }> = [];

        const BATCH_SIZE = 450;
        let batch = adminDb.batch();
        let batchCount = 0;

        for (const employeeDoc of docs) {
          const employee = employeeDoc.data() as {
            name?: string;
            firstName?: string;
            lastName?: string;
            employeeCode?: string;
            guardId?: string;
            clientId?: string;
            clientName?: string;
            district?: string;
            joiningDate?: unknown;
          };

          const resolvedClientId = employee.clientId ?? null;
          const clientDoc = await getClientDoc(resolvedClientId);
          const wageConfig = await getWageConfig(resolvedClientId);
          const wageComponents = (wageConfig?.components ?? []) as WageComponent[];
          const payrollTemplate = await getPayrollTemplate(resolvedClientId);
          const templateRules = wageConfig?.templateRules ?? [];
          const templateConstants = wageConfig?.templateConstants ?? [];

          if (!payrollTemplate && !templateRules.length) {
            const empName =
              employee.name ||
              [employee.firstName, employee.lastName].filter(Boolean).join(" ") ||
              "Unnamed employee";
            chunkSkipped.push({
              name: empName,
              clientId: resolvedClientId,
              reason: resolvedClientId
                ? "No wage configuration found for client"
                : "Employee has no client assigned",
            });
            continue;
          }

          const mergedComponentAmounts: Record<string, number> = {
            ...(payrollTemplate?.componentAmounts ?? {}),
          };

          if (clientDoc?.uniformAllowanceMonthly) {
            mergedComponentAmounts.uniform_allowance =
              (mergedComponentAmounts.uniform_allowance ?? 0) + clientDoc.uniformAllowanceMonthly;
          }
          if (clientDoc?.fieldAllowanceMonthly) {
            mergedComponentAmounts.field_allowance =
              (mergedComponentAmounts.field_allowance ?? 0) + clientDoc.fieldAllowanceMonthly;
          }

          const attendance = await aggregateAttendance(employeeDoc.id, period, adminDb, {
            holidays: Array.isArray(clientDoc?.nationalHolidayList)
              ? clientDoc.nationalHolidayList
              : [],
          });
          const payableDays = Math.min(attendance.workingDays, attendance.presentDays);

          const attendanceInputs = {
            payable_duties: payableDays,
            duties: attendance.presentDays,
            weekly_off: 0,
            extra_duty_days: 0,
            half_day: 0,
            total: payableDays,
            additional_duties: 0,
          };

          const templateSyntheticComponents: WageComponent[] = templateRules.map((rule, index) => ({
            id: rule.standardName,
            name: rule.displayLabel,
            type:
              rule.category === "deduction"
                ? "deduction"
                : rule.category === "employer_contribution"
                  ? "employer_contribution"
                  : "earning",
            calculationType: "fixed_amount",
            value: null,
            isStatutory: false,
            statutoryType: null,
            isTaxable: rule.category !== "deduction",
            epfApplicable: /basic|da|dearness/i.test(rule.standardName),
            order: index + 1,
          }));

          const proratedComponents = templateRules.length
            ? applySavedWageTemplate({
                rules: templateRules,
                constants: templateConstants,
                attendance: attendanceInputs,
              }).components
            : Object.fromEntries(
                Object.entries(mergedComponentAmounts).map(([componentId, amount]) => [
                  componentId,
                  prorateAmount(amount, attendance.workingDays, payableDays),
                ]),
              );

          // Inject client-level uniform/field allowances for template-based configs.
          // These are NOT part of the template rules but are configured per-client
          // and should be included in every payroll entry for that client.
          if (templateRules.length) {
            if (clientDoc?.uniformAllowanceMonthly) {
              const prorated = prorateAmount(
                clientDoc.uniformAllowanceMonthly,
                attendance.workingDays,
                payableDays,
              );
              proratedComponents.uniform_allowance =
                (proratedComponents.uniform_allowance ?? 0) + prorated;
            }
            if (clientDoc?.fieldAllowanceMonthly) {
              const prorated = prorateAmount(
                clientDoc.fieldAllowanceMonthly,
                attendance.workingDays,
                payableDays,
              );
              proratedComponents.field_allowance =
                (proratedComponents.field_allowance ?? 0) + prorated;
            }
          }

          const componentMeta = templateRules.length ? templateSyntheticComponents : wageComponents;
          const earningsSummary = summarizeNamedEarnings(proratedComponents, componentMeta);
          const grossFromSummaryRule =
            proratedComponents.gross ??
            proratedComponents.gross_earnings ??
            proratedComponents.salary_payable;
          const grossEarnings =
            grossFromSummaryRule !== undefined
              ? round2(grossFromSummaryRule)
              : round2(
                  Object.entries(proratedComponents).reduce((sum, [componentId, amount]) => {
                    const matchingRule = templateRules.find((rule) => rule.standardName === componentId);
                    // Exclude deductions, employer contributions, and summary aggregates
                    // (e.g. "total_deductions", "net_pay") from gross earnings calculation.
                    if (matchingRule) {
                      if (matchingRule.category === "deduction" || matchingRule.category === "employer_contribution") {
                        return sum;
                      }
                      if (matchingRule.category === "summary") {
                        // Summary components aggregate non-earning values — exclude from gross.
                        return sum;
                      }
                    }
                    const component = componentMeta.find((entry) => entry.id === componentId);
                    if (component?.type === "deduction" || component?.type === "employer_contribution") return sum;
                    return sum + amount;
                  }, 0),
                );
          const epfBase = computeEpfApplicableWage(proratedComponents, componentMeta);
          const epfResult = calculateEPF(epfBase, compliance.epf);
          const esicResult = calculateESIC(grossEarnings, compliance.esic);
          const pt = calculatePT(grossEarnings, compliance.professionalTax.slabs);
          const tds = calculateTDS(
            grossEarnings,
            compliance.tds,
            getTdsProjectionMonths(period, employee.joiningDate),
          );
          const totalDeductions = round2(
            epfResult.employeeEPF +
            (esicResult?.employeeESIC ?? 0) +
            pt +
            tds
          );
          const netPay = round2(
            grossEarnings - epfResult.employeeEPF - (esicResult?.employeeESIC ?? 0) - pt - tds,
          );

          const entryRef = adminDb.collection("payrollEntries").doc();
          batch.set(entryRef, {
            cycleId: cycleRef!.id,
            period,
            employeeId: employeeDoc.id,
            employeeName:
              employee.name ||
              [employee.firstName, employee.lastName].filter(Boolean).join(" ") ||
              "Unnamed employee",
            employeeCode: employee.employeeCode ?? employee.guardId ?? "",
            clientId: resolvedClientId ?? "",
            clientName: employee.clientName ?? clientDoc?.name ?? clientDoc?.clientName ?? "",
            district: employee.district ?? "",
            workingDays: attendance.workingDays,
            presentDays: attendance.presentDays,
            payableDays,
            earnings: {
              ...earningsSummary,
              grossEarnings,
              componentBreakdown: proratedComponents,
            },
            deductions: {
              epfEmployee: epfResult.employeeEPF,
              esicEmployee: esicResult?.employeeESIC ?? 0,
              professionalTax: pt,
              tds,
              otherDeductions: 0,
              totalDeductions,
            },
            employerContributions: {
              epfEmployer: epfResult.totalEmployerEPF,
              esicEmployer: esicResult?.employerESIC ?? 0,
            },
            netPay,
            payslipUrl: `/api/admin/payroll/entries/${entryRef.id}/payslip`,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
          });

          batchCount += 1;
          if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batch = adminDb.batch();
            batchCount = 0;
          }

          chunkProcessed += 1;
          chunkGross += grossEarnings;
          chunkNetPay += netPay;
          chunkEPF += epfResult.employeeEPF;
          chunkESIC += esicResult?.employeeESIC ?? 0;
          chunkPT += pt;
          chunkTDS += tds;
        }

        if (batchCount > 0) {
          await batch.commit();
        }

        // Write progress + accumulate totals atomically
        if (chunkProcessed > 0 || chunkSkipped.length > 0) {
          await adminDb.collection("payrollCycles").doc(cycleRef!.id).update({
            totalEmployees: FieldValue.increment(chunkProcessed),
            totalGross: FieldValue.increment(chunkGross),
            totalNetPay: FieldValue.increment(chunkNetPay),
            totalEPF: FieldValue.increment(chunkEPF),
            totalESIC: FieldValue.increment(chunkESIC),
            totalPT: FieldValue.increment(chunkPT),
            totalTDS: FieldValue.increment(chunkTDS),
            "progress.processedCount": FieldValue.increment(chunkProcessed),
            "progress.lastEmployeeDocId": docs[docs.length - 1]?.id ?? null,
            "progress.heartbeatAt": FieldValue.serverTimestamp(),
          });

          if (chunkSkipped.length > 0) {
            await adminDb.collection("payrollCycles").doc(cycleRef!.id).update({
              skippedEmployees: FieldValue.arrayUnion(...chunkSkipped),
            });
          }
        }

        return { done: true, processed: chunkProcessed };
      },
    );

    // All chunks complete (or no work to do)
    if (result.done && result.processed > 0) {
      // Use a transaction to atomically read current totals, round them,
      // and transition status to "review". This prevents TOCTOU races
      // between concurrent invocations.
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(cycleRef!);
        const data = snap.data() ?? {};
        tx.update(cycleRef!, {
          status: "review",
          totalGross: round2((data as any).totalGross ?? 0),
          totalNetPay: round2((data as any).totalNetPay ?? 0),
          totalEPF: round2((data as any).totalEPF ?? 0),
          totalESIC: round2((data as any).totalESIC ?? 0),
          totalPT: round2((data as any).totalPT ?? 0),
          totalTDS: round2((data as any).totalTDS ?? 0),
          processedAt: FieldValue.serverTimestamp(),
        });
      });
    } else if (result.done && result.processed === 0) {
      // This invocation claimed zero employees. Check whether a prior
      // self-queue invocation already wrote totals (non-zero cycle doc).
      const snap = await cycleRef!.get();
      const currentData = snap.data() ?? {};
      const hasExistingTotals = (currentData as any).totalGross > 0;

      if (hasExistingTotals) {
        // Prior invocations already accumulated correct totals. Just round
        // them and transition to review, using a transaction for safety.
        await adminDb.runTransaction(async (tx) => {
          const snap2 = await tx.get(cycleRef!);
          const d = snap2.data() ?? {};
          tx.update(cycleRef!, {
            status: "review",
            totalGross: round2((d as any).totalGross ?? 0),
            totalNetPay: round2((d as any).totalNetPay ?? 0),
            totalEPF: round2((d as any).totalEPF ?? 0),
            totalESIC: round2((d as any).totalESIC ?? 0),
            totalPT: round2((d as any).totalPT ?? 0),
            totalTDS: round2((d as any).totalTDS ?? 0),
            processedAt: FieldValue.serverTimestamp(),
          });
        });
      } else {
        // Truly no employees matched — mark as review with zeroes
        await cycleRef.update({
          status: "review",
          totalGross: 0,
          totalNetPay: 0,
          totalEPF: 0,
          totalESIC: 0,
          totalPT: 0,
          totalTDS: 0,
          processedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    if (!result.done) {
      return NextResponse.json({ status: 202, cycleId: cycleRef.id });
    }

    const refreshedSnap = await cycleRef.get();
    const cycleData = refreshedSnap.data() ?? {};
    return NextResponse.json({
      success: true,
      cycleId: cycleRef.id,
      totalEmployees: (cycleData as any).totalEmployees ?? 0,
      totalGross: (cycleData as any).totalGross ?? 0,
      totalNetPay: (cycleData as any).totalNetPay ?? 0,
      skippedCount: Array.isArray((cycleData as any).skippedEmployees)
        ? (cycleData as any).skippedEmployees.length
        : 0,
    });
  } catch (err: unknown) {
    const toctouError = err as { statusCode?: number; cycleId?: string; message?: string };
    if (toctouError.statusCode === 409) {
      return NextResponse.json(
        {
          error: toctouError.message || "Payroll cycle already exists.",
          cycleId: toctouError.cycleId,
        },
        { status: 409 },
      );
    }
    const { log } = await import("@/lib/server/log");
    log("error", "payroll", "Payroll run error", { error: err instanceof Error ? err.message : String(err) });
    if (cycleRef) {
      try {
        const { FieldValue: FV } = await import("firebase-admin/firestore");
        await cycleRef.update({
          status: "failed",
          error: err instanceof Error ? err.message : "Payroll processing failed.",
          failedAt: FV.serverTimestamp(),
        });
      } catch {
        // best-effort status update
      }
    }
    const message = err instanceof Error ? err.message : "Payroll processing failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Helper to read a numeric total field from the cycle doc (rounded). */
async function readTotal(
  db: FirebaseFirestore.Firestore,
  cycleId: string,
  field: string,
): Promise<number> {
  const snap = await db.collection("payrollCycles").doc(cycleId).get();
  const data = snap.data();
  return (data && typeof (data as any)[field] === "number" ? (data as any)[field] : 0) as number;
}
