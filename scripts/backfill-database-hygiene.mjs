#!/usr/bin/env node
/**
 * Deterministic backfills for the issues found by the 2026-10-26 database audit.
 *
 * Default is a dry run. Pass --apply to write.
 *
 * Scope (ciss-workforce is the Kerala deployment):
 *   1. employees.stateCode -> REGION_CODE when missing.
 *   2. employees.clientId -> the unique clients doc whose name/clientName
 *      matches the employee's clientName (case/punctuation-insensitive).
 *   3. attendanceLogs.district -> the employee's district (fallback: the site's
 *      district) when missing.
 *   4. sites.siteId -> string when stored as a number (numbers and strings are
 *      currently mixed, which breaks site-code joins).
 *
 * It does not invent coordinates, does not touch geofence radii, does not
 * create or delete documents, and does not modify attendance state/sessions.
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-database-hygiene.mjs
 *   node --env-file=.env.local scripts/backfill-database-hygiene.mjs --apply
 */
import admin from "firebase-admin";

const APPLY = process.argv.includes("--apply");
const REGION_CODE =
  (process.env.NEXT_PUBLIC_REGION_CODE || process.env.REGION_CODE || "KL")
    .trim()
    .toUpperCase();
const BATCH = 400;

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = admin.firestore();

function clientKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function commitUpdates(updates, label) {
  if (!APPLY) {
    console.log(`[${label}] would update=${updates.length}`);
    return;
  }
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = db.batch();
    for (const { ref, data } of updates.slice(i, i + BATCH)) {
      batch.update(ref, data);
    }
    await batch.commit();
  }
  console.log(`[${label}] updated=${updates.length}`);
}

async function main() {
  console.log(`mode=${APPLY ? "APPLY" : "dry-run"} region=${REGION_CODE}`);

  const [clientsSnap, employeesSnap, sitesSnap, logsSnap] = await Promise.all([
    db.collection("clients").get(),
    db.collection("employees").get(),
    db.collection("sites").get(),
    db.collection("attendanceLogs").get(),
  ]);

  const clientsByName = new Map();
  for (const doc of clientsSnap.docs) {
    const data = doc.data();
    for (const name of [data.name, data.clientName]) {
      const key = clientKey(name);
      if (!key) continue;
      const existing = clientsByName.get(key) ?? new Set();
      existing.add(doc.id);
      clientsByName.set(key, existing);
    }
  }

  const employeesById = new Map();
  for (const doc of employeesSnap.docs) employeesById.set(doc.id, doc.data());

  const sitesById = new Map();
  for (const doc of sitesSnap.docs) sitesById.set(doc.id, doc.data());

  // 1 + 2 — employee region and client id.
  const employeeUpdates = [];
  let missingState = 0;
  let clientResolved = 0;
  for (const doc of employeesSnap.docs) {
    const data = doc.data();
    const patch = {};
    if (!data.stateCode) {
      patch.stateCode = REGION_CODE;
      missingState += 1;
    }
    if (!data.clientId && data.clientName) {
      const matches = clientsByName.get(clientKey(data.clientName));
      if (matches && matches.size === 1) {
        patch.clientId = [...matches][0];
        clientResolved += 1;
      }
    }
    if (Object.keys(patch).length > 0) {
      employeeUpdates.push({ ref: doc.ref, data: patch });
    }
  }
  await commitUpdates(employeeUpdates, "employees stateCode/clientId");
  console.log(
    `[employees] scanned=${employeesSnap.size} missingStateCode=${missingState} clientIdResolved=${clientResolved}`,
  );

  // 3 — attendance log district.
  const logUpdates = [];
  let districtResolved = 0;
  let districtUnresolved = 0;
  for (const doc of logsSnap.docs) {
    const data = doc.data();
    if (data.district) continue;
    const employee = data.employeeDocId
      ? employeesById.get(data.employeeDocId)
      : null;
    const site = data.siteId ? sitesById.get(String(data.siteId)) : null;
    const district = employee?.district || site?.district || null;
    if (district) {
      logUpdates.push({ ref: doc.ref, data: { district } });
      districtResolved += 1;
    } else {
      districtUnresolved += 1;
    }
  }
  await commitUpdates(logUpdates, "attendanceLogs district");
  console.log(
    `[attendanceLogs] scanned=${logsSnap.size} districtResolved=${districtResolved} districtUnresolved=${districtUnresolved}`,
  );

  // 4 — normalise sites.siteId to string (numbers only; leave absent values).
  const siteUpdates = [];
  for (const doc of sitesSnap.docs) {
    const data = doc.data();
    if (typeof data.siteId === "number") {
      siteUpdates.push({ ref: doc.ref, data: { siteId: String(data.siteId) } });
    }
  }
  await commitUpdates(siteUpdates, "sites.siteId string");
  console.log(`[sites] scanned=${sitesSnap.size} numericSiteId=${siteUpdates.length}`);

  if (!APPLY) console.log("Dry run only. Re-run with --apply to write.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
