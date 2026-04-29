#!/usr/bin/env node

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import admin from "firebase-admin";

const OPERATIONAL_CLIENT_NAME = "TCS";
const BATCH_SIZE = 400;

function initializeApp() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const base64Config = process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64;
  const jsonConfig = process.env.FIREBASE_ADMIN_SDK_CONFIG;

  let credential;

  if (process.env.FIREBASE_ADMIN_PREFER_APPLICATION_DEFAULT === "true") {
    credential = admin.credential.applicationDefault();
    console.log("Using applicationDefault credentials (preferred)");
  } else if (base64Config) {
    const decoded = Buffer.from(base64Config, "base64").toString("utf-8");
    credential = admin.credential.cert(JSON.parse(decoded));
    console.log("Using FIREBASE_ADMIN_SDK_CONFIG_BASE64");
  } else if (jsonConfig) {
    credential = admin.credential.cert(JSON.parse(jsonConfig));
    console.log("Using FIREBASE_ADMIN_SDK_CONFIG");
  } else if (
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
    process.env.FIREBASE_ADMIN_PRIVATE_KEY
  ) {
    credential = admin.credential.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
    console.log("Using split FIREBASE_ADMIN_* credentials");
  } else {
    credential = admin.credential.applicationDefault();
    console.log("Using applicationDefault credentials");
  }

  return admin.initializeApp({
    credential,
    projectId:
      process.env.FIREBASE_ADMIN_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      undefined,
  });
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function toDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return value.slice(0, 10);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  if (typeof value.toDate === "function") {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime())
      ? parsed.toISOString().slice(0, 10)
      : "";
  }
  return "";
}

function isActiveRecord(data) {
  return normalizeKey(data.recordStatus || "active") === "active";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const app = initializeApp();
  const db = admin.firestore(app);

  console.log(`\n=== Work Order Site/Day Aggregate Backfill (${dryRun ? "DRY RUN" : "LIVE"}) ===`);

  const snapshot = await db
    .collection("workOrders")
    .where("clientName", "==", OPERATIONAL_CLIENT_NAME)
    .get();

  const records = snapshot.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    data: doc.data(),
  }));

  const grouped = new Map();

  for (const record of records) {
    const data = record.data;
    if (!isActiveRecord(data)) {
      continue;
    }

    const siteId = normalizeText(data.siteId || record.id);
    const siteName = normalizeText(data.siteName || siteId);
    const district = normalizeText(data.district);
    const dateKey = toDateKey(data.date);
    if (!siteId || !dateKey) {
      continue;
    }

    const groupKey = `${siteId}::${dateKey}`;
    const current =
      grouped.get(groupKey) ??
      {
        siteId,
        siteName,
        district,
        dateKey,
        examNames: new Set(),
        maleRequired: 0,
        femaleRequired: 0,
        totalRequired: 0,
        assignedIds: new Set(),
        assignedMale: 0,
        assignedFemale: 0,
        docs: [],
      };

    const examName = normalizeText(data.examName || data.examCode || "General Duty");
    if (examName) {
      current.examNames.add(examName);
    }

    const maleRequired = Number(data.maleGuardsRequired ?? 0) || 0;
    const femaleRequired = Number(data.femaleGuardsRequired ?? 0) || 0;
    const totalRequired = Number(data.totalManpower ?? maleRequired + femaleRequired) || 0;
    current.maleRequired += maleRequired;
    current.femaleRequired += femaleRequired;
    current.totalRequired += totalRequired;

    const assignedGuards = Array.isArray(data.assignedGuards) ? data.assignedGuards : [];
    for (const guard of assignedGuards) {
      const uid = normalizeText(guard?.uid || guard?.employeeId || guard?.name);
      if (!uid || current.assignedIds.has(uid)) continue;
      current.assignedIds.add(uid);
      const gender = normalizeKey(guard?.gender);
      if (gender === "male") current.assignedMale += 1;
      if (gender === "female") current.assignedFemale += 1;
    }

    current.docs.push(record);
    grouped.set(groupKey, current);
  }

  const updates = [];
  for (const group of grouped.values()) {
    const examNames = Array.from(group.examNames).sort((a, b) => a.localeCompare(b));
    const payload = {
      siteDateKey: `${group.siteId}::${group.dateKey}`,
      combinedExamNames: examNames,
      combinedExamNamesText: examNames.join(" · "),
      combinedMaleGuardsRequired: group.maleRequired,
      combinedFemaleGuardsRequired: group.femaleRequired,
      combinedTotalManpower: group.totalRequired,
      combinedAssignedCount: group.assignedIds.size,
      combinedAssignedMale: group.assignedMale,
      combinedAssignedFemale: group.assignedFemale,
      combinedUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    for (const record of group.docs) {
      updates.push({ ref: record.ref, payload, siteName: group.siteName, dateKey: group.dateKey });
    }
  }

  console.log(`Active site/date groups found: ${grouped.size}`);
  console.log(`Work order docs to update: ${updates.length}`);

  const preview = updates.slice(0, 10);
  if (preview.length > 0) {
    console.log("\nPreview:");
    preview.forEach((item) => {
      console.log(`- ${item.siteName} | ${item.dateKey}`);
    });
  }

  if (dryRun) {
    console.log("\nDry run complete. Run without --dry-run to apply.");
    return;
  }

  let committed = 0;
  for (let index = 0; index < updates.length; index += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = updates.slice(index, index + BATCH_SIZE);
    chunk.forEach((item) => batch.set(item.ref, item.payload, { merge: true }));
    await batch.commit();
    committed += chunk.length;
    console.log(`Committed ${committed}/${updates.length}`);
  }

  console.log("\nBackfill complete.");
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
