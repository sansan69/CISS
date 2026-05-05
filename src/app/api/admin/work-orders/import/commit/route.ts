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
  // Run every district through the shared resolver so TCS imports always
  // store one of the canonical Kerala district names. Operational zone
  // labels (e.g. "South 2") are mapped first; aliases (Trivandrum, Cochin,
  // …) are then canonicalised to the field-officer-facing district name.
  const zoneNormalized = normalizeOperationalZoneLabel(value as string | null | undefined);
  if (!zoneNormalized) return "";
  if (isCanonicalKeralaDistrict(zoneNormalized)) {
    return canonicalizeDistrictName(zoneNormalized) || zoneNormalized;
  }
  return zoneNormalized;
}

function hasConcreteSiteId(row: {
  siteId?: string;
}) {
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
  if (!parsed) {
    return "";
  }
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
  existingRows: readonly ExistingWorkOrderRecord[],
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
  return buildWorkOrderDocId({
    ...row,
    examCode,
  });
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

async function fetchExistingRows(
  adminDb: {
    collection: (name: string) => {
      get: () => Promise<{
        docs: Array<{ id: string; data: () => Record<string, unknown> }>;
      }>;
    };
  },
  parsedRows: readonly TcsExamSourceRow[],
): Promise<ExistingWorkOrderRecord[]> {
  const relevantExamCodes = new Set(parsedRows.map((row) => row.examCode ?? "").filter(Boolean));
  const snapshot = await adminDb.collection("workOrders").get();

  return snapshot.docs
    .map((doc) => {
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
        assignedGuards: Array.isArray(data.assignedGuards) ? data.assignedGuards : [],
        sourceFileName:
          typeof data.sourceFileName === "string" ? data.sourceFileName : undefined,
        sourceSheetName:
          typeof data.sourceSheetName === "string" ? data.sourceSheetName : undefined,
        binaryFileHash:
          typeof data.binaryFileHash === "string" ? data.binaryFileHash : undefined,
        contentHash: typeof data.contentHash === "string" ? data.contentHash : undefined,
      } satisfies ExistingWorkOrderRecord;
    })
    .filter((row) => isOperationalWorkOrderClientName(row.clientName))
    .filter((row) => row.date !== "")
    .filter((row) =>
      relevantExamCodes.size === 0 ? true : relevantExamCodes.has(row.examCode),
    );
}

