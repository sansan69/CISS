import { NextResponse } from "next/server";
import { OPERATIONAL_CLIENT_NAME } from "../../../../../../lib/constants";
import { buildLocationIdentity } from "@/lib/location-utils";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import {
  buildServerAuditEvent,
  buildServerCreateAudit,
  buildServerUpdateAudit,
} from "@/lib/server/audit";
import { lookupLocationGeocode } from "@/lib/server/location-geocode";
import { buildTcsExamDiff } from "@/lib/work-orders/tcs-exam-diff";
import { buildTcsExamContentHash } from "@/lib/work-orders/tcs-exam-hash";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";
import {
  buildSiteLookupMaps,
  resolveParsedRowSiteIds,
} from "@/lib/work-orders/tcs-site-resolver";
import {
  canonicalizeDistrictName,
  districtKey,
  districtMatches,
  isCanonicalKeralaDistrict,
  normalizeOperationalZoneLabel,
} from "@/lib/districts";
import type {
  TcsExamExistingWorkOrder,
  TcsExamImportCommitPayload,
  TcsExamSourceRow,
  WorkOrderDuplicateResolution,
  WorkOrderImportMode,
} from "@/types/work-orders";
import { GeoPoint } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_MAX_OPS = 450;

const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
});

type FirestoreTimestampLike = {
  toDate?: () => Date;
};

type ExistingWorkOrderRecord = TcsExamExistingWorkOrder & {
  clientName?: string;
  assignedGuards?: unknown[];
  sourceFileName?: string;
  sourceSheetName?: string;
  binaryFileHash?: string;
  contentHash?: string;
};

type SiteRecord = {
  id: string;
  siteId?: string | null;
  siteName: string;
  district: string;
};

// ── Batch write accumulator ─────────────────────────────────────────────

type WriteOp = {
  ref: FirebaseFirestore.DocumentReference;
  data: Record<string, unknown>;
  merge?: boolean;
};

function commitWritesInChunks(
  db: FirebaseFirestore.Firestore,
  writes: WriteOp[],
): Promise<void> {
  return commitWritesInChunksInternal(db, writes, BATCH_MAX_OPS);
}

async function commitWritesInChunksInternal(
  db: FirebaseFirestore.Firestore,
  writes: WriteOp[],
  maxOps: number,
): Promise<void> {
  for (let i = 0; i < writes.length; i += maxOps) {
    const chunk = writes.slice(i, i + maxOps);
    const batch = db.batch();
    for (const w of chunk) {
      if (w.merge) {
        batch.set(w.ref, w.data, { merge: true });
      } else {
        batch.set(w.ref, w.data);
      }
    }
    await batch.commit();
  }
}

// ── Normalization helpers ───────────────────────────────────────────────

function normalizeMode(value: unknown): WorkOrderImportMode {
  return value === "revision" ? "revision" : "new";
}

