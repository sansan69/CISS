import crypto from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";

import type {
  PayslipParseMethod,
  PayslipUnmatchedReason,
} from "@/types/payslip";

/* ────────────────────────────── limits ──────────────────────────────────── */

export const PAYSLIP_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const PAYSLIP_MAX_FILES = 50;
export const PAYSLIP_MAX_BYTES = 10 * 1024 * 1024;
export const PAYSLIP_MAX_LIST = 200;

/** `CISS/<client>/<year-range>/<serial>`, e.g. CISS/TCS/2025-26/871. */
export const EMPLOYEE_ID_IN_TEXT = /CISS\s*\/\s*[A-Z0-9&.\-]+\s*\/\s*\d{4}-\d{2}\s*\/\s*[A-Z0-9]+/i;
/** A bare 6–12 digit serial, used when the full id is not printed. */
export const STANDALONE_ID = /(?<![\d/])(\d{6,12})(?![\d/])/;

const PAYSLIP_DOCS_COLLECTION = "payslipDocuments";

/* ────────────────────────────── text utils ──────────────────────────────── */

export function normalizePayslipText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Uppercase, whitespace-normalised employee id. */
export function normalizeEmployeeIdCandidate(value: string): string {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/** Case- and whitespace-insensitive person name, punctuation stripped. */
export function normalizePersonName(value: string): string {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isValidPayslipPeriod(period: string): boolean {
  return PAYSLIP_PERIOD_PATTERN.test(period.trim());
}

/** True for a PDF by magic number (`%PDF` within the first bytes). */
export function looksLikePdf(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 5) return false;
  const head = buffer.subarray(0, 1024).toString("latin1");
  return head.includes("%PDF-");
}

/* ────────────────────────── identifier extraction ───────────────────────── */

/** Every distinct employee id printed in the PDF text, in first-seen order. */
export function extractAllEmployeeIdsFromText(text: string): string[] {
  const matches = normalizePayslipText(text).match(
    new RegExp(EMPLOYEE_ID_IN_TEXT.source, "gi"),
  ) ?? [];
  const seen = new Set<string>();
  for (const match of matches) {
    seen.add(normalizeEmployeeIdCandidate(match));
  }
  return [...seen];
}

/**
 * Full employee id printed in the PDF text, if any. Callers that store the
 * whole PDF must first check `extractAllEmployeeIdsFromText` so a file holding
 * two employees' slips is never attributed to the first one.
 */
export function extractEmployeeIdFromText(text: string): string | null {
  return extractAllEmployeeIdsFromText(text)[0] ?? null;
}

/** Every distinct bare 6–12 digit serial, excluding full employee ids. */
export function extractAllStandaloneIdsFromText(text: string): string[] {
  const normalized = normalizePayslipText(text)
    .replace(new RegExp(EMPLOYEE_ID_IN_TEXT.source, "gi"), " ");
  const matches = normalized.match(new RegExp(STANDALONE_ID.source, "g")) ?? [];
  const seen = new Set<string>();
  for (const value of matches) {
    const match = value.match(STANDALONE_ID);
    if (match) seen.add(match[1]);
  }
  return [...seen];
}

/** Bare 6–12 digit serial printed in the PDF text, if any. */
export function extractStandaloneIdFromText(text: string): string | null {
  return extractAllStandaloneIdsFromText(text)[0] ?? null;
}

/**
 * Candidate employee name printed in the PDF ("Employee Name: X" / "Name: X").
 * Falls back to the first line that looks like a person's name.
 */
const LABELLED_NAME = /(?:employee\s*name|name\s*of\s*(?:the\s*)?employee|name)\s*[:\-]\s*([A-Za-z][A-Za-z .'\-]{2,60})/gi;

/** Every distinct labelled person name printed in the PDF, in first-seen order. */
export function extractAllNamesFromText(text: string): string[] {
  const normalized = normalizePayslipText(text);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const match of normalized.matchAll(LABELLED_NAME)) {
    const name = match[1].replace(/\s+/g, " ").trim();
    const key = normalizePersonName(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** First labelled name, if any. */
export function extractNameFromText(text: string): string | null {
  return extractAllNamesFromText(text)[0] ?? null;
}

/* ─────────────────────────── filename extraction ────────────────────────── */

export function baseFileName(fileName: string): string {
  const parts = String(fileName ?? "").split(/[\\/]/);
  return parts[parts.length - 1] || "payslip.pdf";
}

/**
 * Employee id from a filename. Handles both `CISS/TCS/2025-26/871.pdf` and the
 * underscore form `CISS_TCS_2025-26_871.pdf` that zipped exports produce.
 */
export function parseEmployeeIdFromFileName(fileName: string): string | null {
  const raw = String(fileName ?? "").trim();
  if (!raw) return null;

  // A file can arrive as "CISS/TCS/2025-26/871.pdf" (the id keeps its slashes)
  // or as "CISS_TCS_2025-26_871.pdf" from zipped exports, so try the whole
  // submitted name first and the basename second.
  for (const candidate of [raw, baseFileName(raw)]) {
    const withoutExtension = candidate.replace(/\.[a-z0-9]+$/i, "");
    const direct = withoutExtension.match(EMPLOYEE_ID_IN_TEXT);
    if (direct) return normalizeEmployeeIdCandidate(direct[0]);

    const underscored = withoutExtension.match(
      /CISS[_\-]([A-Z0-9&.]+)[_\-](\d{4}-\d{2})[_\-]([A-Z0-9]+)(?![A-Z0-9])/i,
    );
    if (underscored) {
      return normalizeEmployeeIdCandidate(
        `CISS/${underscored[1]}/${underscored[2]}/${underscored[3]}`,
      );
    }
  }
  return null;
}

/**
 * A person's name from a payslip filename, e.g.
 * `Payslip-Rahul Kumar-2026-01.pdf` → "Rahul Kumar".
 */
export function parseNameFromFileName(fileName: string): string | null {
  const stem = baseFileName(fileName).replace(/\.[a-z0-9]+$/i, "");
  const withoutPeriod = stem.replace(/\d{4}[-_ ]?(0[1-9]|1[0-2])\b/g, " ");
  const cleaned = withoutPeriod
    .replace(/payslip|salary\s*slip|pay\s*slip|slip|salary/gi, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Require at least two alphabetic words so "871" or "jan" alone never matches.
  const words = cleaned.split(" ").filter((word) => /^[A-Za-z][A-Za-z'.\-]{1,}$/.test(word));
  if (words.length < 2) return null;
  return words.slice(0, 4).join(" ");
}

/* ───────────────────────────── matching ─────────────────────────────────── */

export type PayslipEmployeeCandidate = {
  employeeDocId: string;
  employeeId: string;
  employeeName: string;
  clientName?: string | null;
};

export type PayslipMatchOutcome =
  | {
      status: "matched";
      employee: PayslipEmployeeCandidate;
      parseMethod: PayslipParseMethod;
    }
  | {
      status: "unmatched";
      reason: PayslipUnmatchedReason;
      detail: string;
    };

function dedupeById(candidates: PayslipEmployeeCandidate[]) {
  const seen = new Set<string>();
  const unique: PayslipEmployeeCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate?.employeeDocId || seen.has(candidate.employeeDocId)) continue;
    seen.add(candidate.employeeDocId);
    unique.push(candidate);
  }
  return unique;
}

/**
 * Compare an extracted name with an employee's name using token containment, so
 * "Rahul Kumar" matches "Rahul Kumar S" but not "Anita Sharma".
 */
export function namesLikelySamePerson(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizePersonName(a ?? "");
  const right = normalizePersonName(b ?? "");
  if (!left || !right) return true;
  if (left === right) return true;
  const leftTokens = left.split(" ").filter(Boolean);
  const rightTokens = right.split(" ").filter(Boolean);
  const [shorter, longer] =
    leftTokens.length <= rightTokens.length
      ? [leftTokens, rightTokens]
      : [rightTokens, leftTokens];
  return shorter.every((token) => longer.includes(token));
}

function ambiguous(candidates: PayslipEmployeeCandidate[]): PayslipMatchOutcome {
  const names = candidates
    .slice(0, 5)
    .map((candidate) => `${candidate.employeeName} (${candidate.employeeId})`)
    .join(", ");
  return {
    status: "unmatched",
    reason: "ambiguous",
    detail: `${candidates.length} employees match: ${names}. Rename the file with the employee id so the payslip can be attributed.`,
  };
}

/**
 * Decide which employee a payslip belongs to.
 *
 * Priority: employee id in the PDF text → employee id in the filename → bare
 * serial → unique name match. Any identifier resolving to more than one
 * employee stops the file: guessing would deliver one employee's payslip to
 * another.
 */
export function decidePayslipMatch(input: {
  fromPdfId?: PayslipEmployeeCandidate[];
  fromFileId?: PayslipEmployeeCandidate[];
  fromStandaloneId?: PayslipEmployeeCandidate[];
  fromName?: PayslipEmployeeCandidate[];
  /** Name printed on the payslip, used to corroborate a weak (serial) match. */
  candidateName?: string | null;
}): PayslipMatchOutcome {
  const fromPdfId = dedupeById(input.fromPdfId ?? []);
  const fromFileId = dedupeById(input.fromFileId ?? []);
  const fromStandaloneId = dedupeById(input.fromStandaloneId ?? []);
  const fromName = dedupeById(input.fromName ?? []);

  if (fromPdfId.length > 1) return ambiguous(fromPdfId);
  if (fromPdfId.length === 1) {
    return { status: "matched", employee: fromPdfId[0], parseMethod: "employeeId" };
  }

  if (fromFileId.length > 1) return ambiguous(fromFileId);
  if (fromFileId.length === 1) {
    return { status: "matched", employee: fromFileId[0], parseMethod: "filename" };
  }

  if (fromStandaloneId.length > 1) return ambiguous(fromStandaloneId);
  if (fromStandaloneId.length === 1) {
    // A bare serial is a weak identifier: a PF/ESI/account number in the same
    // PDF can collide with someone's resource id. When the payslip also prints a
    // name, it must agree with the employee the serial resolved to.
    const employee = fromStandaloneId[0];
    if (!namesLikelySamePerson(input.candidateName, employee.employeeName)) {
      return {
        status: "unmatched",
        reason: "no-match",
        detail: `The serial matches ${employee.employeeName}, but the payslip is for "${input.candidateName}". Rename the file with the employee id (${employee.employeeId}) to confirm.`,
      };
    }
    return { status: "matched", employee, parseMethod: "employeeId" };
  }

  if (fromName.length > 1) return ambiguous(fromName);
  if (fromName.length === 1) {
    return { status: "matched", employee: fromName[0], parseMethod: "name" };
  }

  const hadIdentifier =
    fromPdfId.length + fromFileId.length + fromStandaloneId.length + fromName.length > 0;
  return hadIdentifier
    ? { status: "unmatched", reason: "no-match", detail: "No employee matches the extracted identifier." }
    : {
        status: "unmatched",
        reason: "no-identifier",
        detail:
          "No employee id or name could be read from this PDF or its filename. Rename the file with the employee id (CISS/CLIENT/2025-26/123).",
      };
}

export function buildPayslipStoragePath(employeeDocId: string, period: string) {
  return `employees/${employeeDocId}/payslips/${period}/${crypto.randomUUID()}.pdf`;
}

export function payslipDocumentId() {
  return crypto.randomUUID();
}

export function sanitizeDownloadFileName(period: string) {
  const safePeriod =
    String(period ?? "")
      .replace(/[^0-9-]/g, "")
      .replace(/^-+|-+$/g, "") || "period";
  return `payslip-${safePeriod}.pdf`;
}

/* ───────────────────────────── db lookups ──────────────────────────────── */

const NAME_SCAN_PAGE = 500;
const NAME_SCAN_SAFETY_CAP = 50_000;

function toCandidate(data: Record<string, unknown>, id: string): PayslipEmployeeCandidate | null {
  const employeeId = typeof data.employeeId === "string" ? data.employeeId : "";
  const name =
    (typeof data.fullName === "string" && data.fullName.trim()) ||
    (typeof data.employeeName === "string" && data.employeeName.trim()) ||
    (typeof data.name === "string" && data.name.trim()) ||
    "";
  if (!employeeId || !name) return null;
  return {
    employeeDocId: id,
    employeeId,
    employeeName: name,
    clientName: typeof data.clientName === "string" ? data.clientName : null,
  };
}

/** One name index per upload request, so a 50-file batch scans employees once. */
export type PayslipLookupCache = {
  nameIndex: Map<string, PayslipEmployeeCandidate[]> | null;
  /** False when the employee scan hit its safety cap; name matching is then refused. */
  nameIndexComplete: boolean;
};

export function createPayslipLookupCache(): PayslipLookupCache {
  return { nameIndex: null, nameIndexComplete: true };
}

async function findByEmployeeId(
  db: Firestore,
  employeeId: string,
): Promise<PayslipEmployeeCandidate[]> {
  const exact = await db.collection("employees").where("employeeId", "==", employeeId).limit(3).get();
  const hits = exact.docs
    .map((doc) => toCandidate(doc.data() as Record<string, unknown>, doc.id))
    .filter((candidate): candidate is PayslipEmployeeCandidate => Boolean(candidate));
  if (hits.length > 0) return hits;

  // Employee ids are stored uppercase in practice; accept a pasted lowercase id
  // by retrying with the normalised form.
  const normalised = normalizeEmployeeIdCandidate(employeeId);
  if (normalised && normalised !== employeeId) {
    const retry = await db.collection("employees").where("employeeId", "==", normalised).limit(3).get();
    return retry.docs
      .map((doc) => toCandidate(doc.data() as Record<string, unknown>, doc.id))
      .filter((candidate): candidate is PayslipEmployeeCandidate => Boolean(candidate));
  }
  return [];
}

async function findByStandaloneId(
  db: Firestore,
  value: string,
): Promise<PayslipEmployeeCandidate[]> {
  const byResourceId = await db
    .collection("employees")
    .where("resourceIdNumber", "==", value)
    .limit(3)
    .get();
  return byResourceId.docs
    .map((doc) => toCandidate(doc.data() as Record<string, unknown>, doc.id))
    .filter((candidate): candidate is PayslipEmployeeCandidate => Boolean(candidate));
}

async function nameIndex(db: Firestore, cache: PayslipLookupCache) {
  if (cache.nameIndex) return cache.nameIndex;
  const index = new Map<string, PayslipEmployeeCandidate[]>();
  // Scan every employee: a capped scan cannot prove a name is unique, and a
  // duplicate outside the cap would deliver one person's slip to another.
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scanned = 0;
  for (;;) {
    let query = db.collection("employees").limit(NAME_SCAN_PAGE);
    if (last) query = query.startAfter(last);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      scanned += 1;
      const candidate = toCandidate(doc.data() as Record<string, unknown>, doc.id);
      if (!candidate) continue;
      const key = normalizePersonName(candidate.employeeName);
      if (!key) continue;
      const list = index.get(key) ?? [];
      // The same person can be duplicated across client records; keep the list
      // so the caller can report ambiguity instead of silently picking one.
      list.push(candidate);
      index.set(key, list);
    }
    if (snapshot.size < NAME_SCAN_PAGE) break;
    last = snapshot.docs[snapshot.size - 1] ?? null;
    if (!last) break;
    if (scanned >= NAME_SCAN_SAFETY_CAP) {
      cache.nameIndexComplete = false;
      break;
    }
  }
  cache.nameIndex = index;
  return index;
}

async function findByName(
  db: Firestore,
  name: string,
  cache: PayslipLookupCache,
): Promise<PayslipEmployeeCandidate[]> {
  const target = normalizePersonName(name);
  if (!target) return [];
  const index = await nameIndex(db, cache);
  // An incomplete index cannot establish uniqueness; refuse name attribution
  // rather than risk a wrong recipient.
  if (!cache.nameIndexComplete) return [];
  return index.get(target) ?? [];
}

/**
 * Resolve every identifier a payslip file offers, so the decision can be made
 * once and ambiguity reported precisely.
 */
export async function lookupPayslipCandidates(
  db: Firestore,
  input: {
    pdfEmployeeId?: string | null;
    fileNameEmployeeId?: string | null;
    standaloneId?: string | null;
    candidateName?: string | null;
  },
  cache: PayslipLookupCache = createPayslipLookupCache(),
): Promise<{
  fromPdfId: PayslipEmployeeCandidate[];
  fromFileId: PayslipEmployeeCandidate[];
  fromStandaloneId: PayslipEmployeeCandidate[];
  fromName: PayslipEmployeeCandidate[];
}> {
  const [fromPdfId, fromFileId, fromStandaloneId, fromName] = await Promise.all([
    input.pdfEmployeeId ? findByEmployeeId(db, input.pdfEmployeeId) : Promise.resolve([]),
    input.fileNameEmployeeId && input.fileNameEmployeeId !== input.pdfEmployeeId
      ? findByEmployeeId(db, input.fileNameEmployeeId)
      : Promise.resolve([]),
    input.standaloneId ? findByStandaloneId(db, input.standaloneId) : Promise.resolve([]),
    input.candidateName ? findByName(db, input.candidateName, cache) : Promise.resolve([]),
  ]);

  return { fromPdfId, fromFileId, fromStandaloneId, fromName };
}

/* ─────────────────────────── reading documents ─────────────────────────── */

export type PayslipDocumentRecord = {
  id: string;
  data: Record<string, unknown>;
};

export function toTimestampMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === "object" && value !== null) {
    const seconds = (value as { seconds?: unknown; _seconds?: unknown }).seconds
      ?? (value as { _seconds?: unknown })._seconds;
    if (typeof seconds === "number") return seconds * 1000;
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") return Number(toMillis.call(value));
  }
  return 0;
}

export function toIsoString(value: unknown): string | null {
  const millis = toTimestampMillis(value);
  return millis > 0 ? new Date(millis).toISOString() : null;
}

/** Newest period first, then newest upload — used by both list endpoints. */
export function comparePayslipDocsDesc(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
) {
  const periodA = typeof a.period === "string" ? a.period : "";
  const periodB = typeof b.period === "string" ? b.period : "";
  if (periodA !== periodB) return periodB.localeCompare(periodA);
  return toTimestampMillis(b.createdAt) - toTimestampMillis(a.createdAt);
}

export const PAYSLIP_DOCUMENTS_COLLECTION = PAYSLIP_DOCS_COLLECTION;
