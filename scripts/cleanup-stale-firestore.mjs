#!/usr/bin/env node
/**
 * Safe cleanup of stale Firestore bookkeeping documents.
 *
 * Default is a dry run. Pass --apply to delete.
 *
 * What it removes:
 *   - rateLimits documents whose window started more than 30 days ago, or that
 *     are malformed (no windowStart). They cannot constrain any live request.
 *   - resetOtps documents whose expiresAt (string timestamp) is in the past.
 *
 * It never touches employees, attendance, payroll history, Storage objects or
 * any collection outside this list.
 *
 * Usage:
 *   node --env-file=.env.local scripts/cleanup-stale-firestore.mjs
 *   node --env-file=.env.local scripts/cleanup-stale-firestore.mjs --apply
 */
import admin from "firebase-admin";

const APPLY = process.argv.includes("--apply");
const RATE_LIMIT_CUTOFF_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH = 400;

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = admin.firestore();

async function deleteRefs(refs) {
  if (!APPLY) return refs.length;
  let deleted = 0;
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH)) batch.delete(ref);
    await batch.commit();
    deleted += Math.min(BATCH, refs.length - i);
  }
  return deleted;
}

async function cleanupRateLimits() {
  const snapshot = await db.collection("rateLimits").get();
  const cutoff = Date.now() - RATE_LIMIT_CUTOFF_MS;
  const stale = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const start =
      data.windowStart && typeof data.windowStart.toMillis === "function"
        ? data.windowStart.toMillis()
        : null;
    if (start === null || start < cutoff) stale.push(doc.ref);
  }
  const deleted = await deleteRefs(stale);
  console.log(
    `[rateLimits] scanned=${snapshot.size} stale=${stale.length} ${APPLY ? "deleted" : "would delete"}=${deleted}`,
  );
}

async function cleanupResetOtps() {
  const snapshot = await db.collection("resetOtps").get();
  const now = Date.now();
  const expired = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const raw = data.expiresAt;
    const millis =
      raw && typeof raw.toMillis === "function"
        ? raw.toMillis()
        : typeof raw === "string"
          ? new Date(raw).getTime()
          : null;
    if (millis !== null && millis < now) expired.push(doc.ref);
  }
  const deleted = await deleteRefs(expired);
  console.log(
    `[resetOtps] scanned=${snapshot.size} expired=${expired.length} ${APPLY ? "deleted" : "would delete"}=${deleted}`,
  );
}

async function main() {
  console.log(`mode=${APPLY ? "APPLY" : "dry-run"}`);
  await cleanupRateLimits();
  await cleanupResetOtps();
  if (!APPLY) console.log("Dry run only. Re-run with --apply to delete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
