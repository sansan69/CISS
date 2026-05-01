import * as XLSX from "xlsx";
import {
  canonicalizeDistrictName,
  inferKeralaDistrictFromText,
  isCanonicalKeralaDistrict,
  resolveKeralaDistrictFromRow,
} from "@/lib/districts";
import type {
  TcsExamParserMode,
  TcsExamSourceRow,
  TcsExamWorkbookParseResult,
  WorkOrderImportWarning,
} from "@/types/work-orders";

const EMPTY_RESULT_DATE = "";
const HEADER_SCAN_ROWS = 4;

// "Location" is intentionally only a siteName alias — TCS files often label
// the centre column "Location" while the actual district lives in a CITY or
// DISTRICT column. The keyword-scan fallback in `resolveDistrictFromRow`
// covers files that have no district column at all.
const STATIC_HEADER_ALIASES: Record<"siteId" | "siteName" | "district", string[]> = {
  siteId: ["site id", "site code", "tc code", "code", "center code"],
  siteName: [
    "site name",
    "site",
    "center",
    "centre",
    "venue",
    "location",
    "institution",
    "school",
    "place name",
    "centre name",
    "center name",
    "tc address",
    "address",
  ],
  district: ["city", "district", "area", "region", "place", "district name", "zone", "zone name"],
};

const GENERIC_TITLE_HEADERS = new Set([
  ...STATIC_HEADER_ALIASES.siteId,
  ...STATIC_HEADER_ALIASES.siteName,
  ...STATIC_HEADER_ALIASES.district,
  "zone",
  "zone name",
  "tc address",
  "address",
  "state",
  "male",
  "female",
  "sl no",
  "s no",
  "s.no",
  "no",
  "serial no",
  "sno",
]);

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function resolveDistrictFromRow(rawDistrict: unknown, row: unknown[]): string {
  const resolved = resolveKeralaDistrictFromRow(rawDistrict, row);
  if (resolved && isCanonicalKeralaDistrict(resolved)) {
    return canonicalizeDistrictName(resolved) || resolved;
  }
  return resolved || "";
}

// Re-export so call-sites that previously imported this helper from the
// parser keep compiling.
export { inferKeralaDistrictFromText };

function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function buildValidatedDate(year: number, monthIndex: number, day: number): string | null {
  const date = new Date(year, monthIndex, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null;
  }

  return formatLocalDate(date);
}

function parseDateText(text: string): string | null {
  const trimmed = text.trim();

  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return buildValidatedDate(year, month - 1, day);
  }

  const dayFirstMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (dayFirstMatch) {
    const day = Number(dayFirstMatch[1]);
    const month = Number(dayFirstMatch[2]);
    const year = Number(dayFirstMatch[3].length === 2 ? `20${dayFirstMatch[3]}` : dayFirstMatch[3]);
    return buildValidatedDate(year, month - 1, day);
  }

  const namedMonthMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s*(\d{2,4})$/) ??
    trimmed.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{2,4})$/);

  if (namedMonthMatch) {
    if (Number.isNaN(Number(namedMonthMatch[1]))) {
      const monthName = namedMonthMatch[1].toLowerCase().slice(0, 3);
      const day = Number(namedMonthMatch[2]);
      const year = Number(namedMonthMatch[3].length === 2 ? `20${namedMonthMatch[3]}` : namedMonthMatch[3]);
      const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(monthName);
      if (monthIndex >= 0) {
        return buildValidatedDate(year, monthIndex, day);
      }
    } else {
      const day = Number(namedMonthMatch[1]);
      const monthName = namedMonthMatch[2].toLowerCase().slice(0, 3);
      const year = Number(namedMonthMatch[3].length === 2 ? `20${namedMonthMatch[3]}` : namedMonthMatch[3]);
      const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(monthName);
      if (monthIndex >= 0) {
        return buildValidatedDate(year, monthIndex, day);
      }
    }
  }

  return null;
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatLocalDate(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return formatLocalDate(new Date(parsed.y, parsed.m - 1, parsed.d));
    }
  }

  if (typeof value === "string") {
    return parseDateText(value);
  }

  return null;
}

function isMaleHeader(value: unknown): boolean {
  return normalizeHeader(value) === "male";
}

function isFemaleHeader(value: unknown): boolean {
  return normalizeHeader(value) === "female";
}