function normalizeDuplicateResolution(value: unknown): WorkOrderDuplicateResolution {
  return value === "replace" || value === "omit" ? value : "reject";
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

function normalizeTcsDistrict(value: unknown): string {
  const zoneNormalized = normalizeOperationalZoneLabel(value as string | null | undefined);
  if (!zoneNormalized) return "";
  if (isCanonicalKeralaDistrict(zoneNormalized)) {
    return canonicalizeDistrictName(zoneNormalized) || zoneNormalized;
  }
  return zoneNormalized;
}

function hasConcreteSiteId(row: { siteId?: string }) {
  return normalizeSegment(row.siteId) !== "";
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
  if (!parsed) return "";
  return IST_DATE_FORMATTER.format(parsed);
}

function createStoredDate(date: string): Date {
  return new Date(`${date}T12:00:00+05:30`);
}

function slugifySegment(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  return `${siteKey}|date:${row.date.trim().toLowerCase()}|exam:${String(row.examCode ?? "").trim().toLowerCase()}`;
}

function getFallbackIdentityKey(row: {
  siteName: string;
  district: string;
  date: string;
  examCode?: string;
}) {
  return `site-fallback:${normalizeSegment(row.siteName)}|district:${normalizeSegment(row.district)}|date:${normalizeSegment(row.date)}|exam:${normalizeSegment(row.examCode)}`;
}

function findMatchingExistingRow(
  parsedRow: TcsExamSourceRow,
  existingRows: readonly ExistingWorkOrderRecord[],
) {
  if (hasConcreteSiteId(parsedRow)) {
    const exactMatch = existingRows.find(
      (row) => hasConcreteSiteId(row) && getIdentityKey(row) === getIdentityKey(parsedRow),
    );
    if (exactMatch) return exactMatch;
  }
  const fallbackKey = getFallbackIdentityKey(parsedRow);
  return existingRows.find((row) => {
    if (hasConcreteSiteId(parsedRow) && hasConcreteSiteId(row)) return false;
    return getFallbackIdentityKey(row) === fallbackKey;
  });
}

function hasIdentityOverlap(
  parsedRows: readonly TcsExamSourceRow[],
  existingRows: readonly TcsExamExistingWorkOrder[],
) {
  return parsedRows.some((row) =>
    Boolean(findMatchingExistingRow(row, existingRows as readonly ExistingWorkOrderRecord[])),
  );
}

function buildWorkOrderDocId(row: TcsExamSourceRow) {
  const siteToken = row.siteId?.trim() || slugifySegment(row.siteName) || "site";
  const examToken = slugifySegment(row.examCode) || "exam";
  const dateToken = row.date.trim() || "date";
  return `${siteToken}_${dateToken}_${examToken}`;
}

function buildWorkOrderDocIdForExam(row: TcsExamSourceRow, examCode: string) {
  return buildWorkOrderDocId({ ...row, examCode });
}

function buildFallbackSiteKey(siteName: string, district: string) {
  return `${normalizeSegment(siteName)}|district:${districtKey(district) || normalizeSegment(district)}`;
}

function buildSiteCodeDistrictKey(siteId: string | null | undefined, district: string) {
  const codeKey = normalizeSegment(siteId);
  const resolvedDistrictKey = districtKey(district) || normalizeSegment(district);
  return codeKey && resolvedDistrictKey ? `${codeKey}|district:${resolvedDistrictKey}` : "";
}

function buildSiteCodeKey(siteId: string | null | undefined) {
  const codeKey = normalizeSegment(siteId);
  return codeKey ? `code:${codeKey}` : "";
}

function buildSiteNameKey(siteName: string) {
  const nameKey = normalizeSegment(siteName);
  return nameKey ? `name:${nameKey}` : "";
}

function validatePayload(body: unknown): TcsExamImportCommitPayload {
  const payload = body as Partial<TcsExamImportCommitPayload>;
  if (!payload || typeof payload !== "object") {
    throw new Error("Commit payload is required.");
  }
  if (!payload.fileName || !payload.examName || !payload.examCode) {
    throw new Error("fileName, examName, and examCode are required.");
  }
  if (!payload.binaryFileHash || !payload.contentHash) {
    throw new Error("binaryFileHash and contentHash are required.");
  }
  if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
    throw new Error("At least one parsed row is required to commit.");
  }
  return payload as TcsExamImportCommitPayload;
}

// ── Paginated / filtered Firestore reads ────────────────────────────────

