import { NextResponse } from "next/server";

import { generatePayslipPdf } from "@/lib/payroll/payslip";
import { requireGuard } from "@/lib/server/guard-auth";
import type { PayrollCycle, PayrollEntry } from "@/types/payroll";
import {
  PAYSLIP_DOCUMENTS_COLLECTION,
  sanitizeDownloadFileName,
} from "@/lib/server/payslips";

export const runtime = "nodejs";

/**
 * Stream one of the guard's own payslip PDFs.
 *
 * Three layers stop cross-guard access:
 *  1. the document must exist and its `employeeDocId` must equal the caller's;
 *  2. the stored path must sit under the caller's own prefix (a poisoned
 *     document must not be able to point at another employee's object);
 *  3. the response is always an attachment with `no-store`, so the browser
 *     never caches or renders it as active content on the API origin.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const guard = await requireGuard(request);
    const { id } = await params;
    const documentId = String(id ?? "").trim();
    if (!documentId || documentId.includes("/")) {
      return NextResponse.json({ error: "Payslip not found." }, { status: 404 });
    }

    const { db, storage } = await import("@/lib/firebaseAdmin");
    const snap = await db.collection(PAYSLIP_DOCUMENTS_COLLECTION).doc(documentId).get();
    if (!snap.exists) {
      // Fall back to a payroll-generated entry so the payroll flow keeps
      // working alongside admin-uploaded PDFs.
      const entryDoc = await db.collection("payrollEntries").doc(documentId).get();
      if (!entryDoc.exists) {
        return NextResponse.json({ error: "Payslip not found." }, { status: 404 });
      }
      const entryData = entryDoc.data() ?? {};
      const ownsPayrollPayslip =
        entryData.employeeDocId === guard.employeeDocId ||
        (Boolean(entryData.employeeId) && entryData.employeeId === guard.employeeId);
      if (!ownsPayrollPayslip) {
        return NextResponse.json(
          { error: "This payslip belongs to another employee." },
          { status: 403 },
        );
      }
      const entry = { id: entryDoc.id, ...entryData } as PayrollEntry;
      const cycleDoc = await db.collection("payrollCycles").doc(entry.cycleId).get();
      const cycle = cycleDoc.exists
        ? ({ id: cycleDoc.id, ...cycleDoc.data() } as PayrollCycle)
        : null;
      const pdf = await generatePayslipPdf({
        entry,
        cycle,
        companyName: "CISS Workforce",
      });
      return new Response(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="payslip-${entry.period || "payroll"}.pdf"`,
          "Cache-Control": "no-store, private",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const data = snap.data() as Record<string, unknown>;
    if (String(data.employeeDocId ?? "") !== guard.employeeDocId) {
      // Deliberately not a 404: the record exists, this guard just does not own
      // it. The guard's own list never exposes another employee's document id.
      return NextResponse.json({ error: "This payslip belongs to another employee." }, { status: 403 });
    }

    const storagePath = String(data.storagePath ?? "");
    const expectedPrefix = `employees/${guard.employeeDocId}/payslips/`;
    if (!storagePath || !storagePath.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "This payslip is not available." }, { status: 409 });
    }

    let buffer: Buffer;
    try {
      const [downloaded] = await storage.bucket().file(storagePath).download();
      buffer = downloaded;
    } catch (error: any) {
      const notFound = error?.code === 404 || String(error?.message ?? "").includes("No such object");
      return NextResponse.json(
        { error: "The payslip file is missing from storage." },
        { status: notFound ? 404 : 502 },
      );
    }

    const period = typeof data.period === "string" ? data.period : "";
    const fileName = sanitizeDownloadFileName(period);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: any) {
    const message: string = error?.message || "Could not download the payslip.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
