#!/usr/bin/env node
/**
 * Geocode sites that have no coordinates yet.
 *
 * Default is a DRY RUN. Pass --apply to write. Nothing is written in dry-run
 * mode, and no existing coordinate is ever overwritten.
 *
 * Selection: site documents where `latitude`/`longitude` (top level or inside
 * `geolocation`) are missing or null. Sites that already carry a coordinate in
 * any supported shape are skipped.
 *
 * Geocoding: OpenCage forward geocode, one request per second, India-only,
 * biased to the Kerala bounding box. Per site it tries `address + district +
 * "Kerala, India"` first and falls back to `siteName + district + "Kerala, India"`.
 *
 * Acceptance: OpenCage confidence >= 7 AND the returned coordinate inside the
 * Kerala bounding box (lat 8.0–12.9, lng 74.5–77.5). Anything else is reported
 * for manual review and left untouched.
 *
 * Fields written on accepted sites (all additive):
 *   latitude, longitude           numbers (the canonical pair for API consumers)
 *   geolocation                   GeoPoint — the field attendance geofencing reads
 *   latString, lngString          6 dp strings, because the collection convention
 *                                 is latString/lngString on 163/180 site docs
 *   coordinateStatus              "geocoded"
 *   coordinateSource              "geocode"
 *   placeAccuracy                 "OpenCage confidence N/10"
 *   geocodeSource                 "opencage"
 *   geocodeConfidence             number 0–10
 *   geocodedAt, updatedAt         server timestamps
 *
 * Usage:
 *   node --env-file=.env.local scripts/geocode-missing-sites.mjs
 *   node --env-file=.env.local scripts/geocode-missing-sites.mjs --apply
 *   node --env-file=.env.local scripts/geocode-missing-sites.mjs --limit=5
 *   node --env-file=.env.local scripts/geocode-missing-sites.mjs --only=<siteDocId>
 */
import admin from "firebase-admin";
import { GeoPoint } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const LIMIT = (() => {
  const raw = process.argv.find((a) => a.startsWith("--limit="))?.slice("--limit=".length);
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
})();

/** Kerala bounding box — the only area we accept an automatic coordinate for. */
const KERALA = { latMin: 8.0, latMax: 12.9, lngMin: 74.5, lngMax: 77.5 };
/** OpenCage `bounds` param order is min_lng,min_lat,max_lng,max_lat. */
const KERALA_BOUNDS = `${KERALA.lngMin},${KERALA.latMin},${KERALA.lngMax},${KERALA.latMax}`;
const MIN_CONFIDENCE = 7;
const REQUEST_INTERVAL_MS = 1000; // OpenCage free tier: 1 request/second.
const WRITE_BATCH = 300;

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = admin.firestore();

/* ------------------------------------------------------------------ helpers */

function readNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Any coordinate already present on the document, whatever shape it uses:
 * GeoPoint, plain {lat,lng}, {latitude,longitude}, or string fallbacks.
 */
function existingCoordinates(site) {
  const geo = site.geolocation ?? {};
  const lat =
    readNumber(site.latitude) ??
    readNumber(geo.latitude) ??
    readNumber(geo._latitude) ??
    readNumber(geo.lat) ??
    readNumber(site.latString);
  const lng =
    readNumber(site.longitude) ??
    readNumber(geo.longitude) ??
    readNumber(geo._longitude) ??
    readNumber(geo.lng) ??
    readNumber(site.lngString);
  return lat != null && lng != null ? { lat, lng } : null;
}

function insideKerala(lat, lng) {
  return (
    lat >= KERALA.latMin && lat <= KERALA.latMax && lng >= KERALA.lngMin && lng <= KERALA.lngMax
  );
}

function formatCoords(lat, lng) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function normalize(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

function joinQuery(parts) {
  return parts.filter((p) => typeof p === "string" && p.trim()).join(", ");
}

let lastRequestAt = 0;
async function throttle() {
  const wait = REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

function isUsableResult(result) {
  const lat = result?.geometry?.lat;
  const lng = result?.geometry?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  const countryCode = String(result?.components?.country_code ?? "").toLowerCase();
  if (countryCode && countryCode !== "in") return false;
  const type = String(result?.components?._type ?? "").toLowerCase();
  if (type === "state" || type === "country" || type === "continent") return false;
  return true;
}

async function geocodeQuery(apiKey, query) {
  await throttle();
  const url = new URL("https://api.opencagedata.com/geocode/v1/json");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "3");
  url.searchParams.set("no_annotations", "0");
  url.searchParams.set("countrycode", "in");
  url.searchParams.set("bounds", KERALA_BOUNDS);
  url.searchParams.set("language", "en");

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`OpenCage HTTP ${response.status}: ${body || response.statusText}`);
  }
  const payload = await response.json();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.find(isUsableResult) ?? null;
}

