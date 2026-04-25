#!/usr/bin/env ts-node
/**
 * Backfill workOrders.examName from workOrderImports
 * SAFE: Only sets examName if missing/empty. Idempotent. Batched (499 ops max per batch).
 * Run: ts-node scripts/backfill-workorder-exam-names.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import * as admin from "firebase-admin";

const BATCH_SIZE = 499;

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

interface ImportDoc {
  id: string;
  examName?: string;
  examCode?: string;
  fileName?: string;
}

async function fetchImports(db: admin.firestore.Firestore): Promise<Map<string, ImportDoc>> {
  const imports = new Map<string, ImportDoc>();
  const snapshot = await db.collection("workOrderImports").get();
  snapshot.forEach((doc) => {
    const data = doc.data();
    imports.set(doc.id, {
      id: doc.id,
      examName: data.examName || "",
      examCode: data.examCode || "",
      fileName: data.fileName || "",
    });
  });
  return imports;
}

async function backfillExamNames(db: admin.firestore.Firestore, dryRun = true): Promise<number> {
  const imports = await fetchImports(db);
  console.log(`Found ${imports.size} work order imports.`);

  let totalUpdated = 0;
  let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
  let hasMore = true;

  while (hasMore) {
    let q: admin.firestore.Query = db.collection("workOrders").limit(500);
    if (lastDoc) {
      q = q.startAfter(lastDoc);
    }

    const snapshot = await q.get();
    if (snapshot.empty) {
      hasMore = false;
      break;
    }

    const docsToUpdate: admin.firestore.QueryDocumentSnapshot[] = [];
    const preview: { id: string; siteName: string; oldExam: string; newExam: string; source: string }[] = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const existingExam = data.examName || "";

      // Skip if already has examName
      if (existingExam && existingExam.trim().length > 0) {
        return;
      }

      let newExamName = "";
      let source = "";

      // Try importId mapping first
      const importId = data.importId;
      if (importId && imports.has(importId)) {
        const imp = imports.get(importId)!;
        newExamName = imp.examName || imp.examCode || "";
        source = `import:${imp.fileName || importId}`;
      }

      // Fallback: try sourceFileName on the work order itself
      if (!newExamName && data.sourceFileName) {
        const fileName = data.sourceFileName as string;
        // Extract exam name from filename using same logic as parser
        newExamName = cleanExamNameFromFilename(fileName);
        source = `filename:${fileName}`;
      }

      if (newExamName) {
        docsToUpdate.push(doc);
        preview.push({
          id: doc.id,
          siteName: data.siteName || "",
          oldExam: existingExam || "(empty)",
          newExam: newExamName,
          source,
        });
      }
    });

    if (preview.length > 0) {
      console.log(`\n--- Batch (dryRun=${dryRun}) ---`);
      preview.forEach((p) => {
        console.log(`  ${p.id} | ${p.siteName} | "${p.oldExam}" → "${p.newExam}" | ${p.source}`);
      });
    }

    if (!dryRun && docsToUpdate.length > 0) {
      for (let i = 0; i < docsToUpdate.length; i += BATCH_SIZE) {
        const chunk = docsToUpdate.slice(i, i + BATCH_SIZE);
        const batch = db.batch();
        chunk.forEach((doc) => {
          const data = doc.data();
          let newExamName = "";

          const importId = data.importId;
          if (importId && imports.has(importId)) {
            const imp = imports.get(importId)!;
            newExamName = imp.examName || imp.examCode || "";
          }

          if (!newExamName && data.sourceFileName) {
            newExamName = cleanExamNameFromFilename(data.sourceFileName as string);
          }

          if (newExamName) {
            batch.update(doc.ref, { examName: newExamName });
          }
        });
        await batch.commit();
        totalUpdated += chunk.length;
      }
    } else if (dryRun) {
      totalUpdated += docsToUpdate.length;
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.docs.length < 500) {
      hasMore = false;
    }
  }

  return totalUpdated;
}

function cleanExamNameFromFilename(fileName: string): string {
  // Strip extension
  let name = fileName.replace(/\.[^/.]+$/, "");

  // Remove common prefixes
  name = name.replace(/^(exam[_\s-]?duty[_\s-]?)/i, "");
  name = name.replace(/^(tcs[_\s-]?exam[_\s-]?duty[_\s-]?)/i, "");
  name = name.replace(/^(tcs[_\s-]?)/i, "");
  name = name.replace(/^(duty[_\s-]?)/i, "");

  // Remove trailing dates in parentheses or brackets
  name = name.replace(/\s*[\(\[].*?[\)\]]\s*$/, "");

  // Replace underscores/hyphens with spaces
  name = name.replace(/[_-]+/g, " ");

  // Trim and title-case
  name = name.trim();
  if (!name) return "";

  // Title case each word
  return name
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run") || process.argv.includes("-d");

  console.log("=== Work Order Exam Name Backfill ===");
  console.log(`Mode: ${dryRun ? "DRY RUN (preview only)" : "LIVE UPDATE"}\n`);

  let app: admin.app.App;
  try {
    app = initializeApp();
  } catch (err) {
    console.error("Failed to initialize Firebase Admin:", err);
    process.exit(1);
  }

  const db = admin.firestore(app);

  try {
    const count = await backfillExamNames(db, dryRun);
    console.log(`\n=== ${dryRun ? "Preview" : "Update"} Complete ===`);
    console.log(`Total work orders to update: ${count}`);
    if (dryRun) {
      console.log("\nRun without --dry-run to apply changes.");
    }
  } catch (err) {
    console.error("Error during backfill:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