function slugifyLocal(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanExamNameFromFilename(fileName: string): string {
  const baseName = normalizeText(fileName.replace(/\.[^.]+$/u, "").replace(/[_-]+/g, " "));
  if (!baseName) {
    return "TCS Exam";
  }

  const lower = baseName.toLowerCase();

  // Try to find " for " which typically precedes the exam name in TCS filenames
  // e.g. "Adhoc Security Guards Requirment for NTA CUET PG Exam from 06 to 27 Mar 2026"
  let candidate = "";
  const forIndex = lower.indexOf(" for ");
  if (forIndex >= 0) {
    candidate = baseName.slice(forIndex + 5);
  } else {
    // Fallback: if no " for ", try " - " separator
    const dashIndex = lower.indexOf(" - ");
    if (dashIndex >= 0) {
      candidate = baseName.slice(dashIndex + 3);
    } else {
      candidate = baseName;
    }
  }

  // Remove common prefixes
  candidate = candidate
    .replace(/^copy of\s+/i, "")
    .replace(/^revised\s+\d*\s+/i, "")
    .replace(/^\s*(ad hoc|adhoc)\s+/i, "")
    .replace(/^\s*(security guards?|requirement|requirment)\s+/i, "")
    .replace(/\s+(?:scheduled on|scheduled|which is scheduled|on|from|dated)\s+.*$/i, "")
    .replace(/\s+-\s+copy.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return candidate || "TCS Exam";
}

function cleanTitleText(value: string): string {
  return normalizeText(value).replace(/^[\s:;,.–-]+/u, "");
}

function countDateLikeCells(row: unknown[] | undefined): number {
  return (row ?? []).reduce<number>((count, cell) => count + (toIsoDate(cell) ? 1 : 0), 0);
}

function findHeaderRowIndex(rows: unknown[][]): number {
  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index += 1) {
    const normalized = rows[index].map(normalizeHeader);
    const hasMale = normalized.some((cell) => cell === "male");
    const hasFemale = normalized.some((cell) => cell === "female");
    const hasStaticHeader = normalized.some((cell) =>
      STATIC_HEADER_ALIASES.siteName.includes(cell) ||
      STATIC_HEADER_ALIASES.district.includes(cell) ||
      STATIC_HEADER_ALIASES.siteId.includes(cell)
    );

    if (hasMale && hasFemale && hasStaticHeader) {
      return index;
    }
  }

  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index += 1) {
    const normalized = rows[index].map(normalizeHeader);
    const hasMale = normalized.some((cell) => cell === "male");
    const hasFemale = normalized.some((cell) => cell === "female");
    if (hasMale && hasFemale) {
      return index;
    }
  }

  return 1;
}

function resolveStaticHeaderIndices(rows: unknown[][], headerRowIndex: number): Record<"siteId" | "siteName" | "district", number | null> {
  const headerRow = rows[headerRowIndex] ?? [];
  const mergedHeaderRow = rows.length > headerRowIndex + 1 ? rows[headerRowIndex + 1] ?? [] : [];
  const resolved: Record<"siteId" | "siteName" | "district", number | null> = {
    siteId: null,
    siteName: null,
    district: null,
  };

  for (let index = 0; index < headerRow.length; index += 1) {
    const candidates = [headerRow[index], mergedHeaderRow[index]];
    const normalized = candidates.map(normalizeHeader).find((value) => value !== "");
    if (!normalized) {
      continue;
    }

    // Prefer siteId, then siteName, then district. Never assign two roles to
    // the same column (prevents "Location" from also being treated as district
    // when it's already serving as siteName).
    if (resolved.siteId === null && STATIC_HEADER_ALIASES.siteId.includes(normalized)) {
      resolved.siteId = index;
      continue;
    }
    if (resolved.siteName === null && STATIC_HEADER_ALIASES.siteName.includes(normalized)) {
      resolved.siteName = index;
      continue;
    }
    if (resolved.district === null && STATIC_HEADER_ALIASES.district.includes(normalized)) {
      resolved.district = index;
      continue;
    }
  }

  return resolved;
}

function extractCellNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(normalizeText(value));
  return Number.isFinite(num) ? num : 0;
}

function pickFirstNonEmptyText(values: unknown[]): string {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function isGenericExamName(value: string): boolean {
  const lower = normalizeHeader(value);
  // Reject very short names, single words, or names that look like headers
  if (lower.length < 3) return true;
  if (lower.split(/\s+/).length < 2) return true;
  if (GENERIC_TITLE_HEADERS.has(lower)) return true;
  // Reject names that are just dates or numbers
  if (/^\d+$/.test(lower)) return true;
  if (/^\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4}$/.test(lower)) return true;
  return false;
}

