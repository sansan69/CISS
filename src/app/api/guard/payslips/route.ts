import { NextResponse } from "next/server";

import { requireGuard } from "@/lib/server/guard-auth";
import {
  PAYSLIP_DOCUMENTS_COLLECTION,
  comparePayslipDocsDesc,
  toIsoString,
} from "@/lib/server/payslips";
import type { GuardPayslipListItem } from "@/types/payslip";

export const runtime = "nodejs";

type UnifiedPayslip = GuardPayslipListItem & {
  source: "payroll" | "document";
  downloadUrl: string;
};

function payrollPeriod(data: Record<string, unknown>): string {
  if (typeof data.period === "string" && data.period.trim()) return data.period.trim();
  const year = Number(data.year ?? data.cycleYear);
  const month = Number(data.month ?? data.cycleMonth);
  if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  return "";
}

/**
 * A guard's payslips from both sources: payroll-generated entries (the
 * long-standing payroll flow) and PDFs uploaded in bulk by an admin. Ownership
 * is always enforced with an equality query on the guard's own identity.
 */
export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);
    const { db } = await import("@/lib/firebaseAdmin");

    let payrollSnapshot = await db
      .collection("payrollEntries")
      .where("employeeDocId", "==", guard.employeeDocId)
      .limit(24)
      .get();
    if (payrollSnapshot.empty && guard.employeeId) {
      payrollSnapshot = await db
        .collection("payrollEntries")
        .where("employeeId", "==", guard.employeeId)
        .limit(24)
        .get();
    }

    const documentSnapshot = await db
      .collection(PAYSLIP_DOCUMENTS_COLLECTION)
      .where("employeeDocId", "==", guard.employeeDocId)
      .limit(100)
      .get();

    const payroll: UnifiedPayslip[] = payrollSnapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const period = payrollPeriod(data);
      return {
        id: doc.id,
        period,
        fileName: period ? `payslip-${period}.pdf` : "payslip.pdf",
        sizeBytes: 0,
        createdAt: toIsoString(data.createdAt),
        employeeId:
          typeof data.employeeId === "string" ? data.employeeId : guard.employeeId,
        source: "payroll",
        downloadUrl: `/api/guard/payslips/${doc.id}/payslip`,
      };
    });

    const documents: UnifiedPayslip[] = documentSnapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        period: typeof data.period === "string" ? data.period : "",
        fileName: typeof data.fileName === "string" ? data.fileName : "",
        sizeBytes: typeof data.sizeBytes === "number" ? data.sizeBytes : 0,
        createdAt: toIsoString(data.createdAt),
        employeeId:
          typeof data.employeeId === "string" ? data.employeeId : guard.employeeId,
        source: "document",
        downloadUrl: `/api/guard/payslips/${doc.id}/payslip`,
      };
    });

    const payslips = [...payroll, ...documents].sort((a, b) =>
      comparePayslipDocsDesc(
        { period: a.period, createdAt: a.createdAt },
        { period: b.period, createdAt: b.createdAt },
      ),
    );

    return NextResponse.json(
      { payslips },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error: any) {
    const message: string = error?.message || "Could not list payslips.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
