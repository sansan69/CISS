#!/usr/bin/env ts-node
/**
 * CISS Kerala Backfill Migration
 * Sets stateCode: 'KL' on all Firestore documents that don't already have it.
 * SAFE: Only adds field if missing. Idempotent. Batched (499 ops max per batch).
 * Run: ts-node scripts/migrate-add-state-code.ts
 */

import * as admin from "firebase-admin";

// Collections to migrate
const COLLECTIONS = [
  "employees",
  "attendanceLogs",
  "clients",
  "sites",
  "clientLocations",
  "workOrders",
  "fieldOfficers",
  "clientUsers",
  "attendanceState",
  "trainingModules",
  "trainingAssignments",
  "evaluations",
  "guardScores",
  "awards",
  "clientWageConfig",
  "salaryStructures",
  "employeeSalaries",
  "payrollCycles",
  "payrollEntries",
  "leaveRequests",
  "leaveBalances",
  "foVisitReports",
  "foTrainingReports",
  "branchExpenses",
  "branches",
];

const BATCH_SIZE = 499;
const STATE_CODE = "KL";

function initializeApp(): admin.app.App {
  const base64Config = process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64;
  const jsonConfig = process.env.FIREBASE_ADMIN_SDK_CONFIG;

  let serviceAccount: admin.ServiceAccount;

  if (base64Config) {
    const decoded = Buffer.from(base64Config, "base64").toString("utf-8");
    serviceAccount = JSON.parse(decoded) as admin.ServiceAccount;
    console.log("Using FIREBASE_ADMIN_SDK_CONFIG_BASE64");
  } else if (jsonConfig) {
    serviceAccount = JSON.parse(jsonConfig) as admin.ServiceAccount;
    console.log("Using FIREBASE_ADMIN_SDK_CONFIG");
  } else {
    throw new Error(
      "Either FIREBASE_ADMIN_SDK_CONFIG_BASE64 or FIREBASE_ADMIN_SDK_CONFIG env var must be set."
    );
  }

  if (!admin.apps.length) {
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  return admin.app();
}

async function migrateCollection(
  db: admin.firestore.Firestore,
  collectionName: string
): Promise<number> {
  let totalUpdated = 0;
  let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
  let hasMore = true;

  while (hasMore) {
    let q: admin.firestore.Query = db
      .collection(collectionName)
      .limit(500);

    if (lastDoc) {
      q = q.startAfter(lastDoc);
    }

    const snapshot = await q.get();

    if (snapshot.empty) {
      hasMore = false;
      break;
    }

    // Filter docs missing stateCode
    const docsToUpdate = snapshot.docs.filter((doc) => {
      const data = doc.data();
      return data.stateCode === undefined || data.stateCode === null;
    });

    if (docsToUpdate.length > 0) {
      // Batch in chunks of BATCH_SIZE
      for (let i = 0; i < docsToUpdate.length; i += BATCH_SIZE) {
        const chunk = docsToUpdate.slice(i, i + BATCH_SIZE);
        const batch = db.batch();
        chunk.forEach((doc) => {
          batch.update(doc.ref, { stateCode: STATE_CODE });
        });
        await batch.commit();
        totalUpdated += chunk.length;
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.docs.length < 500) {
      hasMore = false;
    }
  }

  return totalUpdated;
}

async function main() {
  console.log("=== CISS Kerala Backfill Migration ===");
  console.log(`Setting stateCode: '${STATE_CODE}' on documents missing this field.\n`);

  let app: admin.app.App;
  try {
    app = initializeApp();
  } catch (err) {
    console.error("Failed to initialize Firebase Admin:", err);
    process.exit(1);
  }

  const db = admin.firestore(app);

  let grandTotal = 0;

  for (const collectionName of COLLECTIONS) {
    try {
      process.stdout.write(`  Migrating: ${collectionName} ... `);
      const count = await migrateCollection(db, collectionName);
      console.log(`updated ${count} docs`);
      grandTotal += count;
    } catch (err) {
      console.error(`  ERROR in ${collectionName}:`, err);
    }
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`Total documents updated: ${grandTotal}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
