#!/usr/bin/env node
import crypto from "node:crypto";
import admin from "firebase-admin";
import { fileTypeFromBuffer } from "file-type";

const apply = process.argv.includes("--apply");
const readTimeArg = process.argv.find((arg) => arg.startsWith("--read-time="));
const readTime = readTimeArg?.slice("--read-time=".length);
if (!readTime || Number.isNaN(Date.parse(readTime))) throw new Error("A valid --read-time ISO timestamp is required.");

function credential() {
  if (process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64) {
    return admin.credential.cert(JSON.parse(Buffer.from(process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64, "base64").toString("utf8")));
  }
  if (process.env.FIREBASE_ADMIN_SDK_CONFIG) return admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_SDK_CONFIG));
  return admin.credential.applicationDefault();
}

const app = admin.initializeApp({
  credential: credential(),
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_ADMIN_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
});
const db = app.firestore();
const bucket = app.storage().bucket();

function legacyUrl(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof value.url === "string") return value.url.trim();
  return "";
}

function sourcePath(value) {
  const isAllowedLegacyPath = (path) =>
    /^(employees|enrollments)\/[A-Za-z0-9_-]+\/(aadharCards|idProofs|addressProofs)\/[A-Za-z0-9._-]+$/.test(path);
  if (isAllowedLegacyPath(value)) return value;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com") throw new Error("Unsupported legacy Aadhaar URL.");
  const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
  if (!match || decodeURIComponent(match[1]) !== bucket.name) throw new Error("Legacy Aadhaar URL belongs to another bucket.");
  const path = decodeURIComponent(match[2]);
  if (!isAllowedLegacyPath(path)) throw new Error("Legacy Aadhaar path is not allowed.");
  return path;
}

function aadhaarDocumentUrls(data) {
  const identity = /aadhaar|aadhar/i.test(String(data.identityProofType || data.idProofType || ""));
  const address = /aadhaar|aadhar/i.test(String(data.addressProofType || ""));
  return Array.from(new Set([
    legacyUrl(data.aadharCardDocumentUrl || data.aadhaarCardDocumentUrl),
    identity ? legacyUrl(data.identityProofUrlFront || data.idProofDocumentUrlFront || data.idProofDocumentUrl) : "",
    identity ? legacyUrl(data.identityProofUrlBack || data.idProofDocumentUrlBack) : "",
    address ? legacyUrl(data.addressProofUrlFront || data.addressProofDocumentUrlFront || data.addressProofDocumentUrl) : "",
    address ? legacyUrl(data.addressProofUrlBack || data.addressProofDocumentUrlBack) : "",
  ].filter(Boolean)));
}

const historicalSnapshot = await db.runTransaction(
  (transaction) => transaction.get(db.collection("employees")),
  { readOnly: true, readTime: admin.firestore.Timestamp.fromDate(new Date(readTime)) },
);
const totals = { candidates: 0, repairedComplete: 0, repairedIncomplete: 0, noFile: 0, skippedSecured: 0, failed: 0 };
let processed = 0;