async function fetchExistingRows(
  adminDb: FirebaseFirestore.Firestore,
  parsedRows: readonly TcsExamSourceRow[],
): Promise<ExistingWorkOrderRecord[]> {
  const relevantExamCodes = Array.from(
    new Set(parsedRows.map((row) => row.examCode ?? "").filter(Boolean)),
  );

  if (relevantExamCodes.length === 0) return [];

  const allResults: ExistingWorkOrderRecord[] = [];

  // Firestore "in" supports up to 10 values; paginate if needed
  for (let i = 0; i < relevantExamCodes.length; i += 10) {
    const codeBatch = relevantExamCodes.slice(i, i + 10);
    let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    let hasMore = true;

    while (hasMore) {
      let query = adminDb
        .collection("workOrders")
        .where("examCode", "in", codeBatch)
        .limit(300);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        const data = doc.data();
        allResults.push({
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
          assignedGuards: Array.isArray(data.assignedGuards) ? data.assignedGuards : [],
          sourceFileName: typeof data.sourceFileName === "string" ? data.sourceFileName : undefined,
          sourceSheetName: typeof data.sourceSheetName === "string" ? data.sourceSheetName : undefined,
          binaryFileHash: typeof data.binaryFileHash === "string" ? data.binaryFileHash : undefined,
          contentHash: typeof data.contentHash === "string" ? data.contentHash : undefined,
        } satisfies ExistingWorkOrderRecord);
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      hasMore = snapshot.docs.length >= 300;
    }
  }

  // Apply the same memory-level filters as before
  return allResults
    .filter((row) => isOperationalWorkOrderClientName(row.clientName))
    .filter((row) => row.date !== "")
    .filter((row) =>
      relevantExamCodes.length === 0 ? true : relevantExamCodes.includes(row.examCode),
    );
}

async function fetchSites(
  adminDb: FirebaseFirestore.Firestore,
  tcsClientId: string | null,
): Promise<{
  byCodeDistrict: Map<string, SiteRecord>;
  byFallback: Map<string, SiteRecord>;
  byCode: Map<string, SiteRecord>;
  byName: Map<string, SiteRecord>;
}> {
  const snapshot = await adminDb
    .collection("sites")
    .where("clientName", "==", OPERATIONAL_CLIENT_NAME)
    .get();

  const byCodeDistrict = new Map<string, SiteRecord>();
  const byFallback = new Map<string, SiteRecord>();
  const byCode = new Map<string, SiteRecord>();
  const byName = new Map<string, SiteRecord>();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const clientNameValue = typeof data.clientName === "string" ? data.clientName : "";
    const clientIdValue = typeof data.clientId === "string" ? data.clientId : "";
    const isTcsClient =
      isOperationalWorkOrderClientName(clientNameValue) ||
      (Boolean(tcsClientId) && clientIdValue === tcsClientId);
    if (!isTcsClient) continue;

    const site: SiteRecord = {
      id: doc.id,
      siteId: typeof data.siteId === "string" ? data.siteId : null,
      siteName: String(data.siteName ?? ""),
      district: String(data.district ?? ""),
    };
    const codeDistrictKey = buildSiteCodeDistrictKey(site.siteId, site.district);
    if (codeDistrictKey && !byCodeDistrict.has(codeDistrictKey)) {
      byCodeDistrict.set(codeDistrictKey, site);
    }
    const fallbackKey = buildFallbackSiteKey(site.siteName, site.district);
    if (!byFallback.has(fallbackKey)) {
      byFallback.set(fallbackKey, site);
    }
    const codeKey = buildSiteCodeKey(site.siteId);
    if (codeKey && !byCode.has(codeKey)) {
      byCode.set(codeKey, site);
    }
    const nameKey = buildSiteNameKey(site.siteName);
    if (nameKey && !byName.has(nameKey)) {
      byName.set(nameKey, site);
    }
  }

  return { byCodeDistrict, byFallback, byCode, byName };
}

// ── Site resolution & creation ──────────────────────────────────────────

