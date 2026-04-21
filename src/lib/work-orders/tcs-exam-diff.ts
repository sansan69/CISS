import type {
  TcsExamDiffRow,
  TcsExamExistingWorkOrder,
  TcsExamSourceRow,
  WorkOrderImportMode,
} from "@/types/work-orders";

export interface BuildTcsExamDiffInput {
  parsedRows: readonly TcsExamSourceRow[];
  existingRows: readonly TcsExamExistingWorkOrder[];
  mode: WorkOrderImportMode;
}

function normalizeSegment(value: string | number | undefined | null): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasSiteId(row: TcsExamSourceRow | TcsExamExistingWorkOrder): row is (TcsExamSourceRow | TcsExamExistingWorkOrder) & { siteId: string } {
  return normalizeSegment(row.siteId) !== "";
}

function getSiteKey(row: TcsExamSourceRow | TcsExamExistingWorkOrder): string {
  if (hasSiteId(row)) {
    return `site-id:${normalizeSegment(row.siteId)}`;
  }

  return `site-fallback:${normalizeSegment(row.siteName)}|district:${normalizeSegment(row.district)}`;
}

function getIdentityKey(row: TcsExamSourceRow | TcsExamExistingWorkOrder): string {
  return `${getSiteKey(row)}|date:${normalizeSegment(row.date)}|exam:${normalizeSegment(row.examCode)}`;
}

function getFallbackKey(row: TcsExamSourceRow | TcsExamExistingWorkOrder): string {
  return `site-fallback:${normalizeSegment(row.siteName)}|district:${normalizeSegment(row.district)}|date:${normalizeSegment(row.date)}|exam:${normalizeSegment(row.examCode)}`;
}

function sameCounts(a: TcsExamSourceRow | TcsExamExistingWorkOrder, b: TcsExamSourceRow | TcsExamExistingWorkOrder): boolean {
  return Number(a.maleGuardsRequired) === Number(b.maleGuardsRequired) &&
    Number(a.femaleGuardsRequired) === Number(b.femaleGuardsRequired);
}

function sameNamedFields(a: TcsExamSourceRow | TcsExamExistingWorkOrder, b: TcsExamSourceRow | TcsExamExistingWorkOrder): boolean {
  return normalizeSegment(a.siteName) === normalizeSegment(b.siteName) &&
    normalizeSegment(a.district) === normalizeSegment(b.district) &&
    normalizeSegment(a.date) === normalizeSegment(b.date) &&
    normalizeSegment(a.examCode) === normalizeSegment(b.examCode);
}

function buildDiffRow(
  row: TcsExamSourceRow | TcsExamExistingWorkOrder,
  status: TcsExamDiffRow["status"],
  previous?: TcsExamExistingWorkOrder,
): TcsExamDiffRow {
  return {
    key: getIdentityKey(row),
    siteId: row.siteId,
    siteName: row.siteName,
    district: row.district,
    date: row.date,
    examCode: row.examCode ?? "",
    maleGuardsRequired: row.maleGuardsRequired,
    femaleGuardsRequired: row.femaleGuardsRequired,
    totalManpower: Number(row.maleGuardsRequired) + Number(row.femaleGuardsRequired),
    status,
    previousMaleGuardsRequired: previous?.maleGuardsRequired,
    previousFemaleGuardsRequired: previous?.femaleGuardsRequired,
    previousTotalManpower: previous?.totalManpower,
  };
}

export function buildTcsExamDiff(input: BuildTcsExamDiffInput): TcsExamDiffRow[] {
  const existingByIdentity = new Map<string, TcsExamExistingWorkOrder>();
  const existingByFallbackAll = new Map<string, TcsExamExistingWorkOrder[]>();
  const existingByFallbackOnly = new Map<string, TcsExamExistingWorkOrder[]>();
  for (const row of input.existingRows) {
    if (normalizeSegment(row.recordStatus) === "cancelled") {
      continue;
    }
    const identityKey = getIdentityKey(row);
    if (hasSiteId(row)) {
      if (!existingByIdentity.has(identityKey)) {
        existingByIdentity.set(identityKey, row);
      }
    }

    const fallbackKey = getFallbackKey(row);
    const allBucket = existingByFallbackAll.get(fallbackKey) ?? [];
    allBucket.push(row);
    existingByFallbackAll.set(fallbackKey, allBucket);

    if (!hasSiteId(row)) {
      const fallbackOnlyBucket = existingByFallbackOnly.get(fallbackKey) ?? [];
      fallbackOnlyBucket.push(row);
      existingByFallbackOnly.set(fallbackKey, fallbackOnlyBucket);
    }
  }

  const seenExistingKeys = new Set<string>();
  const diffRows: TcsExamDiffRow[] = [];

  for (const parsedRow of input.parsedRows) {
    const parsedIdentityKey = getIdentityKey(parsedRow);
    const parsedFallbackKey = getFallbackKey(parsedRow);
    const matchedExisting = hasSiteId(parsedRow)
      ? existingByIdentity.get(parsedIdentityKey) ??
        existingByFallbackOnly.get(parsedFallbackKey)?.[0] ??
        null
      : existingByFallbackAll.get(parsedFallbackKey)?.[0] ?? null;

    const matchedKey = matchedExisting ? getIdentityKey(matchedExisting) : null;
    if (matchedKey) {
      seenExistingKeys.add(matchedKey);
    }

    if (!matchedExisting) {
      diffRows.push(buildDiffRow(parsedRow, "added"));
      continue;
    }

    const status = sameCounts(parsedRow, matchedExisting) && sameNamedFields(parsedRow, matchedExisting)
      ? "unchanged"
      : "updated";
    diffRows.push(buildDiffRow(parsedRow, status, matchedExisting));
  }

  if (input.mode === "revision") {
    for (const existingRow of input.existingRows) {
      const existingKey = getIdentityKey(existingRow);
      if (seenExistingKeys.has(existingKey)) {
        continue;
      }
      if (normalizeSegment(existingRow.recordStatus) === "cancelled") {
        continue;
      }
      diffRows.push(buildDiffRow(existingRow, "cancelled", existingRow));
    }
  }

  return diffRows.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) {
      return dateCompare;
    }
    const siteCompare = a.siteName.localeCompare(b.siteName);
    if (siteCompare !== 0) {
      return siteCompare;
    }
    const examCompare = a.examCode.localeCompare(b.examCode);
    if (examCompare !== 0) {
      return examCompare;
    }
    return a.status.localeCompare(b.status);
  });
}
