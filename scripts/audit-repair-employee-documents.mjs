#!/usr/bin/env node
import admin from "firebase-admin";

const apply = process.argv.includes("--apply");
const cutoff = new Date("2026-08-01T18:29:59.999Z");
const runId = `employee-documents-${new Date().toISOString().replace(/[:.]/g, "-")}`;

function credential() {
  if (process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64) {
    return admin.credential.cert(JSON.parse(
      Buffer.from(process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64, "base64").toString("utf8"),
    ));
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

const FIELD_ALIASES = {
  profilePictureUrl: ["profilePictureUrl", "profilePhotoUrl", "profilePhoto"],
  signatureUrl: ["signatureUrl", "signature", "signatureDocumentUrl"],
  identityProofUrlFront: [
    "identityProofUrlFront", "idProofFrontUrl", "idProofFront", "idProofDocumentUrlFront",
    "idProofDocumentUrl", "identityProofDocumentUrlFront",
  ],
  identityProofUrlBack: [
    "identityProofUrlBack", "idProofBackUrl", "idProofBack", "idProofDocumentUrlBack",
    "identityProofDocumentUrlBack",
  ],
  addressProofUrlFront: [
    "addressProofUrlFront", "addressProofFrontUrl", "addressProofFront", "addressProofDocumentUrlFront",
  ],
  addressProofUrlBack: [
    "addressProofUrlBack", "addressProofBackUrl", "addressProofBack", "addressProofDocumentUrlBack",
  ],
  bankPassbookStatementUrl: [
    "bankPassbookStatementUrl", "bankPassbookStatement", "bankDocumentUrl", "bankPassbookUrl",
    "passbookDocumentUrl", "bankProofUrl", "bankStatementUrl",
  ],
  panCardDocumentUrl: ["panCardDocumentUrl", "panCardUrl", "panDocumentUrl"],
  serviceBookDocumentUrl: ["serviceBookDocumentUrl", "serviceBookUrl", "serviceBookSourceUrl"],
  armsLicenseDocumentUrl: ["armsLicenseDocumentUrl", "armsLicenseUrl", "armsLicenseSourceUrl", "armsLicenseCopyUrl"],
  passportDocumentUrl: ["passportDocumentUrl", "passportUrl", "passportCopyUrl"],
  policeClearanceCertificateUrl: [
    "policeClearanceCertificateUrl", "policeClearanceUrl", "pccUrl", "policeCertificateUrl",
  ],
};

const FIELD_FOLDERS = {
  profilePictureUrl: "profilePictures",
  signatureUrl: "signatures",
  identityProofUrlFront: "idProofs",
  identityProofUrlBack: "idProofs",
  addressProofUrlFront: "addressProofs",
  addressProofUrlBack: "addressProofs",
  bankPassbookStatementUrl: "bankDocuments",
  panCardDocumentUrl: "panCards",
  serviceBookDocumentUrl: "serviceBooks",
  armsLicenseDocumentUrl: "armsLicenses",
  passportDocumentUrl: "passports",
  policeClearanceCertificateUrl: "policeCertificates",
};

const fields = Object.keys(FIELD_ALIASES);

function documentReference(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    for (const key of ["url", "downloadURL", "downloadUrl", "uri", "path", "storagePath", "fullPath"]) {
      if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
    }
  }
  return "";
}

function firstReference(data, names) {
  for (const name of names) {
    const reference = documentReference(data[name]);
    if (reference) return reference;
  }
  return "";
}

function storagePath(reference) {
  if (!reference) return "";
  if (/^(employees|enrollments)\/[A-Za-z0-9_-]+\//.test(reference)) return reference;
  if (reference.startsWith("gs://")) {
    const prefix = `gs://${bucket.name}/`;
    return reference.startsWith(prefix) ? reference.slice(prefix.length) : "";
  }
  let url;
  try {
    url = new URL(reference);
  } catch {
    return "";
  }
  if (url.hostname !== "firebasestorage.googleapis.com") return "";
  const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
  if (!match || decodeURIComponent(match[1]) !== bucket.name) return "";
  return decodeURIComponent(match[2]);
}

function rootFromPath(path) {
  const match = path.match(/^(employees|enrollments)\/([A-Za-z0-9_-]+)\//);
  return match ? `${match[1]}/${match[2]}` : "";
}

function fileSide(path) {
  const name = path.split("/").pop()?.toLowerCase() || "";
  if (/(?:^|[_-])back(?:[_.-]|$)/.test(name)) return "back";
  if (/(?:^|[_-])front(?:[_.-]|$)/.test(name)) return "front";
  return "unknown";
}

function selectCandidate(paths, field) {
  const sorted = [...paths].sort().reverse();
  if (field.endsWith("Front")) return sorted.find((path) => fileSide(path) === "front") || "";
  if (field.endsWith("Back")) return sorted.find((path) => fileSide(path) === "back") || "";
  return sorted[0] || "";
}

function recordDate(data) {
  const value = data.createdAt || data.enrolledAt || data.joiningDate;
  if (value?.toDate) return value.toDate();
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

const [employeeSnapshot, enrollmentSnapshot, employeeFilesResult, enrollmentFilesResult] = await Promise.all([
  db.collection("employees").get(),
  db.collection("enrollments").get(),
  bucket.getFiles({ prefix: "employees/" }),
  bucket.getFiles({ prefix: "enrollments/" }),
]);

const documentPathPattern = /\/(profilePictures|signatures|idProofs|addressProofs|bankDocuments|serviceBooks|armsLicenses|panCards|passports|policeCertificates)\//;
const allDocumentPaths = [...employeeFilesResult[0], ...enrollmentFilesResult[0]]
  .map((file) => file.name)
  .filter((path) => documentPathPattern.test(path));
const existingPaths = new Set(allDocumentPaths);
const pathsByRootAndFolder = new Map();
for (const path of allDocumentPaths) {
  const root = rootFromPath(path);
  const folder = path.match(documentPathPattern)?.[1];
  if (!root || !folder) continue;
  const key = `${root}/${folder}`;
  const values = pathsByRootAndFolder.get(key) || [];
  values.push(path);
  pathsByRootAndFolder.set(key, values);
}

const enrollmentRootsByEmployee = new Map();
for (const enrollment of enrollmentSnapshot.docs) {
  const employeeDocId = String(enrollment.data().employeeDocId || "").trim();
  if (!employeeDocId) continue;
  const roots = enrollmentRootsByEmployee.get(employeeDocId) || new Set();
  roots.add(`enrollments/${enrollment.id}`);
  enrollmentRootsByEmployee.set(employeeDocId, roots);
}

const phoneCounts = new Map();
for (const employee of employeeSnapshot.docs) {
  const phone = String(employee.data().phoneNumber || "").replace(/\D/g, "");
  if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1);
}

const categoryStats = Object.fromEntries(fields.map((field) => [field, {
  referenced: 0,
  verified: 0,
  externalUnverified: 0,
  broken: 0,
  recoverable: 0,
  missing: 0,
  repaired: 0,
}]));
const segmentStats = {
  throughAugust1: { employees: 0, withAnyDocument: 0, withAllCoreDocuments: 0, repaired: 0 },
  afterAugust1: { employees: 0, withAnyDocument: 0, withAllCoreDocuments: 0, repaired: 0 },
};
const repairs = [];
const brokenReferences = [];
const unresolved = [];

for (const employee of employeeSnapshot.docs) {
  const data = employee.data();
  const date = recordDate(data);
  const segment = !date || date <= cutoff ? segmentStats.throughAugust1 : segmentStats.afterAugust1;
  segment.employees += 1;
  const phone = String(data.phoneNumber || "").replace(/\D/g, "");
  const roots = new Set(enrollmentRootsByEmployee.get(employee.id) || []);
  if (phone && phoneCounts.get(phone) === 1) {
    roots.add(`employees/${phone}`);
    roots.add(`enrollments/${phone}`);
  }

  const current = {};
  for (const field of fields) {
    current[field] = firstReference(data, FIELD_ALIASES[field]);
    const path = storagePath(current[field]);
    const root = rootFromPath(path);
    if (root) roots.add(root);
  }

  const updates = {};
  const backup = {};
  let documentCount = 0;
  for (const field of fields) {
    const reference = current[field];
    const path = storagePath(reference);
    const isExternal = Boolean(reference && !path);
    const exists = Boolean(path && existingPaths.has(path));
    if (reference) categoryStats[field].referenced += 1;
    if (exists) categoryStats[field].verified += 1;
    if (isExternal) categoryStats[field].externalUnverified += 1;
    if (path && !exists) {
      categoryStats[field].broken += 1;
      brokenReferences.push({ employeeDocId: employee.id, employeeId: data.employeeId || null, field, path });
    }

    let candidate = "";
    if (!exists && !isExternal) {
      const candidates = [];
      for (const root of roots) {
        candidates.push(...(pathsByRootAndFolder.get(`${root}/${FIELD_FOLDERS[field]}`) || []));
      }
      candidate = selectCandidate(Array.from(new Set(candidates)), field);
    }

    if (candidate) {
      categoryStats[field].recoverable += 1;
      updates[field] = candidate;
      backup[field] = Object.prototype.hasOwnProperty.call(data, field) ? data[field] : null;
      if (apply) categoryStats[field].repaired += 1;
      documentCount += 1;
    } else if (exists || isExternal) {
      documentCount += 1;
      if (!data[field] && reference) {
        updates[field] = reference;
        backup[field] = Object.prototype.hasOwnProperty.call(data, field) ? data[field] : null;
        if (apply) categoryStats[field].repaired += 1;
      }
    } else {
      categoryStats[field].missing += 1;
      unresolved.push({ employeeDocId: employee.id, employeeId: data.employeeId || null, field });
    }
  }

  if (documentCount > 0) segment.withAnyDocument += 1;
  const core = [
    "profilePictureUrl", "signatureUrl", "identityProofUrlFront", "identityProofUrlBack",
    "addressProofUrlFront", "addressProofUrlBack", "bankPassbookStatementUrl",
  ];
  if (core.every((field) => Boolean(updates[field] || current[field]))) segment.withAllCoreDocuments += 1;

  if (Object.keys(updates).length > 0) {
    repairs.push({ employee, data, updates, backup, segment });
  }
}

if (apply && repairs.length > 0) {
  for (let offset = 0; offset < repairs.length; offset += 200) {
    const batch = db.batch();
    for (const repair of repairs.slice(offset, offset + 200)) {
      const now = admin.firestore.Timestamp.now();
      batch.set(
        db.collection("employeeDocumentRepairRuns").doc(runId).collection("backups").doc(repair.employee.id),
        {
          employeeDocId: repair.employee.id,
          employeeId: repair.data.employeeId || null,
          previousCanonicalFields: repair.backup,
          repairedFields: Object.keys(repair.updates),
          createdAt: now,
        },
      );
      batch.set(repair.employee.ref, {
        ...repair.updates,
        documentCompletion: {
          identity: (repair.updates.identityProofUrlFront || firstReference(repair.data, FIELD_ALIASES.identityProofUrlFront)) ? "complete" : "missing",
          address: (repair.updates.addressProofUrlFront || firstReference(repair.data, FIELD_ALIASES.addressProofUrlFront)) ? "complete" : "missing",
          signature: (repair.updates.signatureUrl || firstReference(repair.data, FIELD_ALIASES.signatureUrl)) ? "complete" : "missing",
          updatedAt: now,
        },
        documentReferenceRepair: {
          runId,
          repairedFields: Object.keys(repair.updates),
          repairedAt: now,
        },
        updatedAt: now,
      }, { merge: true });
      repair.segment.repaired += 1;
    }
    await batch.commit();
  }
}

const summary = {
  mode: apply ? "apply" : "dry-run",
  runId,
  projectId: app.options.projectId,
  bucket: bucket.name,
  cutoff: cutoff.toISOString(),
  employeeCount: employeeSnapshot.size,
  enrollmentCount: enrollmentSnapshot.size,
  storageDocumentCount: allDocumentPaths.length,
  duplicatePhoneValues: Array.from(phoneCounts.values()).filter((count) => count > 1).length,
  employeesNeedingRepair: repairs.length,
  repairedEmployees: apply ? repairs.length : 0,
  categoryStats,
  segmentStats,
  brokenReferenceCount: brokenReferences.length,
  unresolvedFieldCount: unresolved.length,
  repairSample: repairs.slice(0, 40).map(({ employee, data, updates }) => ({
    employeeDocId: employee.id,
    employeeId: data.employeeId || null,
    repairedFields: Object.keys(updates),
    verifiedStoragePaths: Object.fromEntries(
      Object.entries(updates).map(([field, reference]) => [
        field,
        storagePath(reference) || "external-reference",
      ]),
    ),
  })),
  brokenReferenceSample: brokenReferences.slice(0, 25),
  unresolvedSample: unresolved.slice(0, 25),
};

if (apply) {
  await db.collection("employeeDocumentRepairRuns").doc(runId).set({
    ...summary,
    brokenReferenceSample: summary.brokenReferenceSample,
    unresolvedSample: summary.unresolvedSample,
    completedAt: admin.firestore.Timestamp.now(),
  });
}

console.log(JSON.stringify(summary, null, 2));
await app.delete();
