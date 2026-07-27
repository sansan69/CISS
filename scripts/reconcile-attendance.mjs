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
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 400;
const PAGE_SIZE = 500;

function buildCredential() {
  if (process.env.FIREBASE_ADMIN_PREFER_APPLICATION_DEFAULT === "true") {
    return applicationDefault();
  }
  if (process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64) {
    return cert(
      JSON.parse(
        Buffer.from(
          process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64,
          "base64",
        ).toString("utf8"),
      ),
    );
  }
  if (process.env.FIREBASE_ADMIN_SDK_CONFIG) {
    return cert(JSON.parse(process.env.FIREBASE_ADMIN_SDK_CONFIG));
  }
  return applicationDefault();
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function attendanceDateInIndia(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function patchForLog(data, employeeDocsByCode) {
  const patch = {};
  if (!data.employeeDocId && typeof data.employeeId === "string") {
    const employeeDocId = employeeDocsByCode.get(data.employeeId.trim());
    if (employeeDocId) patch.employeeDocId = employeeDocId;
  }

  const reportedAt =
    toDate(data.reportedAt) ??
    toDate(data.reportedAtClient) ??
    toDate(data.createdAt);
  if (!data.reportedAt && reportedAt) {
    patch.reportedAt = Timestamp.fromDate(reportedAt);
  }
  if (!data.attendanceDate && reportedAt) {
    patch.attendanceDate = attendanceDateInIndia(reportedAt);
  }
  if (
    !data.siteClientName &&
    typeof data.clientName === "string" &&
    data.clientName.trim()
  ) {
    patch.siteClientName = data.clientName.trim();
  }
  if (data.autoClosed === true && !data.reviewStatus) {
    patch.requiresAdminReview = true;
    patch.reviewStatus = "pending";
  }
  if (!data.stateCode) patch.stateCode = "KL";
  return patch;
}

async function loadEmployeeMap(db) {
  const map = new Map();
  const duplicates = new Set();
  const snapshot = await db.collection("employees").get();
  for (const document of snapshot.docs) {
    const employeeId = document.data().employeeId;
    if (typeof employeeId !== "string" || !employeeId.trim()) continue;
    const normalized = employeeId.trim();
    if (map.has(normalized)) {
      duplicates.add(normalized);
      map.delete(normalized);
    } else if (!duplicates.has(normalized)) {
      map.set(normalized, document.id);
    }
  }
  return { map, duplicates };
}

async function main() {
  const app =
    getApps()[0] ??
    initializeApp({
      credential: buildCredential(),
      projectId:
        process.env.FIREBASE_ADMIN_PROJECT_ID ||
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  const db = getFirestore(app);
  const { map, duplicates } = await loadEmployeeMap(db);
  let cursor = null;
  let scanned = 0;
  let candidates = 0;
  let updated = 0;
  const fieldCandidates = {};
  let batch = db.batch();
  let batchSize = 0;

  while (true) {
    let query = db
      .collection("attendanceLogs")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const document of snapshot.docs) {
      scanned += 1;
      const patch = patchForLog(document.data(), map);
      if (Object.keys(patch).length === 0) continue;
      candidates += 1;
      for (const field of Object.keys(patch)) {
        fieldCandidates[field] = (fieldCandidates[field] ?? 0) + 1;
      }
      if (!APPLY) continue;
      batch.set(
        document.ref,
        { ...patch, reconciledAt: Timestamp.now() },
        { merge: true },
      );
      batchSize += 1;
      if (batchSize >= BATCH_SIZE) {
        await batch.commit();
        updated += batchSize;
        batch = db.batch();
        batchSize = 0;
      }
    }
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) break;
  }

  if (APPLY && batchSize > 0) {
    await batch.commit();
    updated += batchSize;
  }

  const [openSessionsSnapshot, openStatesSnapshot, liveInSnapshot] =
    await Promise.all([
    db.collection("attendanceSessions").where("status", "==", "open").get(),
    db.collection("attendanceState").where("lastStatus", "==", "In").get(),
    db.collection("guardLocations").where("status", "==", "In").get(),
  ]);
  const activeSessionIds = new Set(
    openStatesSnapshot.docs
      .map((document) => document.data().openSessionId)
      .filter((value) => typeof value === "string" && value),
  );
  const activeEmployeeIds = new Set(
    openStatesSnapshot.docs.map((document) => document.id),
  );
  const orphanSessions = openSessionsSnapshot.docs.filter(
    (document) => !activeSessionIds.has(document.id),
  );
  const staleLiveProjections = liveInSnapshot.docs.filter(
    (document) => !activeEmployeeIds.has(document.id),
  );
  let orphanSessionsUpdated = 0;
  let liveProjectionUpdates = 0;

  if (
    APPLY &&
    (orphanSessions.length > 0 || staleLiveProjections.length > 0)
  ) {
    batch = db.batch();
    batchSize = 0;
    const scheduledLiveUpdates = new Set();
    for (const document of orphanSessions) {
      const data = document.data();
      const now = Timestamp.now();
      batch.set(
        document.ref,
        {
          status: "closed",
          endedAt:
            data.shiftEndsAt ??
            data.autoCheckoutAt ??
            data.startedAt ??
            now,
          autoClosed: true,
          closeReason: "orphan_session_reconciliation",
          requiresAdminReview: true,
          reviewStatus: "pending",
          autoClosedReason:
            "Open session was not referenced by the employee attendance state.",
          reconciledAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
      batchSize += 1;
      orphanSessionsUpdated += 1;

      const employeeDocId =
        typeof data.employeeDocId === "string" ? data.employeeDocId : "";
      if (employeeDocId && !activeEmployeeIds.has(employeeDocId)) {
        batch.set(
          db.collection("guardLocations").doc(employeeDocId),
          {
            status: "Out",
            isOutOfZone: false,
            updatedAt: now,
          },
          { merge: true },
        );
        batchSize += 1;
        liveProjectionUpdates += 1;
        scheduledLiveUpdates.add(employeeDocId);
      }

      if (batchSize >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        batchSize = 0;
      }
    }
    for (const document of staleLiveProjections) {
      if (scheduledLiveUpdates.has(document.id)) continue;
      batch.set(
        document.ref,
        {
          status: "Out",
          isOutOfZone: false,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
      batchSize += 1;
      liveProjectionUpdates += 1;
      if (batchSize >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        batchSize = 0;
      }
    }
    if (batchSize > 0) await batch.commit();
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        scanned,
        candidates,
        updated,
        fieldCandidates,
        openSessionsScanned: openSessionsSnapshot.size,
        orphanSessionCandidates: orphanSessions.length,
        staleLiveProjectionCandidates: staleLiveProjections.length,
        orphanSessionsUpdated,
        liveProjectionUpdates,
        duplicateEmployeeCodesSkipped: duplicates.size,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Attendance reconciliation failed.",
  );
  process.exitCode = 1;
});
