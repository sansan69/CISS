import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/server/auth";
import {
  PAYSLIP_DOCUMENTS_COLLECTION,
  PAYSLIP_MAX_LIST,
  comparePayslipDocsDesc,
  isValidPayslipPeriod,
  toIsoString,
} from "@/lib/server/payslips";
import type { AdminPayslipListItem } from "@/types/payslip";

export const runtime = "nodejs";

/** A stored document with its Firestore id merged in. */
type PayslipRow = Record<string, unknown> & { id: string };

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { db } = await import("@/lib/firebaseAdmin");

    const { searchParams } = new URL(request.url);
    const requestedPeriod = searchParams.get("period")?.trim() || "";
    if (requestedPeriod && !isValidPayslipPeriod(requestedPeriod)) {
      return NextResponse.json(
        { error: 'period must be in YYYY-MM form, for example "2026-01".' },
        { status: 400 },
      );
    }

    // Equality + orderBy on a different field would need a composite index; the
    // page is capped at 200 documents, so sort newest-first in memory instead.
    const query = requestedPeriod
      ? db.collection(PAYSLIP_DOCUMENTS_COLLECTION).where("period", "==", requestedPeriod).limit(PAYSLIP_MAX_LIST)
      : db.collection(PAYSLIP_DOCUMENTS_COLLECTION).limit(PAYSLIP_MAX_LIST);
    const snapshot = await query.get();

    const rows: PayslipRow[] = snapshot.docs.map((doc) => ({
      ...(doc.data() as Record<string, unknown>),
      id: doc.id,
    }));
    rows.sort(comparePayslipDocsDesc);

    const payslips: AdminPayslipListItem[] = rows.map((row) => ({
      id: String(row.id),
      period: typeof row.period === "string" ? row.period : "",
      fileName: typeof row.fileName === "string" ? row.fileName : "",
      sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : 0,
      createdAt: toIsoString(row.createdAt),
      employeeId: typeof row.employeeId === "string" ? row.employeeId : "",
      employeeDocId: typeof row.employeeDocId === "string" ? row.employeeDocId : "",
      employeeName: typeof row.employeeName === "string" ? row.employeeName : "",
      clientName: typeof row.clientName === "string" ? row.clientName : null,
      parseMethod:
        row.parseMethod === "employeeId" || row.parseMethod === "filename" || row.parseMethod === "name"
          ? row.parseMethod
          : "name",
      uploadedBy: typeof row.uploadedBy === "string" ? row.uploadedBy : "",
    }));

    return NextResponse.json(
      {
        period: requestedPeriod || null,
        total: payslips.length,
        payslips,
      },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error: any) {
    const message: string = error?.message || "Could not list payslips.";
    const status = message === "Admin access required."
      ? 403
      : message === "Missing bearer token."
        ? 401
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
