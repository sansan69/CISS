#!/usr/bin/env node
import admin from "firebase-admin";

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

function present(value) {
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
}

function isAadhaarProof(value) {
  return /aadhaar|aadhar/i.test(String(value || ""));
}

const [employees, privateRecords, auditCount, restrictedFilesResult] = await Promise.all([
  db.collection("employees").get(),
  db.collection("employeeAadhaarPrivate").get(),
  db.collection("sensitiveDocumentAuditLogs").count().get(),
  bucket.getFiles({ prefix: "restrictedEmployeeAadhaar/" }),
]);

const employee = {
  total: employees.size,
  legacyPolicy: 0,
  threeProofV1Policy: 0,
  missingPolicy: 0,
  aadhaarComplete: 0,
  aadhaarMissing: 0,
  plaintextAadhaarNumberRecords: 0,
  aadhaarUrlRecords: 0,
};
for (const doc of employees.docs) {
  const data = doc.data();
  const policy = typeof data.enrollmentPolicy === "string" ? data.enrollmentPolicy : data.enrollmentPolicy?.version;
  if (policy === "legacy") employee.legacyPolicy += 1;
  else if (policy === "three-proof-v1") employee.threeProofV1Policy += 1;
  else employee.missingPolicy += 1;
  if (data.documentCompletion?.aadhaar === "complete") employee.aadhaarComplete += 1;
  else employee.aadhaarMissing += 1;

  const identityAadhaar = isAadhaarProof(data.identityProofType || data.idProofType);
  const addressAadhaar = isAadhaarProof(data.addressProofType);
  const hasNumber = present(data.aadharNumber) || present(data.aadhaarNumber) ||
    (identityAadhaar && (present(data.identityProofNumber) || present(data.idProofNumber))) ||
    (addressAadhaar && present(data.addressProofNumber));
  if (hasNumber) employee.plaintextAadhaarNumberRecords += 1;

  const hasUrl = present(data.aadharCardDocumentUrl) || present(data.aadhaarCardDocumentUrl) ||
    (identityAadhaar && [data.identityProofUrlFront, data.identityProofUrlBack, data.idProofDocumentUrl, data.idProofDocumentUrlFront, data.idProofDocumentUrlBack].some(present)) ||
    (addressAadhaar && [data.addressProofUrlFront, data.addressProofUrlBack, data.addressProofDocumentUrl, data.addressProofDocumentUrlFront, data.addressProofDocumentUrlBack].some(present));
  if (hasUrl) employee.aadhaarUrlRecords += 1;
}

const privateSummary = {
  total: privateRecords.size,
  encryptedNumber: 0,
  restrictedDocumentPath: 0,
  complete: 0,
  incomplete: 0,
  migrationPending: 0,
  invalidDocumentPath: 0,
};
const referencedPaths = new Set();
for (const doc of privateRecords.docs) {
  const data = doc.data();
  if (present(data.aadhaarNumberEncrypted) && present(data.encryptedDataKey)) privateSummary.encryptedNumber += 1;
  if (data.status === "complete") privateSummary.complete += 1;
  else if (data.status === "migration_pending") privateSummary.migrationPending += 1;
  else privateSummary.incomplete += 1;
  const documents = [data, ...(Array.isArray(data.additionalDocuments) ? data.additionalDocuments : [])];
  for (const item of documents) {
    if (!present(item?.documentStoragePath)) continue;
    if (!String(item.documentStoragePath).startsWith(`restrictedEmployeeAadhaar/${doc.id}/`)) privateSummary.invalidDocumentPath += 1;
    else referencedPaths.add(item.documentStoragePath);
  }
  if (present(data.documentStoragePath)) privateSummary.restrictedDocumentPath += 1;
}

const restrictedFiles = restrictedFilesResult[0];
const restrictedNames = new Set(restrictedFiles.map((file) => file.name));
const storage = {
  restrictedFiles: restrictedFiles.length,
  filesWithDownloadToken: 0,
  filesWithoutNoStore: 0,
  referencedFilesMissing: 0,
  unreferencedFiles: 0,
};
for (const file of restrictedFiles) {
  if (present(file.metadata?.metadata?.firebaseStorageDownloadTokens)) storage.filesWithDownloadToken += 1;
  if (!String(file.metadata?.cacheControl || "").toLowerCase().includes("no-store")) storage.filesWithoutNoStore += 1;
  if (!referencedPaths.has(file.name)) storage.unreferencedFiles += 1;
}
for (const path of referencedPaths) {
  if (!restrictedNames.has(path)) storage.referencedFilesMissing += 1;
}

console.log(JSON.stringify({
  auditedAt: new Date().toISOString(),
  employee,
  private: privateSummary,
  storage,
  sensitiveAuditEvents: auditCount.data().count,
}, null, 2));
await app.delete();
