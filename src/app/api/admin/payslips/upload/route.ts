import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { requireAdmin } from "@/lib/server/auth";
import { extractPdfTextDetailed } from "@/lib/server/payslip-pdf";
import {
  PAYSLIP_DOCUMENTS_COLLECTION,
  PAYSLIP_MAX_BYTES,
  PAYSLIP_MAX_FILES,
  baseFileName,
  buildPayslipStoragePath,
  createPayslipLookupCache,
  decidePayslipMatch,
  extractAllEmployeeIdsFromText,
  extractAllNamesFromText,
  extractAllStandaloneIdsFromText,
  extractNameFromText,
  extractStandaloneIdFromText,
  isValidPayslipPeriod,
  lookupPayslipCandidates,
  looksLikePdf,
  parseEmployeeIdFromFileName,
  parseNameFromFileName,
  payslipDocumentId,
} from "@/lib/server/payslips";
import type {
  PayslipFileError,
  PayslipUnmatchedFile,
  PayslipUploadResponse,
  PayslipUploadedFile,
} from "@/types/payslip";

export const runtime = "nodejs";
// Up to 50 PDFs are parsed and stored per request.
export const maxDuration = 120;

/** Beyond this many identifiers a file is refused rather than partially read. */
const MAX_EVIDENCE_ITEMS = 20;