function extractExamName(rows: unknown[][], fileName: string): string {
  // TCS work-order sheets often contain generic operational headers like
  // "ZONE" or "TC Address" in the first rows. The exam identity is the file
  // name, so prefer that whenever it provides a concrete exam label.
  // Reject generic single-word residues left over from filenames like
  // "Adhoc Security guard requirement.xlsx" → "requirement". The row-title
  // fallback below handles those cases.
  const fileExamName = cleanExamNameFromFilename(fileName);
  if (fileExamName && fileExamName !== "TCS Exam" && !isGenericExamName(fileExamName)) {
    return fileExamName;
  }

  // 1. Look for explicit "Exam Name:" in the first 2 rows (legacy format)
  for (const row of rows.slice(0, 2)) {
    for (const cell of row) {
      const text = normalizeText(cell);
      if (!text) continue;
      const match = text.match(/exam\s*name\s*[:\-–\s]*([^\r\n]+)$/i);
      if (match?.[1]) {
        const cleaned = cleanTitleText(match[1]);
        if (!isGenericExamName(cleaned)) {
          return cleaned;
        }
      }
    }
  }

  // 2. Try to extract from sheet title row — but reject if it looks like a header
  const firstRow = rows[0] ?? [];
  const candidate = pickFirstNonEmptyText(firstRow.filter((cell) => {
    const text = normalizeHeader(cell);
    return text !== "" && !toIsoDate(cell) && !GENERIC_TITLE_HEADERS.has(text);
  }));
  if (candidate && !isGenericExamName(candidate)) {
    return cleanTitleText(candidate);
  }

  for (const row of rows.slice(1, 2)) {
    const fallback = pickFirstNonEmptyText(row.filter((cell) => {
      const text = normalizeHeader(cell);
      return text !== "" && !toIsoDate(cell) && !GENERIC_TITLE_HEADERS.has(text);
    }));
    if (fallback && !isGenericExamName(fallback)) {
      return cleanTitleText(fallback);
    }
  }

  // 3. Fall back to filename — for TCS files this is the primary source
  return cleanExamNameFromFilename(fileName);
}

function buildWarnings(rows: unknown[][], parserMode: TcsExamParserMode): WorkOrderImportWarning[] {
  const warnings: WorkOrderImportWarning[] = [];
  if (rows.length === 0) {
    warnings.push({
      code: "empty_sheet",
      message: "The selected workbook did not contain any rows.",
    });
    return warnings;
  }

  if (parserMode === "pivot-date-sheet" && countDateLikeCells(rows[0]) === 0) {
    warnings.push({
      code: "missing_date_headers",
      message: "The pivot-date sheet did not expose any date columns in the first row.",
      rowNumber: 1,
    });
  }

  return warnings;
}

function buildRowBase(
  row: unknown[],
  rowNumber: number,
  staticIndices: Record<"siteId" | "siteName" | "district", number | null>,
  examName: string,
  examCode: string,
  date: string,
  sourceSheetName: string,
): TcsExamSourceRow | null {
  const siteName = normalizeText(staticIndices.siteName === null ? "" : row[staticIndices.siteName]) ||
    normalizeText(staticIndices.siteId === null ? "" : row[staticIndices.siteId]);
  const rawDistrict = staticIndices.district === null ? "" : row[staticIndices.district];
  const district = resolveDistrictFromRow(rawDistrict, row);
  const siteId = staticIndices.siteId === null ? "" : normalizeText(row[staticIndices.siteId]);

  if (!siteName) {
    return null;
  }

  return {
    siteId: siteId || undefined,
    siteName,
    district,
    date,
    maleGuardsRequired: 0,
    femaleGuardsRequired: 0,
    examName,
    examCode,
    sourceRowNumber: rowNumber,
    sourceSheetName,
  };
}

function findLegacyDataCellIndex(headerRow: unknown[], aliases: string[]): number | null {
  for (let index = 0; index < headerRow.length; index += 1) {
    const normalized = normalizeHeader(headerRow[index]);
    if (aliases.includes(normalized)) {
      return index;
    }
  }
  return null;
}

