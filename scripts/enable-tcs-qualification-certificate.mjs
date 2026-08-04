#!/usr/bin/env node
import admin from "firebase-admin";

const apply = process.argv.includes("--apply");
const effectiveDate = "2026-08-04";
const runId = `tcs-qualification-${new Date().toISOString().replace(/[:.]/g, "-")}`;

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
const { FieldValue } = admin.firestore;
const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const [clientsSnapshot, employeesSnapshot, configSnapshot] = await Promise.all([
  db.collection("clients").get(),
  db.collection("employees").where("clientName", "==", "TCS").get(),
  db.collection("enrollmentFormConfig").doc("global").get(),
]);

const tcsClients = clientsSnapshot.docs.filter((document) => {
  const data = document.data();
  return normalize(data.name || data.clientName) === "tcs" || data.enrollmentProfile === "tcs";
});
const existingConfig = configSnapshot.data() || {};
const existingOverrides = existingConfig.clientOverrides && typeof existingConfig.clientOverrides === "object"
  ? existingConfig.clientOverrides
  : {};
const existingTcs = existingOverrides.TCS && typeof existingOverrides.TCS === "object" ? existingOverrides.TCS : {};
const mergedTcs = {
  ...existingTcs,
  personal: {
    ...(existingTcs.personal || {}),
    resourceIdNumber: { ...(existingTcs.personal?.resourceIdNumber || {}), enabled: true, required: true },
    qualificationName: { ...(existingTcs.personal?.qualificationName || {}), enabled: true, required: true },
  },
  documents: {
    ...(existingTcs.documents || {}),
    qualificationCertificate: { ...(existingTcs.documents?.qualificationCertificate || {}), enabled: true, required: true },
  },
};

const coverage = employeesSnapshot.docs.reduce((result, document) => {
  const data = document.data();
  if (String(data.qualificationName || "").trim()) result.withQualificationName += 1;
  if (String(data.qualificationCertificateUrl || "").trim()) result.withCertificate += 1;
  return result;
}, { withQualificationName: 0, withCertificate: 0 });

if (apply) {
  const runRef = db.collection("tcsQualificationRequirementRuns").doc(runId);
  const configRef = db.collection("enrollmentFormConfig").doc("global");
  const batch = db.batch();

  batch.set(runRef.collection("backups").doc("enrollmentFormConfig-global"), {
    existed: configSnapshot.exists,
    data: configSnapshot.data() || null,
    backedUpAt: FieldValue.serverTimestamp(),
  });
  for (const client of tcsClients) {
    batch.set(runRef.collection("backups").doc(`client-${client.id}`), {
      existed: true,
      data: client.data(),
      backedUpAt: FieldValue.serverTimestamp(),
    });
    batch.set(client.ref, {
      enrollmentProfile: "tcs",
      enrollmentRequirementsVersion: "tcs-qualification-v2",
      enrollmentRequiredFields: ["resourceIdNumber", "qualificationName", "qualificationCertificate"],
      qualificationRequirementEffectiveDate: effectiveDate,
      enrollmentRequirementsUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  batch.set(configRef, {
    clientOverrides: { ...existingOverrides, TCS: mergedTcs },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(runRef, {
    runId,
    status: "complete",
    effectiveDate,
    tcsClientCount: tcsClients.length,
    existingTcsEmployeeCount: employeesSnapshot.size,
    existingCoverage: coverage,
    existingEmployeesModified: 0,
    appliedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

console.log(JSON.stringify({
  runId,
  mode: apply ? "apply" : "audit",
  effectiveDate,
  tcsClients: tcsClients.map((document) => ({ id: document.id, name: document.data().name || document.data().clientName })),
  existingTcsEmployeeCount: employeesSnapshot.size,
  existingCoverage: coverage,
  existingEmployeesModified: 0,
  configExisted: configSnapshot.exists,
}, null, 2));

await app.delete();