async function resolveCommitRows(
  adminDb: FirebaseFirestore.Firestore,
  writes: WriteOp[],
  rows: readonly TcsExamSourceRow[],
  adminUser: { uid: string; email?: string | null },
  existingRows: readonly ExistingWorkOrderRecord[] = [],
) {
  const clientSnap = await adminDb
    .collection("clients")
    .where("name", "==", OPERATIONAL_CLIENT_NAME)
    .get();
  const tcsClientId = clientSnap.docs[0]?.id ?? null;
  const sites = await fetchSites(adminDb, tcsClientId);

  let createdSites = 0;
  const resolvedRows: TcsExamSourceRow[] = [];

  for (const row of rows) {
    const existing = findMatchingExistingRow(row, existingRows);
    if (existing?.siteId) {
      resolvedRows.push({
        ...row,
        siteId: existing.siteId,
        siteName: row.siteName || existing.siteName,
        district: row.district || existing.district,
      });
      continue;
    }

    const codeDistrictKey = buildSiteCodeDistrictKey(row.siteId, row.district);
    const fallbackKey = buildFallbackSiteKey(row.siteName, row.district);
    const codeKey = buildSiteCodeKey(row.siteId);
    const nameKey = buildSiteNameKey(row.siteName);

    let site =
      (codeDistrictKey && sites.byCodeDistrict.get(codeDistrictKey)) ||
      sites.byFallback.get(fallbackKey) ||
      (codeKey ? sites.byCode.get(codeKey) : undefined) ||
      (nameKey ? sites.byName.get(nameKey) : undefined);

    if (site && row.district && !districtMatches(row.district, site.district)) {
      writes.push({
        ref: adminDb.collection("sites").doc(site.id),
        data: {
          district: row.district,
          clientName: OPERATIONAL_CLIENT_NAME,
          clientId: tcsClientId,
          locationKey: buildLocationIdentity([OPERATIONAL_CLIENT_NAME, row.siteName, row.district]),
          ...buildServerUpdateAudit({
            uid: adminUser.uid,
            email: adminUser.email ?? undefined,
          }),
        },
        merge: true,
      });
      site.district = row.district;
    }

    if (!site) {
      const siteRef = adminDb.collection("sites").doc();
      let geocode:
        | {
            lat: number;
            lng: number;
            formattedAddress?: string;
            placeAccuracy?: string;
          }
        | null = null;

      try {
        geocode = await lookupLocationGeocode({
          name: row.siteName,
          address: row.siteName,
          district: row.district,
          state: "Kerala",
          entityType: "site",
        });
      } catch {
        geocode = null;
      }

      const sitePayload = {
        id: siteRef.id,
        clientName: OPERATIONAL_CLIENT_NAME,
        clientId: tcsClientId,
        siteName: row.siteName,
        siteId: row.siteId?.trim() || null,
        siteAddress: geocode?.formattedAddress ?? "",
        district: row.district || "",
        state: "Kerala",
        geolocation: geocode ? new GeoPoint(geocode.lat, geocode.lng) : null,
        latString: geocode ? geocode.lat.toFixed(6) : null,
        lngString: geocode ? geocode.lng.toFixed(6) : null,
        coordinateStatus: geocode ? "geocoded" : "missing",
        coordinateSource: geocode ? "geocode" : null,
        placeAccuracy: geocode?.placeAccuracy ?? null,
        geocodedAt: geocode ? new Date() : null,
        geofenceRadiusMeters: 150,
        strictGeofence: true,
        shiftMode: "none",
        shiftPattern: null,
        shiftTemplates: [],
        locationKey: buildLocationIdentity([OPERATIONAL_CLIENT_NAME, row.siteName, row.district]),
        ...buildServerCreateAudit({
          uid: adminUser.uid,
          email: adminUser.email ?? undefined,
        }),
      };

      writes.push({
        ref: siteRef,
        data: sitePayload,
      });

      site = {
        id: siteRef.id,
        siteId: sitePayload.siteId,
        siteName: row.siteName,
        district: row.district,
      };
      createdSites += 1;
      if (codeDistrictKey) sites.byCodeDistrict.set(codeDistrictKey, site);
      sites.byFallback.set(fallbackKey, site);
      if (codeKey) sites.byCode.set(codeKey, site);
      if (nameKey) sites.byName.set(nameKey, site);
    }

    resolvedRows.push({
      ...row,
      siteId: site.id,
      siteName: row.siteName || site.siteName,
      district: row.district || site.district,
    });
  }

  return { resolvedRows, createdSites };
}

