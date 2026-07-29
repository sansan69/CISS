#!/usr/bin/env node

import { Buffer } from "node:buffer";
import process from "node:process";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import {
  FieldPath,
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const PAGE_SIZE = 200;

function credential() {
  if (process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64) {
    return cert(
      JSON.parse(
        Buffer.from(process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64, "base64").toString("utf8"),
      ),
    );
  }
  if (process.env.FIREBASE_ADMIN_SDK_CONFIG) {
    return cert(JSON.parse(process.env.FIREBASE_ADMIN_SDK_CONFIG));
  }
  if (process.env.FIREBASE_ADMIN_PROJECT_ID && process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    return cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
  }
  return applicationDefault();
}

function patchFor(data, reportType) {
  const patch = {};
  const status = String(data.status || "draft");
  if (data.schemaVersion !== 2) patch.schemaVersion = 2;
  if (!data.reportType) patch.reportType = reportType;
  if (!Number.isInteger(data.revisionNumber)) patch.revisionNumber = 1;
  if (!data.visibility) {
    patch.visibility =
      status === "draft"
        ? "private_draft"
        : status === "superseded" || status === "archived"
          ? "withdrawn"
          : "client_visible";
  }
  if (!data.reviewStatus) {
    patch.reviewStatus =
      status === "reviewed" || status === "acknowledged" ? "reviewed" : "unreviewed";
  }
  if (!data.clientStatus && status !== "draft") patch.clientStatus = "unseen";
  if (!data.locationStatus) {
    patch.locationStatus = data.visitLocation ? "legacy_unverified" : "not_captured";
  }
  if (!data.updatedAt) patch.updatedAt = data.createdAt || FieldValue.serverTimestamp();
  return patch;
}

async function migrateCollection(db, collectionName, reportType) {
  let cursor = null;
  let scanned = 0;
  let changed = 0;

  while (true) {
    let query = db
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    let writes = 0;
    for (const doc of snapshot.docs) {
      scanned += 1;
      const patch = patchFor(doc.data(), reportType);
      if (Object.keys(patch).length === 0) continue;
      changed += 1;
      if (APPLY) {
        batch.update(doc.ref, patch);
        const eventRef = db.collection("foReportEvents").doc();
        batch.create(eventRef, {
          reportId: doc.id,
          reportType,
          revisionNumber: Number(doc.data().revisionNumber ?? 1),
          action: "migration_baseline",
          actorRole: "system",
          clientId: doc.data().clientId ?? "",
          stateCode: doc.data().stateCode ?? "KL",
          eventAt: FieldValue.serverTimestamp(),
        });
        writes += 2;
      }
    }
    if (APPLY && writes > 0) await batch.commit();
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < PAGE_SIZE) break;
  }

  return { collectionName, scanned, changed };
}

const app =
  getApps()[0] ??
  initializeApp({
    credential: credential(),
    projectId:
      process.env.FIREBASE_ADMIN_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
const db = getFirestore(app);

const results = [];
results.push(await migrateCollection(db, "foVisitReports", "visit"));
results.push(await migrateCollection(db, "foTrainingReports", "training"));

console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", results }, null, 2));
