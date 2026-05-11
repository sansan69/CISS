/**
 * Shared TCS site-resolution logic used by both the preview and commit
 * import routes so that diff identity keys are always computed against
 * Firestore site document IDs, never against raw TC centre codes.
 *
 * Without this resolution, a revision upload treats every existing row
 * as "cancelled" and every parsed row as "added" because the `siteId`
 * in parsed rows is the TC centre code (e.g. "KL01") while the `siteId`
 * stored on work-order documents is the Firestore doc ID (e.g. "abc123").
 */

import { OPERATIONAL_CLIENT_NAME } from "@/lib/constants";
import { buildLocationIdentity } from "@/lib/location-utils";
import { districtKey, districtMatches } from "@/lib/districts";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";
import type { TcsExamSourceRow } from "@/types/work-orders";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SiteRecord {
  id: string;
  siteId: string | null;
  siteName: string;
  district: string;
}

export interface SiteLookupMaps {
  byCodeDistrict: Map<string, SiteRecord>;
  byFallback: Map<string, SiteRecord>;
  byCode: Map<string, SiteRecord>;
  byName: Map<string, SiteRecord>;
}

// ---------------------------------------------------------------------------
// Normalisation helpers (mirror the commit-route helpers)
// ---------------------------------------------------------------------------

function normalizeSegment(value: string | number | undefined | null): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildFallbackSiteKey(siteName: string, district: string): string {
  return `${normalizeSegment(siteName)}|district:${districtKey(district) || normalizeSegment(district)}`;
}

function buildSiteCodeDistrictKey(
  siteId: string | null | undefined,
  district: string,
): string {
  const codeKey = normalizeSegment(siteId);
  const resolvedDistrictKey = districtKey(district) || normalizeSegment(district);
  return codeKey && resolvedDistrictKey
    ? `${codeKey}|district:${resolvedDistrictKey}`
    : "";
}

function buildSiteCodeKey(siteId: string | null | undefined): string {
  const codeKey = normalizeSegment(siteId);
  return codeKey ? `code:${codeKey}` : "";
}

function buildSiteNameKey(siteName: string): string {
  const nameKey = normalizeSegment(siteName);
  return nameKey ? `name:${nameKey}` : "";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch *all TCS sites* from Firestore and build the four lookup maps.
 *
 * This is intentionally a full-collection scan because TCS typically has
 * O(100–500) sites — well within Firestore limits for a single `get()`.
 */
export async function buildSiteLookupMaps(
  adminDb: any,
): Promise<SiteLookupMaps> {
  const clientSnap = await adminDb
    .collection("clients")
    .where("name", "==", OPERATIONAL_CLIENT_NAME)
    .get();
  const tcsClientId: string | null = clientSnap.docs[0]?.id ?? null;

  const snapshot = await adminDb.collection("sites").get();

  const byCodeDistrict = new Map<string, SiteRecord>();
  const byFallback = new Map<string, SiteRecord>();
  const byCode = new Map<string, SiteRecord>();
  const byName = new Map<string, SiteRecord>();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const clientNameValue: string =
      typeof data.clientName === "string" ? data.clientName : "";
    const clientIdValue: string =
      typeof data.clientId === "string" ? data.clientId : "";
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

    const cdKey = buildSiteCodeDistrictKey(site.siteId, site.district);
    if (cdKey && !byCodeDistrict.has(cdKey)) {
      byCodeDistrict.set(cdKey, site);
    }
    const fbKey = buildFallbackSiteKey(site.siteName, site.district);
    if (!byFallback.has(fbKey)) {
      byFallback.set(fbKey, site);
    }
    const cKey = buildSiteCodeKey(site.siteId);
    if (cKey && !byCode.has(cKey)) {
      byCode.set(cKey, site);
    }
    const nKey = buildSiteNameKey(site.siteName);
    if (nKey && !byName.has(nKey)) {
      byName.set(nKey, site);
    }
  }

  return { byCodeDistrict, byFallback, byCode, byName };
}

/**
 * Resolve the Firestore site document ID for a single parsed row, using
 * the same priority order as `resolveCommitRows`:
 *
 *   1. Exact (siteId + district)
 *   2. Fallback (siteName + district)
 *   3. siteId-only
 *   4. siteName-only
 *
 * Returns the Firestore doc ID string, or `null` when no matching site
 * exists (the caller can decide whether to create one).
 */
export function resolveOneSiteId(
  row: TcsExamSourceRow,
  maps: SiteLookupMaps,
): SiteRecord | null {
  const cdKey = buildSiteCodeDistrictKey(row.siteId, row.district);
  const fbKey = buildFallbackSiteKey(row.siteName, row.district);
  const cKey = buildSiteCodeKey(row.siteId);
  const nKey = buildSiteNameKey(row.siteName);

  const site =
    (cdKey && maps.byCodeDistrict.get(cdKey)) ||
    maps.byFallback.get(fbKey) ||
    (cKey ? maps.byCode.get(cKey) : undefined) ||
    (nKey ? maps.byName.get(nKey) : undefined);

  return site ?? null;
}

/**
 * Given parsed rows (carrying TC centre codes as `siteId`) and site lookup
 * maps, return a copy of the rows with `siteId` replaced by the Firestore
 * site document ID.
 *
 * Rows that cannot be matched to any existing site keep their original
 * `siteId` so the diff still produces a unique identity key (they will be
 * created later during commit).
 */
export function resolveParsedRowSiteIds(
  rows: readonly TcsExamSourceRow[],
  maps: SiteLookupMaps,
): TcsExamSourceRow[] {
  return rows.map((row) => {
    const site = resolveOneSiteId(row, maps);
    if (!site) return row; // no existing site → keep TC code
    return {
      ...row,
      siteId: site.id,
      // Keep the "better" name/district from Firestore when available
      siteName: site.siteName || row.siteName,
      district: site.district || row.district,
    };
  });
}