// ── Build work-order writes from diff rows ──────────────────────────────

function buildWorkOrderWrites(
  adminDb: FirebaseFirestore.Firestore,
  diffRows: ReturnType<typeof buildTcsExamDiff>,
  commitDiffKeys: Set<string>,
  parsedByKey: Map<string, TcsExamSourceRow>,
  parsedByResolvedKey: Map<string, TcsExamSourceRow>,
  originalKeyByResolvedKey: Map<string, string>,
  resolvedByOriginalKey: Map<string, TcsExamSourceRow>,
  resolvedByResolvedKey: Map<string, TcsExamSourceRow>,
  existingRows: readonly ExistingWorkOrderRecord[],
  activeExistingRows: readonly ExistingWorkOrderRecord[],
  adminUser: { uid: string; email?: string | null },
  importId: string,
  payload: TcsExamImportCommitPayload,
): { writes: WriteOp[]; committedRows: number; cancelledRows: number } {
  const writes: WriteOp[] = [];
  let committedRows = 0;
  let cancelledRows = 0;

  for (const diffRow of diffRows) {
    if (diffRow.status === "cancelled") {
      const existing = activeExistingRows.find((row) => getIdentityKey(row) === diffRow.key);
      if (!existing) continue;
      cancelledRows += 1;
      writes.push({
        ref: adminDb.collection("workOrders").doc(existing.id),
        data: {
          recordStatus: "cancelled",
          cancelledByImportId: importId,
          ...buildServerUpdateAudit({ uid: adminUser.uid, email: adminUser.email }),
        },
        merge: true,
      });
      continue;
    }

    if (!commitDiffKeys.has(diffRow.key)) continue;

    const originalKey = originalKeyByResolvedKey.get(diffRow.key) ?? diffRow.key;
    const originalRow = parsedByKey.get(originalKey) ?? null;
    const parsedRow =
      resolvedByResolvedKey.get(diffRow.key) ??
      (originalRow ? resolvedByOriginalKey.get(getIdentityKey(originalRow)) : undefined) ??
      parsedByResolvedKey.get(diffRow.key) ??
      originalRow ??
      null;

    if (!parsedRow) continue;

    const inactiveExisting =
      existingRows.find(
        (row) =>
          !isActiveRecordStatus(row.recordStatus) &&
          getIdentityKey(row) === diffRow.key,
      ) ??
      (originalRow
        ? existingRows.find(
            (row) =>
              !isActiveRecordStatus(row.recordStatus) &&
              getIdentityKey(row) === getIdentityKey(originalRow),
          )
        : null);
    if (inactiveExisting) continue;

    const existing =
      activeExistingRows.find((row) => getIdentityKey(row) === diffRow.key) ??
      (originalRow ? findMatchingExistingRow(originalRow, activeExistingRows) : null) ??
      null;

    committedRows += 1;
    const targetId = existing?.id ?? buildWorkOrderDocIdForExam(parsedRow, payload.examCode);
    const workOrderRef = adminDb.collection("workOrders").doc(targetId);
    const basePayload = {
      siteId: parsedRow.siteId,
      siteName: parsedRow.siteName,
      clientName: OPERATIONAL_CLIENT_NAME,
      district: parsedRow.district,
      date: createStoredDate(parsedRow.date),
      maleGuardsRequired: parsedRow.maleGuardsRequired,
      femaleGuardsRequired: parsedRow.femaleGuardsRequired,
      totalManpower:
        Number(parsedRow.maleGuardsRequired) + Number(parsedRow.femaleGuardsRequired),
      assignedGuards: Array.isArray(existing?.assignedGuards) ? existing.assignedGuards : [],
      examName: payload.examName,
      examCode: payload.examCode,
      recordStatus: "active",
      importId,
      sourceFileName: payload.fileName,
      sourceSheetName: parsedRow.sourceSheetName,
      binaryFileHash: payload.binaryFileHash,
      contentHash: payload.contentHash,
    };

    if (existing) {
      writes.push({
        ref: workOrderRef,
        data: {
          ...basePayload,
          ...buildServerUpdateAudit({ uid: adminUser.uid, email: adminUser.email }),
        },
        merge: true,
      });
    } else {
      writes.push({
        ref: workOrderRef,
        data: {
          id: targetId,
          ...basePayload,
          ...buildServerCreateAudit({ uid: adminUser.uid, email: adminUser.email }),
        },
      });
    }
  }

  return { writes, committedRows, cancelledRows };
}