function parseDryRun(value: FormDataEntryValue | null): boolean {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return text === "true" || text === "1" || text === "yes";
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const { db, storage } = await import("@/lib/firebaseAdmin");

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Send the payslips as multipart/form-data with a `period` field and one or more `files`." },
        { status: 400 },
      );
    }

    const period = String(form.get("period") ?? "").trim();
    if (!isValidPayslipPeriod(period)) {
      return NextResponse.json(
        { error: 'period is required in YYYY-MM form, for example "2026-01".' },
        { status: 400 },
      );
    }

    const dryRun = parseDryRun(form.get("dryRun"));
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (files.length === 0) {
      return NextResponse.json(
        { error: "At least one payslip PDF is required in `files`." },
        { status: 400 },
      );
    }
    if (files.length > PAYSLIP_MAX_FILES) {
      return NextResponse.json(
        { error: `Upload at most ${PAYSLIP_MAX_FILES} payslips at a time (received ${files.length}).` },
        { status: 400 },
      );
    }

    const uploaded: PayslipUploadedFile[] = [];
    const unmatched: PayslipUnmatchedFile[] = [];
    const errors: PayslipFileError[] = [];
    // One employee name index per request: a 50-file batch scans employees once.
    const cache = createPayslipLookupCache();

    for (const file of files) {
      const fileName = baseFileName(file.name);

      if (file.size <= 0) {
        errors.push({ fileName, message: "The file is empty." });
        continue;
      }
      if (file.size > PAYSLIP_MAX_BYTES) {
        errors.push({
          fileName,
          message: `The file is larger than ${Math.round(PAYSLIP_MAX_BYTES / 1024 / 1024)} MB.`,
        });
        continue;
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(await file.arrayBuffer());
      } catch {
        errors.push({ fileName, message: "The file could not be read." });
        continue;
      }

      if (!looksLikePdf(buffer)) {
        errors.push({ fileName, message: "This is not a PDF (no %PDF header)." });
        continue;
      }

      const extraction = await extractPdfTextDetailed(buffer);
      if (!extraction.complete) {
        unmatched.push({
          fileName,
          reason: "incomplete-pdf",
          detail: `This PDF could not be inspected completely (${extraction.pagesRead}/${extraction.totalPages} pages readable, or it exceeds the size limit). Nothing was stored; split or re-export the payslip and try again.`,
          extractedEmployeeId: null,
          extractedName: null,
        });
        continue;
      }
      const text = extraction.text;
      const pdfEmployeeIds = extractAllEmployeeIdsFromText(text);
      const allNames = extractAllNamesFromText(text);
      const allStandaloneIds = extractAllStandaloneIdsFromText(text);
      if (pdfEmployeeIds.length > 1) {
        unmatched.push({
          fileName,
          reason: "multiple-employees",
          detail: `This PDF contains ${pdfEmployeeIds.length} different employee ids (${pdfEmployeeIds.slice(0, 5).join(", ")}). Split it into one payslip per employee; nothing was stored.`,
          extractedEmployeeId: pdfEmployeeIds.join(", "),
          extractedName: extractNameFromText(text) ?? null,
        });
        continue;
      }
      const pdfEmployeeId = pdfEmployeeIds[0] ?? null;
      const fileNameEmployeeId = parseEmployeeIdFromFileName(fileName);
      const standaloneId = allStandaloneIds[0] ?? null;
      const candidateName = allNames[0] ?? parseNameFromFileName(fileName);

      // Unify every piece of evidence (PDF id, filename id, all printed names
      // and all standalone ids) before attributing the file. A mismatch means
      // the PDF holds more than one employee's slip and must not be stored.
      const evidenceCount =
        pdfEmployeeIds.length +
        (fileNameEmployeeId ? 1 : 0) +
        (parseNameFromFileName(fileName) ? 1 : 0) +
        allNames.length +
        allStandaloneIds.length;
      if (evidenceCount > MAX_EVIDENCE_ITEMS) {
        unmatched.push({
          fileName,
          reason: "evidence-limit",
          detail: `This PDF contains too many identifiers to attribute safely (${evidenceCount}). Split it into one payslip per employee; nothing was stored.`,
          extractedEmployeeId: pdfEmployeeIds[0] ?? null,
          extractedName: allNames[0] ?? null,
        });
        continue;
      }
      const primaryLookup = await lookupPayslipCandidates(
        db,
        { pdfEmployeeId, fileNameEmployeeId, standaloneId, candidateName },
        cache,
      );
      const evidence = new Set<string>();
      for (const candidate of [
        ...primaryLookup.fromPdfId,
        ...primaryLookup.fromFileId,
        ...primaryLookup.fromStandaloneId,
        ...primaryLookup.fromName,
      ]) {
        evidence.add(candidate.employeeDocId);
      }
      const fileNameName = parseNameFromFileName(fileName);
      const extraNames = [...allNames.slice(1)];
      if (
        fileNameName &&
        !allNames.some(
          (name) => name.toLowerCase() === fileNameName.toLowerCase(),
        )
      ) {
        extraNames.push(fileNameName);
      }
      for (const name of extraNames) {
        const extra = await lookupPayslipCandidates(db, { candidateName: name }, cache);
        for (const candidate of extra.fromName) evidence.add(candidate.employeeDocId);
      }
      for (const id of allStandaloneIds.slice(1)) {
        const extra = await lookupPayslipCandidates(db, { standaloneId: id }, cache);
        for (const candidate of extra.fromStandaloneId) evidence.add(candidate.employeeDocId);
      }
      const evidenceKinds =
        pdfEmployeeIds.length +
        (fileNameEmployeeId ? 1 : 0) +
        (fileNameName ? 1 : 0) +
        allNames.length +
        allStandaloneIds.length;
      if (evidence.size > 1 && evidenceKinds > 1) {
        unmatched.push({
          fileName,
          reason: "multiple-employees",
          detail: `This PDF contains evidence of ${evidence.size} different employees. Split it into one payslip per employee; nothing was stored.`,
          extractedEmployeeId: pdfEmployeeIds[0] ?? standaloneId ?? null,
          extractedName: allNames.join(", ") || null,
        });
        continue;
      }

      const candidates = primaryLookup;
      const match = decidePayslipMatch({ ...candidates, candidateName });
      if (match.status === "unmatched") {
        unmatched.push({
          fileName,
          reason: match.reason,
          detail: match.detail,
          extractedEmployeeId: pdfEmployeeId ?? fileNameEmployeeId ?? standaloneId ?? null,
          extractedName: candidateName ?? null,
        });
        continue;
      }

      const employee = match.employee;
      const uploadedFile: PayslipUploadedFile = {
        id: payslipDocumentId(),
        employeeDocId: employee.employeeDocId,
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        period,
        fileName,
        storagePath: null,
        sizeBytes: buffer.byteLength,
        parseMethod: match.parseMethod,
        dryRun,
      };

      if (dryRun) {
        uploaded.push(uploadedFile);
        continue;
      }

      const storagePath = buildPayslipStoragePath(employee.employeeDocId, period);
      try {
        await storage.bucket().file(storagePath).save(buffer, {
          contentType: "application/pdf",
          resumable: false,
          metadata: {
            contentType: "application/pdf",
            cacheControl: "private, no-store",
            metadata: {
              employeeDocId: employee.employeeDocId,
              period,
              uploadedBy: actor.uid,
            },
          },
        });
      } catch (error) {
        errors.push({
          fileName,
          message: `Could not store the PDF: ${error instanceof Error ? error.message : "unknown error"}`,
        });
        continue;
      }

      try {
        await db.collection(PAYSLIP_DOCUMENTS_COLLECTION).doc(uploadedFile.id).set({
          employeeDocId: employee.employeeDocId,
          employeeId: employee.employeeId,
          employeeName: employee.employeeName,
          clientName: employee.clientName ?? null,
          period,
          fileName,
          storagePath,
          sizeBytes: buffer.byteLength,
          uploadedBy: actor.uid,
          uploadedByEmail: actor.email ?? null,
          parseMethod: match.parseMethod,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (error) {
        // The object is unreachable without its document; do not leave an orphan.
        await storage.bucket().file(storagePath).delete().catch(() => undefined);
        errors.push({
          fileName,
          message: `The payslip record could not be saved: ${error instanceof Error ? error.message : "unknown error"}`,
        });
        continue;
      }

      uploaded.push({ ...uploadedFile, storagePath });
    }

    const payload: PayslipUploadResponse = {
      period,
      dryRun,
      counts: {
        uploaded: uploaded.length,
        unmatched: unmatched.length,
        errors: errors.length,
      },
      uploaded,
      unmatched,
      errors,
    };

    // A well-formed batch is always a 2xx: unmatched and failed files are
    // per-file outcomes returned in the payload, and the admin UI renders those
    // lists only on a successful response. 201 when at least one payslip was
    // stored (or matched, in a dry run); 200 when the batch ran but nothing was
    // usable. Request-level problems stay 4xx (period, no files, auth).
    return NextResponse.json(payload, {
      status: uploaded.length > 0 ? 201 : 200,
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error: any) {
    const message: string = error?.message || "Payslip upload failed.";
    const status = message === "Admin access required."
      ? 403
      : message === "Missing bearer token."
        ? 401
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
