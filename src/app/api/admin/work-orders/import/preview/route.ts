import { NextResponse } from "next/server";
import readXlsxFile from "read-excel-file/node";
import { parse as parseCsv } from "csv-parse/sync";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { OPERATIONAL_CLIENT_NAME } from "@/lib/constants";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";
import { parseTcsExamWorkbook } from "@/lib/work-orders/tcs-exam-parser";
import {
  buildBinaryFileHash,
  buildTcsExamContentHash,
} from "@/lib/work-orders/tcs-exam-hash";
import { buildTcsExamDiff } from "@/lib/work-orders/tcs-exam-diff";
import {
  buildSiteLookupMaps,
  resolveParsedRowSiteIds,
} from "@/lib/work-orders/tcs-site-resolver";
import type {
  TcsExamExistingWorkOrder,
  TcsExamImportPreviewPayload,
  TcsExamSourceRow,
  TcsExamWorkbookParseResult,
  WorkOrderImportDuplicateState,
  WorkOrderImportMode,
} from "@/types/work-orders";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILES = 10;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_SHEETS_PER_FILE = 20;
const MAX_ROWS_PER_SHEET = 5_000;
const MAX_COLUMNS_PER_SHEET = 100;

const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
});

type FirestoreTimestampLike = {
  toDate?: () => Date;
};

function normalizeMode(value: FormDataEntryValue | null): WorkOrderImportMode {
  return value === "revision" ? "revision" : "new";
}

function normalizeExamCode(value: FormDataEntryValue | null): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().toLowerCase()
    : "";
}

async function readTabularWorkbook(file: File, buffer: Buffer) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".xls")) {
    throw new Error(
      `${file.name}: legacy .xls files are not accepted. Open the file in Excel and save it as .xlsx.`,
    );
  }

  let sheets: Array<{ sheet: string; data: unknown[][] }>;
  if (lowerName.endsWith(".csv")) {
    const rows = parseCsv(buffer, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
    }) as unknown[][];
    sheets = [{ sheet: "CSV", data: rows }];
  } else if (lowerName.endsWith(".xlsx")) {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new Error(`${file.name}: the file is not a valid .xlsx workbook.`);
    }
    sheets = (await readXlsxFile(buffer)).map(({ sheet, data }) => ({
      sheet,
      data: data as unknown[][],
    }));
  } else {
    throw new Error(`${file.name}: only .xlsx and .csv work-order files are accepted.`);
  }

  if (sheets.length === 0 || sheets.length > MAX_SHEETS_PER_FILE) {
    throw new Error(
      `${file.name}: workbook must contain between 1 and ${MAX_SHEETS_PER_FILE} sheets.`,
    );
  }
  for (const sheet of sheets) {
    if (sheet.data.length > MAX_ROWS_PER_SHEET) {
      throw new Error(
        `${file.name}: sheet "${sheet.sheet}" exceeds ${MAX_ROWS_PER_SHEET.toLocaleString()} rows.`,
      );
    }
    if (sheet.data.some((row) => row.length > MAX_COLUMNS_PER_SHEET)) {
      throw new Error(
        `${file.name}: sheet "${sheet.sheet}" exceeds ${MAX_COLUMNS_PER_SHEET} columns.`,
      );
    }
  }

  return {
    SheetNames: sheets.map((sheet) => sheet.sheet),
    Sheets: Object.fromEntries(sheets.map((sheet) => [sheet.sheet, sheet.data])),
  };
}

function normalizeRecordStatus(value: unknown): string {
  return String(value ?? "active").trim().toLowerCase();
}

function isActiveRecordStatus(value: unknown): boolean {
  return normalizeRecordStatus(value) === "active";
}