// ── POST handler ────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
    const payload = validatePayload(await request.json());
    const mode = normalizeMode(payload.mode);
    const duplicateResolution =
      mode === "revision" ? "replace" : normalizeDuplicateResolution(payload.duplicateResolution);
    const canonicalRows = payload.rows.map((row) => ({
      ...row,
      district: normalizeTcsDistrict(row.district),
      examName: payload.examName,
      examCode: payload.examCode,
    }));
    const computedContentHash = buildTcsExamContentHash(
      payload.examCode,
      canonicalRows.map((row) => ({
        siteId: row.siteId,
        siteName: row.siteName,
        district: row.district,
        date: row.date,
        examCode: payload.examCode,
        maleGuardsRequired: row.maleGuardsRequired,
        femaleGuardsRequired: row.femaleGuardsRequired,
      })),
    );

    if (computedContentHash !== payload.contentHash) {
      return NextResponse.json(
        { error: "contentHash does not match the parsed rows." },
        { status: 400 },
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const siteLookupMaps = await buildSiteLookupMaps(adminDb);
    const resolvedCanonicalRows = resolveParsedRowSiteIds(canonicalRows, siteLookupMaps);

    const parsedByKey = new Map(
      canonicalRows.map((row) => [getIdentityKey(row), row]),
    );
    const parsedByResolvedKey = new Map(
      resolvedCanonicalRows.map((row) => [getIdentityKey(row), row]),
    );
    const originalKeyByResolvedKey = new Map<string, string>();
    for (let i = 0; i < canonicalRows.length; i += 1) {
      originalKeyByResolvedKey.set(
        getIdentityKey(resolvedCanonicalRows[i]),
        getIdentityKey(canonicalRows[i]),
      );
    }

    const existingRows = await fetchExistingRows(adminDb, resolvedCanonicalRows);
    const activeExistingRows = existingRows.filter((row) => isActiveRecordStatus(row.recordStatus));

    if (
      mode === "new" &&
      duplicateResolution === "reject" &&
      hasIdentityOverlap(resolvedCanonicalRows, activeExistingRows)
    ) {
      return NextResponse.json(
        {
          error:
            "Active TCS exam work orders already exist for this exam/date range. Choose replace or omit before committing the re-upload.",
        },
        { status: 409 },
      );
    }

    const diffRows = buildTcsExamDiff({
      parsedRows: resolvedCanonicalRows,
      existingRows: activeExistingRows,
      mode,
    });

    const commitDiffRows = diffRows.filter((diffRow) => {
      if (diffRow.status === "cancelled") return false;
      const originalRow = parsedByKey.get(diffRow.key);
      const comparisonRow = parsedByResolvedKey.get(diffRow.key) ?? originalRow;
      if (!comparisonRow) return false;
      const existing = findMatchingExistingRow(
        { ...comparisonRow, examName: payload.examName, examCode: payload.examCode },
        activeExistingRows,
      );
      return !(existing && duplicateResolution === "omit");
    });

    const commitDiffKeys = new Set(commitDiffRows.map((row) => row.key));

    const rowsToResolve: TcsExamSourceRow[] = [];
    for (const diffRow of commitDiffRows) {
      const originalKey = originalKeyByResolvedKey.get(diffRow.key);
      const originalRow =
        (originalKey ? parsedByKey.get(originalKey) : undefined) ??
        parsedByKey.get(diffRow.key);
      if (originalRow) rowsToResolve.push(originalRow);
    }

    // ── Phase 1: Commit site writes ──
    const siteWrites: WriteOp[] = [];
    const { resolvedRows, createdSites } = await resolveCommitRows(
      adminDb,
      siteWrites,
      rowsToResolve,
      adminUser,
      activeExistingRows,
    );

    // Commit site writes immediately (typically small, <450 ops)
    if (siteWrites.length > 0) {
      await commitWritesInChunks(adminDb, siteWrites);
    }

    // ── Phase 2: Build resolved lookups for work order phase ──
    const resolvedByOriginalKey = new Map<string, TcsExamSourceRow>();
    const resolvedByResolvedKey = new Map<string, TcsExamSourceRow>();
    for (let index = 0; index < rowsToResolve.length; index += 1) {
      const originalKey = getIdentityKey(rowsToResolve[index]);
      const resolved = resolvedRows[index];
      resolvedByOriginalKey.set(originalKey, resolved);
      resolvedByResolvedKey.set(getIdentityKey(resolved), resolved);
    }

    // ── Phase 3: Build & commit work-order writes in chunks ──
    const importRef = adminDb.collection("workOrderImports").doc();
    const importId = importRef.id;

    // Pre-compute all work-order writes
    const { writes: woWrites, committedRows, cancelledRows } = buildWorkOrderWrites(
      adminDb,
      diffRows,
      commitDiffKeys,
      parsedByKey,
      parsedByResolvedKey,
      originalKeyByResolvedKey,
      resolvedByOriginalKey,
      resolvedByResolvedKey,
      existingRows,
      activeExistingRows,
      adminUser,
      importId,
      payload,
    );

    // Build import doc write (included in last batch)
    const uniqueSites = new Set(
      rowsToResolve.map((row) => `${row.siteId ?? ""}|${row.siteName}|${row.district}`),
    ).size;
    const sortedDates = rowsToResolve.map((row) => row.date).filter(Boolean).sort();
    const importDocWrite: WriteOp = {
      ref: importRef,
      data: {
        id: importId,
        clientName: OPERATIONAL_CLIENT_NAME,
        fileName: payload.fileName,
        binaryFileHash: payload.binaryFileHash,
        contentHash: payload.contentHash,
        examName: payload.examName,
        examCode: payload.examCode,
        parserMode: payload.parserMode,
        mode,
        status: "committed",
        dateRange: {
          from: sortedDates[0] ?? "",
          to: sortedDates[sortedDates.length - 1] ?? "",
        },
        siteCount: uniqueSites,
        rowCount: rowsToResolve.length,
        totalMale: rowsToResolve.reduce<number>(
          (sum, row) => sum + Number(row.maleGuardsRequired ?? 0),
          0,
        ),
        totalFemale: rowsToResolve.reduce<number>(
          (sum, row) => sum + Number(row.femaleGuardsRequired ?? 0),
          0,
        ),
        committedRows,
        cancelledRows,
        warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
        auditTrail: [
          buildServerAuditEvent("work_order_import_committed", adminUser, {
            committedRows,
            cancelledRows,
            mode,
          }),
        ],
        ...buildServerCreateAudit({ uid: adminUser.uid, email: adminUser.email }),
      },
    };

    // Commit all writes in chunks of max BATCH_MAX_OPS (450)
    // to stay within Firestore's batch-operation limit.
    const allWrites = [...woWrites, importDocWrite];
    await commitWritesInChunks(adminDb, allWrites);

    return NextResponse.json({
      importId,
      committedRows,
      cancelledRows,
      createdSites,
      diffRows,
    });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    if (error?.message?.includes("Missing bearer") || error?.message?.includes("token")) {
      return unauthorizedResponse(error.message, 401);
    }
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