function buildQueries(site) {
  const district = site.district?.trim();
  const address = site.siteAddress?.trim();
  const siteName = site.siteName?.trim();
  const districtText = normalize(district);

  const withDistrict = (head) => {
    const parts = [head];
    if (district && !normalize(head).includes(districtText)) parts.push(district);
    return joinQuery([...parts, "Kerala, India"]);
  };

  const queries = [];
  if (address) queries.push(withDistrict(address));
  if (siteName) queries.push(withDistrict(siteName));
  return Array.from(new Set(queries.filter(Boolean)));
}

/* ---------------------------------------------------------------- selection */

const collection = db.collection("sites");
const snapshot = ONLY ? [await collection.doc(ONLY).get()] : (await collection.get()).docs;

const allSites = ONLY
  ? snapshot.filter((d) => d.exists).map((d) => ({ id: d.id, ref: d.ref, data: d.data() ?? {} }))
  : snapshot.map((d) => ({ id: d.id, ref: d.ref, data: d.data() ?? {} }));

// Does the collection use the latString/lngString convention? 163/180 docs do.
const latStringConvention = (() => {
  const withKeys = allSites.filter(
    (s) => Object.prototype.hasOwnProperty.call(s.data, "latString") || Object.prototype.hasOwnProperty.call(s.data, "lngString"),
  ).length;
  return withKeys / Math.max(allSites.length, 1) >= 0.5;
})();

let targets = allSites.filter((s) => existingCoordinates(s.data) === null);
const alreadyPlaced = allSites.filter((s) => existingCoordinates(s.data) !== null).length;
const totalSites = allSites.length;
if (LIMIT) targets = targets.slice(0, LIMIT);

console.log(`mode=${APPLY ? "APPLY" : "dry-run"}`);
console.log(
  `sites=${totalSites} with_coordinates=${alreadyPlaced} missing_coordinates=${targets.length} latString_convention=${latStringConvention}`,
);
console.log(
  `policy: confidence>=${MIN_CONFIDENCE}, kerala_bbox lat ${KERALA.latMin}-${KERALA.latMax} lng ${KERALA.lngMin}-${KERALA.lngMax}, 1 req/s`,
);
if (!APPLY) console.log("No writes will be committed. Re-run with --apply to write accepted coordinates.");
console.log("");

/* ---------------------------------------------------------------- main loop */