function normalizeSegment(value: string | number | undefined | null): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function combineParsedFiles(
  parsedFiles: Array<{ fileName: string; result: TcsExamWorkbookParseResult }>,
): TcsExamWorkbookParseResult {
  const first = parsedFiles[0]?.result;
  if (!first) {
    throw new Error("At least one workbook file is required.");
  }

  const rows: TcsExamSourceRow[] = [];
  const warnings = parsedFiles.flatMap(({ fileName, result }) =>
    result.warnings.map((warning) => ({ ...warning, fileName })),
  );
  const seenRows = new Map<string, TcsExamSourceRow>();
  for (const { fileName, result } of parsedFiles) {
    for (const sourceRow of result.rows) {
      const row = { ...sourceRow, sourceFileName: fileName };
      const key = getIdentityKey(row);
      const existing = seenRows.get(key);
      if (!existing) {
        seenRows.set(key, row);
        rows.push(row);
        continue;
      }
      if (
        existing.maleGuardsRequired !== row.maleGuardsRequired ||
        existing.femaleGuardsRequired !== row.femaleGuardsRequired
      ) {
        throw new Error(
          `Conflicting guard requirements were found for ${row.siteName} on ${row.date} across uploaded files.`,
        );
      }
      warnings.push({
        code: "duplicate_file_row",
        message: `Duplicate row for ${row.siteName} on ${row.date} in ${fileName} was ignored.`,
        fileName,
        rowNumber: row.sourceRowNumber,
        sheetName: row.sourceSheetName,
      });
    }
  }

  const dates = Array.from(new Set(rows.map((row) => row.date))).sort();
  return {
    parserMode:
      parsedFiles.length > 1 || parsedFiles.some(({ result }) => result.parserMode === "mixed-workbook")
        ? "mixed-workbook"
        : first.parserMode,
    suggestedExamName: first.suggestedExamName,
    suggestedExamCode: first.suggestedExamCode,
    dateRange: {
      from: dates[0] ?? "",
      to: dates[dates.length - 1] ?? "",
    },
    dates,
    rows,
    siteCount: new Set(
      rows.map((row) => `${row.siteId ?? ""}|${row.siteName}|${row.district}`),
    ).size,
    rowCount: rows.length,
    totalMale: rows.reduce((sum, row) => sum + row.maleGuardsRequired, 0),
    totalFemale: rows.reduce((sum, row) => sum + row.femaleGuardsRequired, 0),
    warnings,
  };
}

function hasConcreteSiteId(row: {
  siteId?: string;
}) {
  return normalizeSegment(row.siteId) !== "";
}

function getIdentityKey(row: {
  siteId?: string;
  siteName: string;
  district: string;
  date: string;
  examCode?: string;
}) {
  const siteKey = hasConcreteSiteId(row)
    ? `site-id:${normalizeSegment(row.siteId)}`
    : `site-fallback:${normalizeSegment(row.siteName)}|district:${normalizeSegment(row.district)}`;

  return `${siteKey}|date:${row.date.trim().toLowerCase()}|exam:${String(
    row.examCode ?? "",
  )
    .trim()
    .toLowerCase()}`;
}

function getFallbackIdentityKey(row: {
  siteName: string;
  district: string;
  date: string;
  examCode?: string;
}) {
  return `site-fallback:${normalizeSegment(row.siteName)}|district:${normalizeSegment(
    row.district,
  )}|date:${normalizeSegment(row.date)}|exam:${normalizeSegment(row.examCode)}`;
}

