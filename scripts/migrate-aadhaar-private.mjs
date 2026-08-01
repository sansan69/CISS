#!/usr/bin/env node
import crypto from "node:crypto";
import admin from "firebase-admin";
import { fileTypeFromBuffer } from "file-type";

const apply = process.argv.includes("--apply");
const kmsKeyName = process.env.AADHAAR_KMS_KEY_NAME?.trim();
if (apply && !kmsKeyName) throw new Error("AADHAAR_KMS_KEY_NAME is required with --apply.");

function credential() {
  if (process.env.FIREBASE_ADMIN_REFRESH_TOKEN_CONFIG_BASE64) {
    return admin.credential.refreshToken(JSON.parse(Buffer.from(process.env.FIREBASE_ADMIN_REFRESH_TOKEN_CONFIG_BASE64, "base64").toString("utf8")));
  }
  if (process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64) {
    return admin.credential.cert(JSON.parse(Buffer.from(process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64, "base64").toString("utf8")));
  }
  if (process.env.FIREBASE_ADMIN_SDK_CONFIG) {
    return admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_SDK_CONFIG));
  }
  return admin.credential.applicationDefault();
}

const app = admin.initializeApp({
  credential: credential(),
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_ADMIN_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
});
const db = app.firestore();
const bucket = app.storage().bucket();

async function kmsEncrypt(plaintext) {
  const token = await app.options.credential.getAccessToken();
  const response = await fetch(`https://cloudkms.googleapis.com/v1/${kmsKeyName}:encrypt`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    },
    body: JSON.stringify({ plaintext: plaintext.toString("base64") }),
  });
  const body = await response.json();
  if (!response.ok || !body.ciphertext) throw new Error(body.error?.message || "KMS encryption failed.");
  return { ciphertext: body.ciphertext, keyVersion: body.name || kmsKeyName };
}

async function kmsDecrypt(ciphertext) {
  const token = await app.options.credential.getAccessToken();
  const response = await fetch(`https://cloudkms.googleapis.com/v1/${kmsKeyName}:decrypt`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    },
    body: JSON.stringify({ ciphertext }),
  });
  const body = await response.json();
  if (!response.ok || !body.plaintext) throw new Error(body.error?.message || "KMS decryption verification failed.");
  return Buffer.from(body.plaintext, "base64");
}

async function encryptNumber(number) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(number, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  try {
    const wrapped = await kmsEncrypt(key);
    const envelope = {
      aadhaarNumberEncrypted: encrypted.toString("base64"),
      encryptionIv: iv.toString("base64"),
      encryptionTag: tag.toString("base64"),
      encryptedDataKey: wrapped.ciphertext,
      encryptionKeyVersion: wrapped.keyVersion,
      aadhaarLast4: number.slice(-4),
    };
    const verificationKey = await kmsDecrypt(envelope.encryptedDataKey);
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", verificationKey, iv);
      decipher.setAuthTag(tag);
      const verified = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
      if (verified !== number) throw new Error("Aadhaar encryption verification failed.");
    } finally {
      verificationKey.fill(0);
    }
    return envelope;
  } finally {
    key.fill(0);
  }
}

function legacyUrl(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof value.url === "string") return value.url.trim();
  return "";
}

function sourcePath(value) {
  const isAllowedLegacyPath = (path) =>
    /^(employees|enrollments)\/[A-Za-z0-9_-]+\/aadharCards\/[A-Za-z0-9._-]+$/.test(path) ||
    /^employees\/[A-Za-z0-9_-]+\/(idProofs|addressProofs)\/[A-Za-z0-9._-]+$/.test(path);
  if (isAllowedLegacyPath(value)) return value;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com") throw new Error("Unsupported legacy Aadhaar URL.");
  const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
  if (!match || decodeURIComponent(match[1]) !== bucket.name) throw new Error("Legacy Aadhaar URL belongs to another bucket.");
  const path = decodeURIComponent(match[2]);
  if (!isAllowedLegacyPath(path)) throw new Error("Legacy Aadhaar path is not allowed.");
  return path;
}