const apiKey = process.env.OPENCAGE_API_KEY?.trim().replace(/^['"]|['"]$/g, "");
if (!apiKey) {
  console.error("OPENCAGE_API_KEY is missing from the environment (.env.local).");
  process.exit(1);
}

const accepted = [];
const manualReview = [];
const counters = {
  accepted: 0,
  low_confidence: 0,
  outside_kerala: 0,
  unresolved: 0,
  error: 0,
  skipped_existing: 0,
};

for (const site of targets) {
  const { id, ref, data } = site;
  const label = `${id} ${data.district ?? "-"}`;

  let result = null;
  let error = null;
  try {
    for (const query of buildQueries(data)) {
      result = await geocodeQuery(apiKey, query);
      if (result) break;
    }
  } catch (err) {
    error = err;
  }

  if (error) {
    counters.error += 1;
    console.log(`[${label}] conf=- result=error ${error.message}`);
    manualReview.push({ id, district: data.district ?? null, siteName: data.siteName ?? null, result: "error", confidence: null, detail: error.message });
    continue;
  }

  if (!result) {
    counters.unresolved += 1;
    console.log(`[${label}] conf=- result=unresolved (no usable OpenCage result)`);
    manualReview.push({ id, district: data.district ?? null, siteName: data.siteName ?? null, result: "unresolved", confidence: null, detail: "no usable result" });
    continue;
  }

  const confidence = typeof result.confidence === "number" ? result.confidence : null;
  const lat = result.geometry.lat;
  const lng = result.geometry.lng;
  const confText = confidence == null ? "-" : String(confidence);

  if (confidence == null || confidence < MIN_CONFIDENCE) {
    counters.low_confidence += 1;
    console.log(`[${label}] conf=${confText} result=low_confidence candidate=${formatCoords(lat, lng)}`);
    manualReview.push({ id, district: data.district ?? null, siteName: data.siteName ?? null, result: "low_confidence", confidence, detail: formatCoords(lat, lng) });
    continue;
  }

  if (!insideKerala(lat, lng)) {
    counters.outside_kerala += 1;
    console.log(`[${label}] conf=${confText} result=outside_kerala candidate=${formatCoords(lat, lng)}`);
    manualReview.push({ id, district: data.district ?? null, siteName: data.siteName ?? null, result: "outside_kerala", confidence, detail: formatCoords(lat, lng) });
    continue;
  }

  counters.accepted += 1;
  console.log(`[${label}] conf=${confText} result=accepted ${formatCoords(lat, lng)}`);
  accepted.push({ id, ref, data, lat, lng, confidence });
}

/* ------------------------------------------------------------------- writes */

let written = 0;
const skippedAtWrite = [];

if (APPLY && accepted.length) {
  let batch = db.batch();
  let pending = 0;
  for (const site of accepted) {
    // Re-read at write time so a coordinate added in the last few seconds is
    // never overwritten.
    const current = await site.ref.get();
    if (!current.exists) {
      skippedAtWrite.push({ id: site.id, reason: "document vanished" });
      continue;
    }
    if (existingCoordinates(current.data() ?? {}) !== null) {
      counters.skipped_existing += 1;
      skippedAtWrite.push({ id: site.id, reason: "coordinate appeared before write" });
      continue;
    }

    const update = {
      latitude: site.lat,
      longitude: site.lng,
      geolocation: new GeoPoint(site.lat, site.lng),
      coordinateStatus: "geocoded",
      coordinateSource: "geocode",
      placeAccuracy: `OpenCage confidence ${site.confidence}/10`,
      geocodeSource: "opencage",
      geocodeConfidence: site.confidence,
      geocodedAt: new Date(),
      updatedAt: new Date(),
    };
    if (latStringConvention) {
      update.latString = site.lat.toFixed(6);
      update.lngString = site.lng.toFixed(6);
    }

    batch.update(site.ref, update);
    pending += 1;

    if (pending >= WRITE_BATCH) {
      await batch.commit();
      written += pending;
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending) {
    await batch.commit();
    written += pending;
  }
}

/* ------------------------------------------------------------------ summary */

console.log("");
console.log(APPLY ? `Applied: ${written} site(s) updated.` : `Dry run complete: ${accepted.length} site(s) would be updated.`);
console.log(`  accepted (conf>=${MIN_CONFIDENCE}, inside Kerala): ${counters.accepted}${APPLY ? ` (written ${written})` : ""}`);
console.log(`  low confidence (<${MIN_CONFIDENCE}): ${counters.low_confidence}`);
console.log(`  outside Kerala bbox: ${counters.outside_kerala}`);
console.log(`  unresolved: ${counters.unresolved}`);
console.log(`  provider/network errors: ${counters.error}`);
if (APPLY) {
  console.log(`  skipped at write time (coordinate appeared): ${counters.skipped_existing}`);
  for (const s of skippedAtWrite) console.log(`    - ${s.id}: ${s.reason}`);
}

if (manualReview.length) {
  console.log("");
  console.log(`Manual review required (${manualReview.length}):`);
  for (const row of manualReview) {
    console.log(
      `  - id=${row.id} district=${row.district ?? "-"} name=${row.siteName ?? "-"} result=${row.result} conf=${row.confidence ?? "-"} ${row.detail ?? ""}`.trimEnd(),
    );
  }
}

if (APPLY && written) {
  console.log("");
  console.log("Written fields: latitude, longitude, geolocation (GeoPoint), coordinateStatus=\"geocoded\", coordinateSource=\"geocode\", placeAccuracy, geocodeSource, geocodeConfidence, geocodedAt, updatedAt" + (latStringConvention ? ", latString, lngString" : ""));
}
