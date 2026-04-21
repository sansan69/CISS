import { createHash } from "node:crypto";
import type { TcsExamHashRow } from "@/types/work-orders";

function toBuffer(value: ArrayBuffer | ArrayBufferView | Buffer): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }

  return Buffer.from(value);
}

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

export function buildBinaryFileHash(value: ArrayBuffer | ArrayBufferView | Buffer): string {
  return createHash("sha256").update(toBuffer(value)).digest("hex");
}

export function buildTcsExamContentHash(examCode: string, rows: readonly TcsExamHashRow[]): string {
  const normalizedRows = rows.map(serializeRow).sort().join("\n");
  return createHash("sha256").update(`${normalizeHashSegment(examCode)}\n${normalizedRows}`).digest("hex");
}