function findMatchingExistingRow(
  parsedRow: TcsExamSourceRow,
  existingRows: readonly TcsExamExistingWorkOrder[],
) {
  if (hasConcreteSiteId(parsedRow)) {
    const exactMatch = existingRows.find(
      (row) => hasConcreteSiteId(row) && getIdentityKey(row) === getIdentityKey(parsedRow),
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  const fallbackKey = getFallbackIdentityKey(parsedRow);
  return existingRows.find((row) => {
    if (hasConcreteSiteId(parsedRow) && hasConcreteSiteId(row)) {
      return false;
    }
    return getFallbackIdentityKey(row) === fallbackKey;
  });
}

function hasIdentityOverlap(
  parsedRows: readonly TcsExamSourceRow[],
  existingRows: readonly TcsExamExistingWorkOrder[],
) {
  return parsedRows.some((row) => Boolean(findMatchingExistingRow(row, existingRows)));
}

function toDateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (value && typeof (value as FirestoreTimestampLike).toDate === "function") {
    const converted = (value as FirestoreTimestampLike).toDate?.();
    if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
      return converted;
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function toIsoDate(value: unknown): string {
  const parsed = toDateValue(value);
  if (!parsed) {
    return "";
  }

  return IST_DATE_FORMATTER.format(parsed);
}

async function fetchExistingRows(
  adminDb: {
    collection: (name: string) => {
      get: () => Promise<{
        docs: Array<{ id: string; data: () => Record<string, unknown> }>;
      }>;
    };
  },
  parsedRows: readonly TcsExamSourceRow[],
): Promise<TcsExamExistingWorkOrder[]> {
  if (parsedRows.length === 0) {
    return [];
  }

  const workOrdersSnapshot = await adminDb.collection("workOrders").get();

  const relevantExamCodes = new Set(parsedRows.map((row) => row.examCode ?? "").filter(Boolean));

  const mappedRows: Array<TcsExamExistingWorkOrder & { clientName: string }> =
    workOrdersSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        clientName: typeof data.clientName === "string" ? data.clientName : "",
        siteId: typeof data.siteId === "string" ? data.siteId : undefined,
        siteName: String(data.siteName ?? ""),
        district: String(data.district ?? ""),
        date: toIsoDate(data.date),
        examName: typeof data.examName === "string" ? data.examName : undefined,
        examCode: String(data.examCode ?? ""),
        maleGuardsRequired: Number(data.maleGuardsRequired ?? 0),
        femaleGuardsRequired: Number(data.femaleGuardsRequired ?? 0),
        totalManpower: Number(data.totalManpower ?? 0),
        recordStatus: normalizeRecordStatus(data.recordStatus),
      };
    });

  return mappedRows
    .filter((row) => isOperationalWorkOrderClientName(row.clientName))
    .map(({ clientName: _clientName, ...row }) => row)
    .filter((row) => row.date !== "")
    .filter((row) =>
      relevantExamCodes.size === 0 ? true : relevantExamCodes.has(row.examCode),
    );
}

function scopeExistingRowsForRevision(
  existingRows: readonly TcsExamExistingWorkOrder[],
  parsedRows: readonly TcsExamSourceRow[],
  mode: WorkOrderImportMode,
): TcsExamExistingWorkOrder[] {
  if (mode !== "revision" || parsedRows.length === 0) {
    return [...existingRows];
  }

  const dates = parsedRows.map((row) => row.date).filter(Boolean).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  if (!from || !to) return [];

  return existingRows.filter((row) => row.date >= from && row.date <= to);
}

async function hasActiveRowsForField(
  adminDb: {
    collection: (name: string) => {
      where: (field: string, op: "==", value: unknown) => any;
    };
  },
  field: "importId" | "binaryFileHash" | "contentHash",
  value: string,
): Promise<boolean> {
  if (!value) return false;
  const snapshot = await adminDb
    .collection("workOrders")
    .where(field, "==", value)
    .get();
  return snapshot.docs.some((doc: { data: () => Record<string, unknown> }) =>
    isActiveRecordStatus(doc.data().recordStatus),
  );
}