async function migrateEmployee(doc) {
  const data = doc.data();
  const aadhaarWasIdentityProof = /aadhaar|aadhar/i.test(String(data.identityProofType || data.idProofType || ""));
  const aadhaarWasAddressProof = /aadhaar|aadhar/i.test(String(data.addressProofType || ""));
  const numberCandidates = [
    data.aadharNumber,
    data.aadhaarNumber,
    aadhaarWasIdentityProof ? data.identityProofNumber || data.idProofNumber : null,
    aadhaarWasAddressProof ? data.addressProofNumber : null,
  ];
  const number = numberCandidates
    .map((value) => typeof value === "string" ? value.replace(/\s+/g, "") : "")
    .find((value) => /^\d{12}$/.test(value)) || null;
  const documentUrls = Array.from(new Set([
    legacyUrl(data.aadharCardDocumentUrl || data.aadhaarCardDocumentUrl),
    aadhaarWasIdentityProof ? legacyUrl(data.identityProofUrlFront || data.idProofDocumentUrlFront || data.idProofDocumentUrl) : "",
    aadhaarWasIdentityProof ? legacyUrl(data.identityProofUrlBack || data.idProofDocumentUrlBack) : "",
    aadhaarWasAddressProof ? legacyUrl(data.addressProofUrlFront || data.addressProofDocumentUrlFront || data.addressProofDocumentUrl) : "",
    aadhaarWasAddressProof ? legacyUrl(data.addressProofUrlBack || data.addressProofDocumentUrlBack) : "",
  ].filter(Boolean)));
  if (!number && documentUrls.length === 0) return { state: "skip" };
  if (!apply) return { state: "candidate", hasNumber: !!number, hasDocument: documentUrls.length > 0 };

  const privateData = {
    employeeDocId: doc.id,
    purpose: "esic_epf_registration",
    employeeProvided: true,
    verificationStatus: "not_independently_verified",
    uploadedByType: "admin",
    uploadedByUid: "migration",
    uploadedAt: data.createdAt || admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    retentionPolicy: "employment_plus_90_days",
  };
  if (number) Object.assign(privateData, await encryptNumber(number));

  const oldPaths = [];
  const newDocuments = [];
  for (const documentUrl of documentUrls) {
    try {
      const oldPath = sourcePath(documentUrl);
      oldPaths.push(oldPath);
      const oldFile = bucket.file(oldPath);
      const [exists] = await oldFile.exists();
      if (exists) {
        const [buffer] = await oldFile.download();
        const detected = await fileTypeFromBuffer(buffer);
        const extension = detected?.mime === "application/pdf" ? "pdf" : detected?.mime === "image/png" ? "png" : detected?.mime === "image/jpeg" ? "jpg" : null;
        if (!extension) throw new Error("Unsupported legacy Aadhaar file type.");
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
        const migratedDocument = {
          documentStoragePath: candidatePath,
          originalFileName: oldPath.split("/").pop() || "aadhaar",
          contentType: detected.mime,
        };
        newDocuments.push(migratedDocument);
        if (newDocuments.length === 1) Object.assign(privateData, migratedDocument);
      }
    } catch (error) {
      console.warn(`Document migration failed for ${doc.id}: ${error.message}`);
    }
  }
  if (newDocuments.length > 1) privateData.additionalDocuments = newDocuments.slice(1);
  const complete = !!number && newDocuments.length > 0;
  const finalStatus = complete ? "complete" : "incomplete";
  const privateRef = db.collection("employeeAadhaarPrivate").doc(doc.id);
  await privateRef.set({ ...privateData, status: "migration_pending" }, { merge: true });
  const stagedPrivate = await privateRef.get();
  const stagedData = stagedPrivate.data();
  if (
    !stagedPrivate.exists ||
    stagedData?.employeeDocId !== doc.id ||
    (number && stagedData?.aadhaarNumberEncrypted !== privateData.aadhaarNumberEncrypted) ||
    (newDocuments.length > 0 && stagedData?.documentStoragePath !== newDocuments[0].documentStoragePath)
  ) {
    throw new Error("Private Aadhaar record verification failed.");
  }
  const batch = db.batch();
  batch.set(privateRef, { status: finalStatus, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
  const employeeUpdate = {
    aadharNumber: admin.firestore.FieldValue.delete(),
    aadhaarNumber: admin.firestore.FieldValue.delete(),
    aadharCardDocumentUrl: admin.firestore.FieldValue.delete(),
    aadhaarCardDocumentUrl: admin.firestore.FieldValue.delete(),
    "documentCompletion.aadhaar": complete ? "complete" : "missing",
    "documentCompletion.updatedAt": admin.firestore.Timestamp.now(),
  };
  if (aadhaarWasIdentityProof) {
    Object.assign(employeeUpdate, {
      identityProofType: admin.firestore.FieldValue.delete(),
      identityProofNumber: admin.firestore.FieldValue.delete(),
      identityProofUrlFront: admin.firestore.FieldValue.delete(),
      identityProofUrlBack: admin.firestore.FieldValue.delete(),
      idProofType: admin.firestore.FieldValue.delete(),
      idProofNumber: admin.firestore.FieldValue.delete(),
      idProofDocumentUrl: admin.firestore.FieldValue.delete(),
      idProofDocumentUrlFront: admin.firestore.FieldValue.delete(),
      idProofDocumentUrlBack: admin.firestore.FieldValue.delete(),
      "documentCompletion.identity": "missing",
    });
  }
  if (aadhaarWasAddressProof) {
    Object.assign(employeeUpdate, {
      addressProofType: admin.firestore.FieldValue.delete(),
      addressProofNumber: admin.firestore.FieldValue.delete(),
      addressProofUrlFront: admin.firestore.FieldValue.delete(),
      addressProofUrlBack: admin.firestore.FieldValue.delete(),
      addressProofDocumentUrl: admin.firestore.FieldValue.delete(),
      addressProofDocumentUrlFront: admin.firestore.FieldValue.delete(),
      addressProofDocumentUrlBack: admin.firestore.FieldValue.delete(),
      "documentCompletion.address": "missing",
    });
  }
  batch.update(doc.ref, employeeUpdate);
  batch.set(db.collection("sensitiveDocumentAuditLogs").doc(), {
    action: "aadhaar_legacy_migrated",
    employeeDocId: doc.id,
    category: "aadhaar",
    purpose: "esic_epf_registration",
    actorUid: "migration",
    actorType: "admin",
    outcome: complete ? "complete" : "incomplete",
    at: admin.firestore.Timestamp.now(),
  });
  try {
    await batch.commit();
  } catch (error) {
    await Promise.all(newDocuments.map(({ documentStoragePath }) => bucket.file(documentStoragePath).delete({ ignoreNotFound: true })));
    throw error;
  }
  if (newDocuments.length > 0) {
    await Promise.all(oldPaths.map((oldPath) => bucket.file(oldPath).delete({ ignoreNotFound: true })));
  }
  return { state: complete ? "complete" : "incomplete" };
}

const snapshot = await db.collection("employees").get();
const totals = { candidates: 0, complete: 0, incomplete: 0, failed: 0 };
let processed = 0;
async function processEmployee(doc) {
  try {
    const result = await migrateEmployee(doc);
    if (result.state === "candidate") totals.candidates += 1;
    if (result.state === "complete") totals.complete += 1;
    if (result.state === "incomplete") totals.incomplete += 1;
  } catch (error) {
    totals.failed += 1;
    console.error(`Migration failed for ${doc.id}: ${error.message}`);
  } finally {
    processed += 1;
    if (apply && processed % 25 === 0) {
      console.log(JSON.stringify({ progress: processed, total: snapshot.size, ...totals }));
    }
  }
}
let nextIndex = 0;
async function worker() {
  while (nextIndex < snapshot.docs.length) {
    const index = nextIndex;
    nextIndex += 1;
    await processEmployee(snapshot.docs[index]);
  }
}
await Promise.all(Array.from({ length: apply ? 12 : 1 }, () => worker()));
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...totals }, null, 2));
await app.delete();
