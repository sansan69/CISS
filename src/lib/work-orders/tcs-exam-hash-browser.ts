import type { TcsExamHashRow } from "@/types/work-orders";

function normalizeHashSegment(value: string | number | undefined | null): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function serializeRow(row: TcsExamHashRow): string {
  return [
    normalizeHashSegment(row.siteId),
    normalizeHashSegment(row.siteName),
    normalizeHashSegment(row.district),
    normalizeHashSegment(row.date),
    normalizeHashSegment(row.examCode),
    String(Number(row.maleGuardsRequired) || 0),
    String(Number(row.femaleGuardsRequired) || 0),
  ].join("|");
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildTcsExamContentHashBrowser(
  examCode: string,
  rows: readonly TcsExamHashRow[]
): Promise<string> {
  const normalizedRows = rows.map(serializeRow).sort().join("\n");
  return sha256Hex(`${normalizeHashSegment(examCode)}\n${normalizedRows}`);
}