function parseLegacySheet(
  rows: unknown[][],
  fileName: string,
  sourceSheetName: string,
): TcsExamWorkbookParseResult {
  const headerRowIndex = findHeaderRowIndex(rows);
  const headerRow = rows[headerRowIndex] ?? [];
  const date = rows
    .slice(0, headerRowIndex + 1)
    .flatMap((row) => row)
    .map(toIsoDate)
    .find((value): value is string => Boolean(value)) ?? EMPTY_RESULT_DATE;

  const examName = extractExamName(rows, fileName);
  const examCode = slugifyLocal(examName);
  const staticIndices = resolveStaticHeaderIndices(rows, headerRowIndex);
  const maleIndex = findLegacyDataCellIndex(headerRow, ["male"]);
  const femaleIndex = findLegacyDataCellIndex(headerRow, ["female"]);

  const parsedRows: TcsExamSourceRow[] = [];
  const warnings: WorkOrderImportWarning[] = [];

  if (!date) {
    warnings.push({
      code: "missing_date",
      message: "The legacy sheet did not contain a parseable exam date.",
      rowNumber: headerRowIndex + 1,
      sheetName: sourceSheetName,
    });
  }

  if (maleIndex === null || femaleIndex === null) {
    throw new Error("Could not find male and female columns in the legacy TCS sheet.");
  }

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const rowNumber = rowIndex + 1;
    const base = buildRowBase(row, rowNumber, staticIndices, examName, examCode, date, sourceSheetName);
    if (!base) {
      continue;
    }

    const maleGuardsRequired = extractCellNumber(row[maleIndex]);
    const femaleGuardsRequired = extractCellNumber(row[femaleIndex]);
    if (maleGuardsRequired + femaleGuardsRequired <= 0) {
      continue;
    }

    parsedRows.push({
      ...base,
      maleGuardsRequired,
      femaleGuardsRequired,
    });
  }

  const dates = Array.from(new Set(parsedRows.map((row) => row.date))).sort();
  return {
    parserMode: "legacy-sheet",
    suggestedExamName: examName,
    suggestedExamCode: examCode,
    dateRange: {
      from: dates[0] ?? date,
      to: dates[dates.length - 1] ?? date,
    },
    dates,
    rows: parsedRows,
    siteCount: new Set(parsedRows.map((row) => `${row.siteId ?? ""}|${row.siteName}|${row.district}`)).size,
    rowCount: parsedRows.length,
    totalMale: parsedRows.reduce((sum, row) => sum + row.maleGuardsRequired, 0),
    totalFemale: parsedRows.reduce((sum, row) => sum + row.femaleGuardsRequired, 0),
    warnings: [...warnings, ...buildWarnings(rows, "legacy-sheet")],
  };
}

function findPivotDateBlocks(row0: unknown[], row1: unknown[]): Array<{ date: string; maleIndex: number; femaleIndex: number }> {
  const blocks: Array<{ date: string; maleIndex: number; femaleIndex: number }> = [];

  for (let index = 0; index < row0.length; index += 1) {
    const date = toIsoDate(row0[index]);
    if (!date) {
      continue;
    }

    let maleIndex: number | null = null;
    let femaleIndex: number | null = null;
    for (let offset = 0; offset < 4 && index + offset < row1.length; offset += 1) {
      const currentIndex = index + offset;
      if (maleIndex === null && isMaleHeader(row1[currentIndex])) {
        maleIndex = currentIndex;
      }
      if (femaleIndex === null && isFemaleHeader(row1[currentIndex])) {
        femaleIndex = currentIndex;
      }
    }

    if (maleIndex !== null && femaleIndex !== null) {
      blocks.push({ date, maleIndex, femaleIndex });
    }
  }

  return blocks;
}

