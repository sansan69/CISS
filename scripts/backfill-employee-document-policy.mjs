#!/usr/bin/env node
import admin from "firebase-admin";

const apply = process.argv.includes("--apply");

function credential() {
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
});
const db = app.firestore();

const hasValue = (...values) => values.some((value) => typeof value === "string" && value.trim().length > 0);
const isAadhaarType = (value) => /aadhaar|aadhar/i.test(String(value || ""));

function completionFor(data) {
  const identityIsAadhaar = isAadhaarType(data.identityProofType || data.idProofType);
  const addressIsAadhaar = isAadhaarType(data.addressProofType);
  const identityFile = hasValue(data.identityProofUrlFront, data.idProofDocumentUrlFront, data.idProofDocumentUrl);
  const addressFile = hasValue(data.addressProofUrlFront, data.addressProofDocumentUrlFront, data.addressProofDocumentUrl);
  const aadhaarFile = hasValue(data.aadharCardDocumentUrl, data.aadhaarCardDocumentUrl) ||
    (identityIsAadhaar && identityFile) ||
    (addressIsAadhaar && addressFile);
  return {
    aadhaar: aadhaarFile ? "complete" : "missing",
    identity: !identityIsAadhaar && identityFile ? "complete" : "missing",
    address: !addressIsAadhaar && addressFile ? "complete" : "missing",
  };
}

const snapshot = await db.collection("employees").get();
const totals = { scanned: snapshot.size, candidates: 0, updated: 0, failed: 0 };
const now = admin.firestore.Timestamp.now();

for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
  const chunk = snapshot.docs.slice(offset, offset + 400);
  const batch = db.batch();
  let batchChanges = 0;
  for (const doc of chunk) {
    const data = doc.data();
    if (data.enrollmentPolicy?.version === "three-proof-v1") continue;
    const completion = completionFor(data);
    const unchanged =
      data.enrollmentPolicy?.version === "legacy" &&
      data.documentCompletion?.aadhaar === completion.aadhaar &&
      data.documentCompletion?.identity === completion.identity &&
      data.documentCompletion?.address === completion.address;
    if (unchanged) continue;
    totals.candidates += 1;
    batchChanges += 1;
    batch.set(doc.ref, {
      enrollmentPolicy: { version: "legacy", grandfathered: true, effectiveAt: now },
      documentCompletion: { ...completion, updatedAt: now },
    }, { merge: true });
  }
  if (apply && batchChanges > 0) {
    try {
      await batch.commit();
      totals.updated += batchChanges;
    } catch (error) {
      totals.failed += batchChanges;
      console.error(`Backfill batch failed at offset ${offset}: ${error.message}`);
    }
  }
}

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...totals }, null, 2));
await app.delete();