async function fetchSites(
  adminDb: any,
  tcsClientId: string | null,
) {
  const snapshot = await adminDb.collection("sites").get();
  const byCodeDistrict = new Map<string, SiteRecord>();
  const byFallback = new Map<string, SiteRecord>();
  const byCode = new Map<string, SiteRecord>();
  const byName = new Map<string, SiteRecord>();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const clientNameValue = typeof data.clientName === "string" ? data.clientName : "";
    const clientIdValue = typeof data.clientId === "string" ? data.clientId : "";
    // Accept the canonical TCS client AND any pre-existing TCS variants linked
    // via clientId. This prevents the importer from creating duplicate sites
    // for legacy records whose clientName drifted from the strict constant.
    const isTcsClient =
      isOperationalWorkOrderClientName(clientNameValue) ||
      (Boolean(tcsClientId) && clientIdValue === tcsClientId);
    if (!isTcsClient) {
      continue;
    }
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

async function resolveCommitRows(
  adminDb: any,
  batch: any,
  rows: readonly TcsExamSourceRow[],
  adminUser: { uid: string; email?: string | null },
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
    const codeDistrictKey = buildSiteCodeDistrictKey(row.siteId, row.district);
    const fallbackKey = buildFallbackSiteKey(row.siteName, row.district);
    const codeKey = buildSiteCodeKey(row.siteId);
    const nameKey = buildSiteNameKey(row.siteName);
    // Lookup priority:
    //   1. Exact (siteId + district) match — same site, same district.
    //   2. Exact (siteName + district) fallback for files without site IDs.
    //   3. siteId-only — same TC code but the existing record has a stale
    //      district (e.g. "South 2" → "Ernakulam"). Update in place rather
    //      than creating a duplicate.
    //   4. siteName-only — same fallback story when there is no siteId at all.
    let site =
      (codeDistrictKey && sites.byCodeDistrict.get(codeDistrictKey)) ||
      sites.byFallback.get(fallbackKey) ||
      (codeKey ? sites.byCode.get(codeKey) : undefined) ||
      (nameKey ? sites.byName.get(nameKey) : undefined);

    if (site && row.district && !districtMatches(row.district, site.district)) {
      batch.update(adminDb.collection("sites").doc(site.id), {
        district: row.district,
        clientName: OPERATIONAL_CLIENT_NAME,
        clientId: tcsClientId,
        locationKey: buildLocationIdentity([OPERATIONAL_CLIENT_NAME, row.siteName, row.district]),
        ...buildServerUpdateAudit({
          uid: adminUser.uid,
          email: adminUser.email ?? undefined,
        }),
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
      batch.set(siteRef, sitePayload);
      site = {
        id: siteRef.id,
        siteId: sitePayload.siteId,
        siteName: row.siteName,
        district: row.district,
      };
      createdSites += 1;
      if (codeDistrictKey) {
        sites.byCodeDistrict.set(codeDistrictKey, site);
      }
      sites.byFallback.set(fallbackKey, site);
      if (codeKey) {
        sites.byCode.set(codeKey, site);
      }
      if (nameKey) {
        sites.byName.set(nameKey, site);
      }
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
    const existingRows = await fetchExistingRows(adminDb, canonicalRows);
    const activeExistingRows = existingRows.filter(
      (row) => isActiveRecordStatus(row.recordStatus),
    );

    if (
      mode === "new" &&
      duplicateResolution === "reject" &&
      hasIdentityOverlap(canonicalRows, activeExistingRows)
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
      parsedRows: canonicalRows,
      existingRows: activeExistingRows,
      mode,
    });

    const parsedByKey = new Map(
      canonicalRows.map((row) => [getIdentityKey(row), row]),
    );

    const commitDiffRows = diffRows.filter((diffRow) => {
      if (diffRow.status === "cancelled") {
        return false;
      }
      const parsedRow = parsedByKey.get(diffRow.key);
      if (!parsedRow) {
        return false;
      }
      const existing = findMatchingExistingRow(
        {
          ...parsedRow,
          examName: payload.examName,
          examCode: payload.examCode,
        },
        activeExistingRows,
      );
      return !(existing && duplicateResolution === "omit");
    });
    const commitDiffKeys = new Set(commitDiffRows.map((row) => row.key));
    const rowsToResolve = commitDiffRows.reduce<TcsExamSourceRow[]>((rows, diffRow) => {
      const row = parsedByKey.get(diffRow.key);
      if (row) {
        rows.push(row);
      }
      return rows;
    }, []);

    const importRef = adminDb.collection("workOrderImports").doc();
    const importId = importRef.id;
    const batch = adminDb.batch();
    const { resolvedRows, createdSites } = await resolveCommitRows(
      adminDb,
      batch,
      rowsToResolve,
      adminUser,
    );

    const resolvedByOriginalKey = new Map<string, TcsExamSourceRow>();
    for (let index = 0; index < rowsToResolve.length; index += 1) {
      resolvedByOriginalKey.set(getIdentityKey(rowsToResolve[index]), resolvedRows[index]);
    }

    let committedRows = 0;
    let cancelledRows = 0;

    for (const diffRow of diffRows) {
      if (diffRow.status === "cancelled") {
        const existing = activeExistingRows.find((row) => getIdentityKey(row) === diffRow.key);
        if (!existing) {
          continue;
        }

        cancelledRows += 1;
        batch.update(adminDb.collection("workOrders").doc(existing.id), {
          recordStatus: "cancelled",
          cancelledByImportId: importId,
          ...buildServerUpdateAudit({
            uid: adminUser.uid,
            email: adminUser.email,
          }),
        });
        continue;
      }

      if (!commitDiffKeys.has(diffRow.key)) {
        continue;
      }

      const originalParsedRow = parsedByKey.get(diffRow.key);
      const parsedRow = originalParsedRow
        ? resolvedByOriginalKey.get(getIdentityKey(originalParsedRow)) ?? originalParsedRow
        : null;
      if (!parsedRow || !originalParsedRow) {
        continue;
      }

      const authoritativeRow = {
        ...originalParsedRow,
        examName: payload.examName,
        examCode: payload.examCode,
      };
      const existing = findMatchingExistingRow(authoritativeRow, activeExistingRows);

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
        assignedGuards: Array.isArray(existing?.assignedGuards)
          ? existing.assignedGuards
          : [],
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
        batch.set(
          workOrderRef,
          {
            ...basePayload,
            ...buildServerUpdateAudit({
              uid: adminUser.uid,
              email: adminUser.email,
            }),
          },
          { merge: true },
        );
      } else {
        batch.set(workOrderRef, {
          id: targetId,
          ...basePayload,
          ...buildServerCreateAudit({
            uid: adminUser.uid,
            email: adminUser.email,
          }),
        });
      }
    }

    const uniqueSites = new Set(
      rowsToResolve.map((row) => `${row.siteId ?? ""}|${row.siteName}|${row.district}`),
    ).size;
    const sortedDates = rowsToResolve.map((row) => row.date).filter(Boolean).sort();
    batch.set(importRef, {
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
      ...buildServerCreateAudit({
        uid: adminUser.uid,
        email: adminUser.email,
      }),
    });

    await batch.commit();

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
