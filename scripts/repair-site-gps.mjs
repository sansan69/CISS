#!/usr/bin/env node

import { config as loadEnv } from "dotenv";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { GeoPoint, getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const READY_STATUSES = new Set(["geocoded", "verified", "overridden"]);
const INDIA_BOUNDS = { latMin: 6, latMax: 37, lngMin: 68, lngMax: 98 };
const INDIA_FORWARD_BOUNDS = "68,6,98,37";
const STATE_NORMALIZATION_MAP = {
  "tamil nadu": "Tamil Nadu",
  "tamilnadu": "Tamil Nadu",
  "tamill nadu": "Tamil Nadu",
  "tamilnadu state": "Tamil Nadu",
  "pondicherry": "Puducherry",
  "orissa": "Odisha",
};

function readCoordinatePart(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function extractSiteCoordinates(input) {
  const lat =
    readCoordinatePart(input?.geolocation?.latitude) ??
    readCoordinatePart(input?.geolocation?.lat) ??
    readCoordinatePart(input?.geolocation?._latitude) ??
    readCoordinatePart(input?.latString);
  const lng =
    readCoordinatePart(input?.geolocation?.longitude) ??
    readCoordinatePart(input?.geolocation?.lng) ??
    readCoordinatePart(input?.geolocation?._longitude) ??
    readCoordinatePart(input?.lngString);

  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function isWithinIndiaBounds(lat, lng) {
  return (
    lat >= INDIA_BOUNDS.latMin &&
    lat <= INDIA_BOUNDS.latMax &&
    lng >= INDIA_BOUNDS.lngMin &&
    lng <= INDIA_BOUNDS.lngMax
  );
}

function normalizeIndianStateName(state) {
  const trimmed = typeof state === "string" ? state.trim() : "";
  if (!trimmed) return undefined;
  return STATE_NORMALIZATION_MAP[trimmed.replace(/\s+/g, " ").toLowerCase()] ?? trimmed;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

function extractIndianPostcode(text) {
  return text?.match(/\b\d{6}\b/)?.[0];
}

function buildForwardQuery(site) {
  const address = site.siteAddress?.trim();
  const district = site.district?.trim();
  const state = normalizeIndianStateName(site.state);
  const addressText = normalizeText(address);
  const parts = [];

  if (address) parts.push(address);
  if (district && !addressText.includes(normalizeText(district))) parts.push(district);
  if (state && !addressText.includes(normalizeText(state))) parts.push(state);
  if (!addressText.includes("india")) parts.push("India");

  return parts.join(", ");
}

function buildForwardQueries(site) {
  const district = site.district?.trim();
  const state = normalizeIndianStateName(site.state);
  const postcode = extractIndianPostcode(site.siteAddress);
  const queries = [
    buildForwardQuery(site),
    site.siteName?.trim() ? [site.siteName.trim(), district, state, "India"].filter(Boolean).join(", ") : "",
    postcode ? [postcode, district, state, "India"].filter(Boolean).join(", ") : "",
    district ? [district, state, "India"].filter(Boolean).join(", ") : "",
  ].filter(Boolean);

  return Array.from(new Set(queries));
}

function isAcceptableForwardResult(result) {
  const lat = result?.geometry?.lat;
  const lng = result?.geometry?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return false;

  const countryCode = String(result?.components?.country_code || "").toLowerCase();
  if (countryCode && countryCode !== "in") return false;

  const type = String(result?.components?._type || "").toLowerCase();
  if (type === "state" || type === "country" || type === "continent") return false;

  return true;
}

function classifySiteGpsState(input) {
  const coordinates = extractSiteCoordinates(input);
  if (!coordinates) return "missing_coords";
  if (!isWithinIndiaBounds(coordinates.lat, coordinates.lng)) return "invalid_coords";
  if (!READY_STATUSES.has(String(input?.coordinateStatus || "").trim())) return "missing_status";
  return "ok";
}

function sanitizeApiKey() {
  return process.env.OPENCAGE_API_KEY?.trim().replace(/^['"]|['"]$/g, "");
}

function parseArgs(argv) {
  const parsed = {
    apply: false,
    clientId: undefined,
    limit: undefined,
  };

  for (const arg of argv) {
    if (arg === "--apply") parsed.apply = true;
    else if (arg.startsWith("--clientId=")) parsed.clientId = arg.slice("--clientId=".length);
    else if (arg.startsWith("--limit=")) {
      const limit = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(limit) && limit > 0) parsed.limit = limit;
    }
  }

  return parsed;
}

function loadEnvironment() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    loadEnv({ path: envPath });
  } else {
    loadEnv();
  }
}

function initializeAdmin() {
  if (getApps().length > 0) return getApps()[0];

  if (process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64) {
    const decoded = Buffer.from(
      process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64,
      "base64",
    ).toString("utf8");
    return initializeApp({
      credential: cert(JSON.parse(decoded)),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
  }

  if (process.env.FIREBASE_ADMIN_SDK_CONFIG) {
    return initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_SDK_CONFIG)),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
  }

  if (
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
    process.env.FIREBASE_ADMIN_PRIVATE_KEY
  ) {
    return initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
  }

  throw new Error("Missing Firebase Admin credentials. Check .env.local.");
}

async function lookupLocationGeocode(site) {
  const apiKey = sanitizeApiKey();
  if (!apiKey) {
    throw new Error("Missing OPENCAGE_API_KEY in environment.");
  }

  const address = site.siteAddress?.trim();
  if (!address) {
    throw new Error("Missing address");
  }

  const url = new URL("https://api.opencagedata.com/geocode/v1/json");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("limit", "1");
  url.searchParams.set("no_annotations", "0");
  url.searchParams.set("countrycode", "in");
  url.searchParams.set("bounds", INDIA_FORWARD_BOUNDS);
  let first;

  for (const query of buildForwardQueries(site)) {
    url.searchParams.set("q", query);
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Provider error ${response.status}: ${body || response.statusText}`);
    }

    const payload = await response.json();
    first = payload?.results?.find(isAcceptableForwardResult);
    if (first) break;
  }

  const lat = first?.geometry?.lat;
  const lng = first?.geometry?.lng;

  if (typeof lat !== "number" || typeof lng !== "number") {
    throw new Error("No coordinates found for the given location.");
  }

  return {
    lat,
    lng,
    placeAccuracy:
      typeof first?.confidence === "number"
        ? `OpenCage confidence ${first.confidence}/10`
        : undefined,
  };
}

function formatCoords(coords) {
  return coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : "—";
}

async function main() {
  loadEnvironment();

  if (!process.version.startsWith("v22.")) {
    console.warn(
      `Warning: expected Node 22.x but found ${process.version}. Use: npx -y node@22 scripts/repair-site-gps.mjs`,
    );
  }

  const options = parseArgs(process.argv.slice(2));
  initializeAdmin();
  const db = getFirestore();

  let query = db.collection("sites");
  if (options.clientId) {
    query = query.where("clientId", "==", options.clientId);
  }

  const snapshot = await query.get();
  const docs = options.limit ? snapshot.docs.slice(0, options.limit) : snapshot.docs;

  let inspected = 0;
  let repairedStatus = 0;
  let geocoded = 0;
  let skipped = 0;
  let failed = 0;
  let stateNormalized = 0;

  let batch = db.batch();
  let writes = 0;

  const flushBatch = async () => {
    if (!options.apply || !writes) return;
    await batch.commit();
    batch = db.batch();
    writes = 0;
  };

  for (const siteDoc of docs) {
    inspected += 1;
    const site = siteDoc.data();
    const gpsState = classifySiteGpsState(site);
    const existingCoords = extractSiteCoordinates(site);
    const normalizedState = normalizeIndianStateName(site.state);

    if (gpsState === "ok") {
      skipped += 1;
      continue;
    }

    try {
      if (gpsState === "missing_status" && existingCoords && !site.siteAddress?.trim()) {
        const update = {
          geolocation: new GeoPoint(existingCoords.lat, existingCoords.lng),
          latString: site.latString || existingCoords.lat.toFixed(6),
          lngString: site.lngString || existingCoords.lng.toFixed(6),
          coordinateStatus: "verified",
          coordinateSource: site.coordinateSource || "manual",
          ...(normalizedState && normalizedState !== site.state ? { state: normalizedState } : {}),
          updatedAt: new Date(),
        };

        if (options.apply) {
          batch.update(siteDoc.ref, update);
          writes += 1;
        }

        repairedStatus += 1;
        if (normalizedState && normalizedState !== site.state) stateNormalized += 1;
        console.log(
          `[status] ${site.siteName || siteDoc.id} -> ${formatCoords(existingCoords)} kept because no address was available`,
        );
      } else {
        const geocode = await lookupLocationGeocode(site);
        const update = {
          geolocation: new GeoPoint(geocode.lat, geocode.lng),
          latString: geocode.lat.toFixed(6),
          lngString: geocode.lng.toFixed(6),
          coordinateStatus: "geocoded",
          coordinateSource: "geocode",
          placeAccuracy: geocode.placeAccuracy ?? null,
          geocodedAt: new Date(),
          ...(normalizedState && normalizedState !== site.state ? { state: normalizedState } : {}),
          updatedAt: new Date(),
        };

        if (options.apply) {
          batch.update(siteDoc.ref, update);
          writes += 1;
        }

        geocoded += 1;
        if (normalizedState && normalizedState !== site.state) stateNormalized += 1;
        console.log(
          `[geocode] ${site.siteName || siteDoc.id} ${formatCoords(existingCoords)} -> ${geocode.lat.toFixed(6)}, ${geocode.lng.toFixed(6)}`,
        );
      }

      if (writes >= 400) {
        await flushBatch();
      }
    } catch (error) {
      failed += 1;
      console.error(`[failed] ${site.siteName || siteDoc.id}: ${error.message}`);
    }
  }

  await flushBatch();

  console.log("");
  console.log(options.apply ? "Applied GPS repair." : "Dry run complete. No Firestore writes were committed.");
  console.log(`Inspected: ${inspected}`);
  console.log(`Status repaired: ${repairedStatus}`);
  console.log(`Geocoded: ${geocoded}`);
  console.log(`Skipped already healthy: ${skipped}`);
  console.log(`State names normalized: ${stateNormalized}`);
  console.log(`Failed: ${failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