async function repairEmployee(doc) {
  const documentUrls = aadhaarDocumentUrls(doc.data());
  if (documentUrls.length === 0) return;
  const privateRef = db.collection("employeeAadhaarPrivate").doc(doc.id);
  const privateSnap = await privateRef.get();
  const existing = privateSnap.data() || {};
  if (typeof existing.documentStoragePath === "string" && existing.documentStoragePath) {
    totals.skippedSecured += 1;
    return;
  }
  totals.candidates += 1;
  if (!apply) return;

  const oldPaths = [];
  const newDocuments = [];
  for (const documentUrl of documentUrls) {
    let oldPath;
    try {
      oldPath = sourcePath(documentUrl);
    } catch {
      continue;
    }
    oldPaths.push(oldPath);
    const oldFile = bucket.file(oldPath);
    const [exists] = await oldFile.exists();
    if (!exists) continue;
    const [buffer] = await oldFile.download();
    const detected = await fileTypeFromBuffer(buffer);
    const extension = detected?.mime === "application/pdf" ? "pdf" : detected?.mime === "image/png" ? "png" : detected?.mime === "image/jpeg" ? "jpg" : null;
    if (!extension) continue;
    const candidatePath = `restrictedEmployeeAadhaar/${doc.id}/${crypto.randomUUID()}.${extension}`;
    await bucket.file(candidatePath).save(buffer, {
      resumable: false,
      metadata: { contentType: detected.mime, cacheControl: "no-store, private, max-age=0", metadata: {} },
    });
    const [savedBuffer] = await bucket.file(candidatePath).download();
    if (!crypto.timingSafeEqual(crypto.createHash("sha256").update(buffer).digest(), crypto.createHash("sha256").update(savedBuffer).digest())) {
      await bucket.file(candidatePath).delete({ ignoreNotFound: true });
      throw new Error("Restricted Aadhaar copy verification failed.");
    }
    newDocuments.push({
      documentStoragePath: candidatePath,
      originalFileName: oldPath.split("/").pop() || "aadhaar",
      contentType: detected.mime,
    });
  }
  if (newDocuments.length === 0) {
    totals.noFile += 1;
    return;
  }

  const hasNumber = typeof existing.aadhaarNumberEncrypted === "string" && existing.aadhaarNumberEncrypted.length > 0;
  const status = hasNumber ? "complete" : "incomplete";
  const now = admin.firestore.Timestamp.now();
  const privateUpdate = {
    employeeDocId: doc.id,
    purpose: "esic_epf_registration",
    employeeProvided: true,
    verificationStatus: "not_independently_verified",
    uploadedByType: "admin",
    uploadedByUid: "migration_repair",
    uploadedAt: existing.uploadedAt || doc.data().createdAt || now,
    updatedAt: now,
    retentionPolicy: "employment_plus_90_days",
    status,
    ...newDocuments[0],
  };
  if (newDocuments.length > 1) privateUpdate.additionalDocuments = newDocuments.slice(1);
  const batch = db.batch();
  batch.set(privateRef, privateUpdate, { merge: true });
  batch.set(doc.ref, { documentCompletion: { aadhaar: hasNumber ? "complete" : "missing", updatedAt: now } }, { merge: true });
  batch.set(db.collection("sensitiveDocumentAuditLogs").doc(), {
    action: "aadhaar_legacy_document_repaired",
    employeeDocId: doc.id,
    category: "aadhaar",
    purpose: "esic_epf_registration",
    actorUid: "migration_repair",
    actorType: "admin",
    outcome: status,
    at: now,
  });
  try {
    await batch.commit();
  } catch (error) {
    await Promise.all(newDocuments.map(({ documentStoragePath }) => bucket.file(documentStoragePath).delete({ ignoreNotFound: true })));
    throw error;
  }
  await Promise.all(oldPaths.map((oldPath) => bucket.file(oldPath).delete({ ignoreNotFound: true })));
  if (hasNumber) totals.repairedComplete += 1;
  else totals.repairedIncomplete += 1;
}

let nextIndex = 0;
async function worker() {
  while (nextIndex < historicalSnapshot.docs.length) {
    const index = nextIndex++;
    try {
      await repairEmployee(historicalSnapshot.docs[index]);
    } catch (error) {
      totals.failed += 1;
      console.error(`Repair failed for ${historicalSnapshot.docs[index].id}: ${error.message}`);
    } finally {
      processed += 1;
      if (apply && processed % 50 === 0) console.log(JSON.stringify({ progress: processed, total: historicalSnapshot.size, ...totals }));
    }
  }
}
await Promise.all(Array.from({ length: apply ? 12 : 1 }, () => worker()));
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", readTime, ...totals }, null, 2));
await app.delete();