async function hasActiveRowsForImportDuplicate(
  adminDb: {
    collection: (name: string) => {
      where: (field: string, op: "==", value: unknown) => any;
    };
  },
  importSnapshot: {
    docs?: Array<{ id: string; data: () => Record<string, unknown> }>;
  },
  hashField: "binaryFileHash" | "contentHash",
  hash: string,
  parsedRows: readonly TcsExamSourceRow[],
  existingRows: readonly TcsExamExistingWorkOrder[],
): Promise<boolean> {
  if (await hasActiveRowsForField(adminDb, hashField, hash)) {
    return true;
  }

  if (
    hasIdentityOverlap(
      parsedRows,
      existingRows.filter((row) => isActiveRecordStatus(row.recordStatus)),
    )
  ) {
    return true;
  }

  const importDocs = Array.isArray(importSnapshot.docs) ? importSnapshot.docs : [];
  for (const importDoc of importDocs) {
    if (await hasActiveRowsForField(adminDb, "importId", importDoc.id)) {
      return true;
    }

    const data = importDoc.data();
    const alternateBinaryHash = typeof data.binaryFileHash === "string" ? data.binaryFileHash.trim() : "";
    const alternateContentHash = typeof data.contentHash === "string" ? data.contentHash.trim() : "";
    if (
      hashField !== "binaryFileHash" &&
      (await hasActiveRowsForField(adminDb, "binaryFileHash", alternateBinaryHash))
    ) {
      return true;
    }
    if (
      hashField !== "contentHash" &&
      (await hasActiveRowsForField(adminDb, "contentHash", alternateContentHash))
    ) {
      return true;
    }
  }

  return false;
}

