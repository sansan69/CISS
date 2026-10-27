#!/usr/bin/env node
/**
 * Phase-1 migration: copy guard PIN hashes from the readable `employees`
 * document into the server-only `guardCredentials` collection.
 *
 * This does not change authentication behaviour. It fills the new store so that
 * a later change can switch readers and then remove `guardPin` from `employees`.
 *
 * Default is a dry run. Pass --apply to write.
 *
 * Usage:
 *   node --env-file=.env.local scripts/migrate-guard-credentials.mjs
 *   node --env-file=.env.local scripts/migrate-guard-credentials.mjs --apply
 */
import admin from "firebase-admin";

const APPLY = process.argv.includes("--apply");
const BATCH = 400;

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = admin.firestore();

async function main() {
  console.log(`mode=${APPLY ? "APPLY" : "dry-run"}`);
  const employees = await db.collection("employees").get();
  const already = new Set(
    (await db.collection("guardCredentials").get()).docs.map((doc) => doc.id),
  );

  const pending = employees.docs.filter((doc) => {
    const guardPin = doc.data().guardPin;
    return typeof guardPin === "string" && guardPin.length > 0;
  });

  console.log(
    `[guardCredentials] employees=${employees.size} withPinHash=${pending.length} alreadyMirrored=${already.size}`,
  );

  let written = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    if (!APPLY) {
      written += pending.slice(i, i + BATCH).length;
      continue;
    }
    const batch = db.batch();
    for (const doc of pending.slice(i, i + BATCH)) {
      const data = doc.data();
      batch.set(
        db.collection("guardCredentials").doc(doc.id),
        {
          guardPin: data.guardPin,
          guardPinSetAt: data.guardPinSetAt ?? null,
          migratedAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true },
      );
    }
    await batch.commit();
    written += Math.min(BATCH, pending.length - i);
  }

  console.log(
    `[guardCredentials] ${APPLY ? "written" : "would write"}=${written} note=reads still use employees.guardPin until phase 2`,
  );
  if (!APPLY) console.log("Dry run only. Re-run with --apply to write.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
