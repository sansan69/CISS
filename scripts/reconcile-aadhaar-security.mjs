#!/usr/bin/env node
import admin from "firebase-admin";

const apply = process.argv.includes("--apply");

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
const hasValue = (...values) => values.some((value) => typeof value === "string" && value.trim().length > 0);
const isAadhaar = (value) => /aadhaar|aadhar/i.test(String(value || ""));

const [employees, privateRecords, restrictedResult] = await Promise.all([
  db.collection("employees").get(),
  db.collection("employeeAadhaarPrivate").get(),
  bucket.getFiles({ prefix: "restrictedEmployeeAadhaar/" }),
]);
const privateByEmployee = new Map(privateRecords.docs.map((doc) => [doc.id, doc.data()]));
const policyCandidates = employees.docs.filter((doc) => {
  const policy = doc.data().enrollmentPolicy;
  return !(typeof policy === "string" ? policy : policy?.version);
});

const referencedPaths = new Set();
for (const doc of privateRecords.docs) {
  const data = doc.data();
  const documents = [data, ...(Array.isArray(data.additionalDocuments) ? data.additionalDocuments : [])];
  for (const item of documents) {
    if (typeof item?.documentStoragePath === "string" && item.documentStoragePath.startsWith(`restrictedEmployeeAadhaar/${doc.id}/`)) {
      referencedPaths.add(item.documentStoragePath);
    }
  }
}
const orphanedFiles = restrictedResult[0].filter((file) => !referencedPaths.has(file.name));

if (apply) {
  const now = admin.firestore.Timestamp.now();
  for (let offset = 0; offset < policyCandidates.length; offset += 400) {
    const batch = db.batch();
    for (const doc of policyCandidates.slice(offset, offset + 400)) {
      const data = doc.data();
      const identityIsAadhaar = isAadhaar(data.identityProofType || data.idProofType);
      const addressIsAadhaar = isAadhaar(data.addressProofType);
      const identity = !identityIsAadhaar && hasValue(data.identityProofUrlFront, data.idProofDocumentUrlFront, data.idProofDocumentUrl);
      const address = !addressIsAadhaar && hasValue(data.addressProofUrlFront, data.addressProofDocumentUrlFront, data.addressProofDocumentUrl);
      const aadhaar = typeof privateByEmployee.get(doc.id)?.documentStoragePath === "string";
      batch.update(doc.ref, {
        enrollmentPolicy: { version: "three-proof-v1", grandfathered: false, effectiveAt: now },
        "documentCompletion.aadhaar": aadhaar ? "complete" : "missing",
        "documentCompletion.identity": identity ? "complete" : "missing",
        "documentCompletion.address": address ? "complete" : "missing",
        "documentCompletion.updatedAt": now,
      });
      batch.set(db.collection("sensitiveDocumentAuditLogs").doc(), {
        action: "enrollment_policy_reconciled",
        employeeDocId: doc.id,
        category: "document_policy",
        actorUid: "security_reconciliation",
        actorType: "admin",
        outcome: "three-proof-v1",
        at: now,
      });
    }
    await batch.commit();
  }
  await Promise.all(orphanedFiles.map((file) => file.delete({ ignoreNotFound: true })));
  if (orphanedFiles.length > 0) {
    await db.collection("sensitiveDocumentAuditLogs").add({
      action: "aadhaar_orphan_storage_cleanup",
      category: "aadhaar",
      actorUid: "security_reconciliation",
      actorType: "admin",
      outcome: "complete",
      deletedObjectCount: orphanedFiles.length,
      at: now,
    });
  }
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  missingEnrollmentPolicy: policyCandidates.length,
  unreferencedRestrictedFiles: orphanedFiles.length,
}, null, 2));
await app.delete();