async function detectDuplicateState(
  adminDb: {
    collection: (name: string) => {
      where: (field: string, op: "==", value: unknown) => any;
      limit: (count: number) => any;
      get: () => Promise<{ empty: boolean }>;
    };
  },
  binaryFileHash: string,
  contentHash: string,
  parsedRows: readonly TcsExamSourceRow[],
  existingRows: readonly TcsExamExistingWorkOrder[],
): Promise<{
  duplicateState: WorkOrderImportDuplicateState;
  duplicateMessage?: string;
}> {
  const binaryDuplicateSnap = await adminDb
    .collection("workOrderImports")
    .where("binaryFileHash", "==", binaryFileHash)
    .limit(1)
    .get();
  if (
    !binaryDuplicateSnap.empty &&
    (await hasActiveRowsForImportDuplicate(
      adminDb,
      binaryDuplicateSnap,
      "binaryFileHash",
      binaryFileHash,
      parsedRows,
      existingRows,
    ))
  ) {
    return {
      duplicateState: "binary-duplicate",
      duplicateMessage: "This exact workbook file has already been imported.",
    };
  }

  const contentDuplicateSnap = await adminDb
    .collection("workOrderImports")
    .where("contentHash", "==", contentHash)
    .limit(1)
    .get();
  if (
    !contentDuplicateSnap.empty &&
    (await hasActiveRowsForImportDuplicate(
      adminDb,
      contentDuplicateSnap,
      "contentHash",
      contentHash,
      parsedRows,
      existingRows,
    ))
  ) {
    return {
      duplicateState: "content-duplicate",
      duplicateMessage: "A prior import already contains the same normalized TCS exam rows.",
    };
  }

  const hasOverlap = hasIdentityOverlap(
    parsedRows,
    existingRows.filter((row) => isActiveRecordStatus(row.recordStatus)),
  );
  if (hasOverlap) {
    return {
      duplicateState: "overlap",
      duplicateMessage:
        "Active TCS exam work orders already exist for this exam/date range. Use revision mode if you intend to cancel missing rows.",
    };
  }

  return { duplicateState: "none" };
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const formData = await request.formData();
    const multiFiles = formData.getAll("files").filter((value): value is File => value instanceof File);
    const legacyFile = formData.get("file");
    const files =
      multiFiles.length > 0
        ? multiFiles
        : legacyFile instanceof File
          ? [legacyFile]
          : [];
    if (files.length === 0) {
      return NextResponse.json(
        { error: "At least one workbook file is required." },
        { status: 400 },
      );
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Upload at most ${MAX_FILES} work-order files at a time.` },
        { status: 400 },
      );
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (files.some((file) => file.size <= 0 || file.size > MAX_FILE_BYTES)) {
      return NextResponse.json(
        { error: `Each work-order file must be no larger than ${MAX_FILE_BYTES / 1024 / 1024}MB.` },
        { status: 400 },
      );
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        { error: `The combined upload must be no larger than ${MAX_TOTAL_BYTES / 1024 / 1024}MB.` },
        { status: 400 },
      );
    }

    const mode = normalizeMode(formData.get("mode"));
    const targetExamCode = normalizeExamCode(formData.get("targetExamCode"));
    const targetExamNameValue = formData.get("targetExamName");
    const targetExamName =
      typeof targetExamNameValue === "string"
        ? targetExamNameValue.replace(/\s+/g, " ").trim()
        : "";
    const parsedFiles = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const workbook = await readTabularWorkbook(file, buffer);
      parsedFiles.push({
        fileName: file.name,
        buffer,
        result: parseTcsExamWorkbook(workbook, file.name),
      });
    }
    const rawParseResult = combineParsedFiles(parsedFiles);
    const effectiveExamCode =
      mode === "revision"
        ? targetExamCode || rawParseResult.suggestedExamCode
        : rawParseResult.suggestedExamCode;
    const effectiveExamName =
      mode === "revision" && targetExamName
        ? targetExamName
        : rawParseResult.suggestedExamName;
    const parseResult = {
      ...rawParseResult,
      suggestedExamName: effectiveExamName,
      suggestedExamCode: effectiveExamCode,
      rows: rawParseResult.rows.map((row) => ({
        ...row,
        examName: effectiveExamName,
        examCode: effectiveExamCode,
      })),
    };
    const combinedBinary = Buffer.concat(
      [...parsedFiles]
        .sort((left, right) => left.fileName.localeCompare(right.fileName))
        .flatMap(({ fileName, buffer }) => [
          Buffer.from(fileName, "utf8"),
          Buffer.from([0]),
          buffer,
          Buffer.from([0]),
        ]),
    );
    const binaryFileHash = buildBinaryFileHash(combinedBinary);
    const contentHash = buildTcsExamContentHash(
      parseResult.suggestedExamCode,
      parseResult.rows.map((row) => ({
        siteId: row.siteId,
        siteName: row.siteName,
        district: row.district,
        date: row.date,
        examCode: row.examCode ?? parseResult.suggestedExamCode,
        maleGuardsRequired: row.maleGuardsRequired,
        femaleGuardsRequired: row.femaleGuardsRequired,
      })),
    );

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // Resolve TC centre codes → Firestore site document IDs so that
    // diff identity keys match the siteId stored on existing work orders.
    const siteLookupMaps = await buildSiteLookupMaps(adminDb);
    const resolvedParsedRows = resolveParsedRowSiteIds(
      parseResult.rows,
      siteLookupMaps,
    );

    const fetchedExistingRows = await fetchExistingRows(adminDb, resolvedParsedRows);
    const existingRows = scopeExistingRowsForRevision(
      fetchedExistingRows,
      resolvedParsedRows,
      mode,
    );
    const activeExistingRows = existingRows.filter((row) =>
      isActiveRecordStatus(row.recordStatus),
    );
    const diffRows = buildTcsExamDiff({
      parsedRows: resolvedParsedRows,
      existingRows: activeExistingRows,
      mode,
    });
    const duplicate = await detectDuplicateState(
      adminDb,
      binaryFileHash,
      contentHash,
      resolvedParsedRows,
      existingRows,
    );

    // Return the *original* parse result (with TC codes) so the client
    // sends back the same rows. The commit route will resolve site IDs
    // again before writing.
    const payload: TcsExamImportPreviewPayload = {
      ...parseResult,
      rows: parseResult.rows,
      mode,
      targetExamCode: mode === "revision" ? effectiveExamCode : undefined,
      fileNames: files.map((file) => file.name),
      binaryFileHash,
      contentHash,
      duplicateState: duplicate.duplicateState,
      duplicateMessage: duplicate.duplicateMessage,
      diffRows,
    };

    return NextResponse.json(payload);
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    if (
      error?.message?.includes("Missing bearer") ||
      error?.message?.includes("token")
    ) {
      return unauthorizedResponse(error.message, 401);
    }
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
