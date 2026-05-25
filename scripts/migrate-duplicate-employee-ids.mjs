#!/usr/bin/env node

import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg.startsWith("--")) {
    const [key, inlineValue] = arg.split("=", 2);
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
    } else if (process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
      args.set(key, process.argv[index + 1]);
      index += 1;
    } else {
      args.set(key, true);
    }
  }
}

const planPath = args.get("--plan");
const shouldApply = args.get("--apply") === true;
const projectId = args.get("--project") || "ciss-workforce";

if (!planPath || typeof planPath !== "string") {
  console.error("Usage: node scripts/migrate-duplicate-employee-ids.mjs --plan <dry-run-plan.json> [--apply] [--project ciss-workforce]");
  process.exit(1);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeEmployeeId(value) {
  return normalizeText(value).toUpperCase();
}

function registryDocId(employeeId) {
  return Buffer.from(normalizeEmployeeId(employeeId), "utf8").toString("base64url");
}

function isActiveEmployee(data) {
  const status = normalizeText(data.status || data.employmentStatus).toLowerCase();
  return !["inactive", "terminated", "resigned", "deleted", "disabled", "left", "exited"].includes(status);
}

function timestampToIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  if (typeof value._seconds === "number") return new Date(value._seconds * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function serializeEmployeeSnapshot(doc) {
  const data = doc.data() ?? {};
  return {
    docPath: doc.ref.path,
    exists: doc.exists,
    employeeId: data.employeeId ?? null,
    previousEmployeeIds: Array.isArray(data.previousEmployeeIds) ? data.previousEmployeeIds : [],
    fullName: data.fullName ?? data.name ?? data.employeeName ?? null,
    clientName: data.clientName ?? null,
    district: data.district ?? null,
    status: data.status ?? data.employmentStatus ?? null,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

function chunk(array, size) {
  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId,
});

const db = admin.firestore();
const { FieldValue } = admin.firestore;
const absolutePlanPath = path.resolve(planPath);
const plan = JSON.parse(fs.readFileSync(absolutePlanPath, "utf8"));
const migrationBatchId = `employee-id-dedupe-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outDir = path.dirname(absolutePlanPath);
const backupPath = path.join(outDir, `${migrationBatchId}-backup.json`);

const proposedChanges = [];
for (const group of plan.duplicateGroups ?? []) {
  for (const change of group.proposedChanges ?? []) {
    proposedChanges.push({
      employeeId: group.employeeId,
      normalizedEmployeeId: group.normalizedEmployeeId,
      ...change,
    });
  }
}

if (proposedChanges.length === 0) {
  console.log(JSON.stringify({ writesPerformed: false, message: "No proposed changes found in plan." }, null, 2));
  process.exit(0);
}

const proposedIds = new Set();
for (const change of proposedChanges) {
  const normalized = normalizeEmployeeId(change.proposedEmployeeId);
  if (proposedIds.has(normalized)) {
    throw new Error(`Plan contains duplicate proposed employeeId: ${change.proposedEmployeeId}`);
  }
  proposedIds.add(normalized);
}

const employeeRefs = proposedChanges.map((change) => db.doc(change.docPath));
const beforeSnapshots = await db.getAll(...employeeRefs);
const backup = {
  generatedAt: new Date().toISOString(),
  projectId,
  migrationBatchId,
  planPath: absolutePlanPath,
  writesPerformed: false,
  employees: beforeSnapshots.map(serializeEmployeeSnapshot),
};
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

const validationErrors = [];
beforeSnapshots.forEach((snapshot, index) => {
  const change = proposedChanges[index];
  if (!snapshot.exists) {
    validationErrors.push(`${change.docPath} no longer exists.`);
    return;
  }
  const data = snapshot.data() ?? {};
  if (normalizeEmployeeId(data.employeeId) !== normalizeEmployeeId(change.currentEmployeeId)) {
    validationErrors.push(
      `${change.docPath} employeeId changed from ${change.currentEmployeeId} to ${data.employeeId ?? "<blank>"}.`,
    );
  }
  if (!isActiveEmployee(data)) {
    validationErrors.push(`${change.docPath} is no longer active; skipping migration requires a refreshed plan.`);
  }
});

if (validationErrors.length > 0) {
  console.error(JSON.stringify({ writesPerformed: false, backupPath, validationErrors }, null, 2));
  process.exit(1);
}

if (!shouldApply) {
  console.log(JSON.stringify({
    dryRun: true,
    writesPerformed: false,
    projectId,
    migrationBatchId,
    planPath: absolutePlanPath,
    backupPath,
    employeeDocsToUpdate: proposedChanges.length,
  }, null, 2));
  process.exit(0);
}

for (const group of chunk(proposedChanges, 400)) {
  const batch = db.batch();
  for (const change of group) {
    batch.set(
      db.doc(change.docPath),
      {
        employeeId: change.proposedEmployeeId,
        previousEmployeeIds: FieldValue.arrayUnion(change.currentEmployeeId),
        employeeIdMigratedAt: FieldValue.serverTimestamp(),
        employeeIdMigrationReason: "duplicate_employee_id_resolution",
        employeeIdMigrationBatchId: migrationBatchId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await batch.commit();
}

const employeeSnapshot = await db.collection("employees").get();
const activeEmployeeRows = [];
const duplicateCheck = new Map();
for (const doc of employeeSnapshot.docs) {
  const data = doc.data();
  const employeeId = normalizeText(data.employeeId);
  if (!employeeId || !isActiveEmployee(data)) continue;
  const normalized = normalizeEmployeeId(employeeId);
  if (!duplicateCheck.has(normalized)) duplicateCheck.set(normalized, []);
  duplicateCheck.get(normalized).push(doc.id);
  activeEmployeeRows.push({ doc, data, employeeId, normalized });
}

const remainingDuplicates = Array.from(duplicateCheck.entries())
  .filter(([, docs]) => docs.length > 1)
  .map(([employeeId, docs]) => ({ employeeId, docs }));

if (remainingDuplicates.length > 0) {
  console.error(JSON.stringify({
    writesPerformed: true,
    backupPath,
    migrationBatchId,
    employeeDocsUpdated: proposedChanges.length,
    registryWritten: false,
    remainingDuplicates,
  }, null, 2));
  process.exit(2);
}

for (const group of chunk(activeEmployeeRows, 400)) {
  const batch = db.batch();
  for (const row of group) {
    batch.set(
      db.collection("employeeIds").doc(registryDocId(row.employeeId)),
      {
        employeeDocId: row.doc.id,
        employeeId: row.employeeId,
        normalizedEmployeeId: row.normalized,
        clientName: normalizeText(row.data.clientName),
        status: normalizeText(row.data.status || row.data.employmentStatus),
        active: true,
        source: "duplicate_employee_id_resolution",
        migrationBatchId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await batch.commit();
}

backup.writesPerformed = true;
backup.completedAt = new Date().toISOString();
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

console.log(JSON.stringify({
  writesPerformed: true,
  projectId,
  migrationBatchId,
  backupPath,
  employeeDocsUpdated: proposedChanges.length,
  activeEmployeeRegistryDocsWritten: activeEmployeeRows.length,
  remainingDuplicateActiveEmployeeIdGroups: 0,
}, null, 2));