function parsePivotSheet(
  rows: unknown[][],
  fileName: string,
  sourceSheetName: string,
): TcsExamWorkbookParseResult {
  const headerRow0 = rows[0] ?? [];
  const headerRow1 = rows[1] ?? [];
  const firstDateIndex = headerRow0.findIndex((cell) => Boolean(toIsoDate(cell)));

  if (firstDateIndex < 0) {
    throw new Error("Could not find date columns in the pivot TCS sheet.");
  }

  const staticIndices: Record<"siteId" | "siteName" | "district", number | null> = {
    siteId: null,
    siteName: null,
    district: null,
  };

  for (let index = 0; index < firstDateIndex; index += 1) {
    const label = normalizeHeader(headerRow0[index] || headerRow1[index]);
    if (!label) {
      continue;
    }
    if (staticIndices.siteId === null && STATIC_HEADER_ALIASES.siteId.includes(label)) {
      staticIndices.siteId = index;
    }
    if (staticIndices.siteName === null && STATIC_HEADER_ALIASES.siteName.includes(label)) {
      staticIndices.siteName = index;
    }
    if (staticIndices.district === null && STATIC_HEADER_ALIASES.district.includes(label)) {
      staticIndices.district = index;
    }
  }

  const dateBlocks = findPivotDateBlocks(headerRow0, headerRow1);
  const examName = extractExamName(rows, fileName);
  const examCode = slugifyLocal(examName);
  const parsedRows: TcsExamSourceRow[] = [];

  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const rowNumber = rowIndex + 1;

    const baseSiteName = (staticIndices.siteName === null ? "" : normalizeText(row[staticIndices.siteName])) ||
      (staticIndices.siteId === null ? "" : normalizeText(row[staticIndices.siteId]));
    const baseRawDistrict = staticIndices.district === null ? "" : row[staticIndices.district];
    const baseDistrict = resolveDistrictFromRow(baseRawDistrict, row);
    const baseSiteId = staticIndices.siteId === null ? "" : normalizeText(row[staticIndices.siteId]);

    if (!baseSiteName) {
      continue;
    }

    for (const block of dateBlocks) {
      const maleGuardsRequired = extractCellNumber(row[block.maleIndex]);
      const femaleGuardsRequired = extractCellNumber(row[block.femaleIndex]);
      if (maleGuardsRequired + femaleGuardsRequired <= 0) {
        continue;
      }

      parsedRows.push({
        siteId: baseSiteId || undefined,
        siteName: baseSiteName,
        district: baseDistrict,
        date: block.date,
        maleGuardsRequired,
        femaleGuardsRequired,
        examName,
        examCode,
        sourceRowNumber: rowNumber,
        sourceSheetName,
      });
    }
  }

  const dates = Array.from(new Set(parsedRows.map((row) => row.date))).sort();
  return {
    parserMode: "pivot-date-sheet",
    suggestedExamName: examName,
    suggestedExamCode: examCode,
    dateRange: {
      from: dates[0] ?? "",
      to: dates[dates.length - 1] ?? "",
    },
    dates,
    rows: parsedRows,
    siteCount: new Set(parsedRows.map((row) => `${row.siteId ?? ""}|${row.siteName}|${row.district}`)).size,
    rowCount: parsedRows.length,
    totalMale: parsedRows.reduce((sum, row) => sum + row.maleGuardsRequired, 0),
    totalFemale: parsedRows.reduce((sum, row) => sum + row.femaleGuardsRequired, 0),
    warnings: buildWarnings(rows, "pivot-date-sheet"),
  };
}

function detectParserMode(rows: unknown[][]): TcsExamParserMode {
  const firstRowDateCount = countDateLikeCells(rows[0]);
  const secondRowHasMaleFemale = (rows[1] ?? []).some((cell) => isMaleHeader(cell) || isFemaleHeader(cell));
  const firstRowHasStaticHeaders = (rows[0] ?? []).some((cell) => {
    const normalized = normalizeHeader(cell);
    return (
      STATIC_HEADER_ALIASES.siteId.includes(normalized) ||
      STATIC_HEADER_ALIASES.siteName.includes(normalized) ||
      STATIC_HEADER_ALIASES.district.includes(normalized)
    );
  });
  return firstRowDateCount >= 1 && secondRowHasMaleFemale && firstRowHasStaticHeaders
    ? "pivot-date-sheet"
    : "legacy-sheet";
}

export function parseTcsExamWorkbook(
  workbook: XLSX.WorkBook,
  fileName: string,
): TcsExamWorkbookParseResult {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("The workbook does not contain any sheets.");
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Could not read sheet "${sheetName}".`);
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
  }) as unknown[][];

  if (rows.length === 0) {
    const suggestedExamName = cleanExamNameFromFilename(fileName);
    const suggestedExamCode = slugifyLocal(suggestedExamName);
    return {
      parserMode: "legacy-sheet",
      suggestedExamName,
      suggestedExamCode,
      dateRange: { from: EMPTY_RESULT_DATE, to: EMPTY_RESULT_DATE },
      dates: [],
      rows: [],
      siteCount: 0,
      rowCount: 0,
      totalMale: 0,
      totalFemale: 0,
      warnings: [
        {
          code: "empty_sheet",
          message: "The selected workbook did not contain any rows.",
        },
      ],
    };
  }

  const parserMode = detectParserMode(rows);
  return parserMode === "pivot-date-sheet"
    ? parsePivotSheet(rows, fileName, sheetName)
    : parseLegacySheet(rows, fileName, sheetName);
}
