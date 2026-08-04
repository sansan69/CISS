#!/usr/bin/env node
import admin from "firebase-admin";

const apply = process.argv.includes("--apply");
const runId = `client-enrollment-profiles-${new Date().toISOString().replace(/[:.]/g, "-")}`;

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
});
const db = app.firestore();
const { FieldValue } = admin.firestore;

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

const lngNames = new Set([
  "lngpetronet",
  "petronetlng",
  "petronetlngltd",
  "petronetlnglimited",
  "lngpetronetltd",
  "lngpetronetlimited",
]);

const lngServiceBookDesignations = [
  "Ex Servicemen Security Guard - Military",
  "Ex Servicemen Security Guard - Paramilitary",
  "Supervisor",
  "Armed Guard (Gunman) - Military",
  "Armed Guard (Gunman) - Paramilitary",
];
const lngArmsLicenseDesignations = [
  "Armed Guard (Gunman) - Military",
  "Armed Guard (Gunman) - Paramilitary",
];

function profileFor(name, storedProfile) {
  if (storedProfile === "lng-petronet" || lngNames.has(normalize(name))) return "lng-petronet";
  if (storedProfile === "tcs" || normalize(name) === "tcs") return "tcs";
  return "standard";
}

function profileMetadata(profile) {
  if (profile === "lng-petronet") {
    return {
      enrollmentProfile: profile,
      enrollmentRequirementsVersion: "client-enrollment-v1",
      enrollmentRequiredFields: [
        "fullNameInput",
        "lngJobDesignation",
        "panNumber",
        "panCardDocument",
        "nationality",
        "identificationMark",
        "heightCm",
        "weightKg",
        "branchName",
      ],
      enrollmentConditionalFields: {
        serviceBook: {
          fields: ["serviceBookNumber", "serviceBookDocument"],
          designations: lngServiceBookDesignations,
        },
        armsLicense: {
          fields: ["armsLicenseNumber", "armsLicenseDocument"],
          designations: lngArmsLicenseDesignations,
        },
      },
    };
  }
  if (profile === "tcs") {
    return {
      enrollmentProfile: profile,
      enrollmentRequirementsVersion: "client-enrollment-v1",
      enrollmentRequiredFields: ["resourceIdNumber"],
      enrollmentConditionalFields: {},
    };
  }
  return {
    enrollmentProfile: profile,
    enrollmentRequirementsVersion: "client-enrollment-v1",
    enrollmentRequiredFields: [],
    enrollmentConditionalFields: {},
  };
}

const clientSnapshot = await db.collection("clients").get();
const changes = clientSnapshot.docs.map((document) => {
  const data = document.data();
  const name = data.name || data.clientName || "";
  const profile = profileFor(name, data.enrollmentProfile);
  return { document, name, profile, update: profileMetadata(profile) };
});

const clientOverrides = {
  TCS: {
    personal: { resourceIdNumber: { enabled: true, required: true } },
  },
  "LNG Petronet": {
    personal: {
      fullNameInput: { enabled: true, required: true },
      firstName: { enabled: false, required: false },
      lastName: { enabled: false, required: false },
      lngJobDesignation: { enabled: true, required: true },
      serviceBookNumber: { enabled: true, required: false },
      serviceBookDocument: { enabled: true, required: false },
      armsLicenseNumber: { enabled: true, required: false },
      armsLicenseDocument: { enabled: true, required: false },
      passportCountryName: { enabled: true, required: false },
      passportDocument: { enabled: true, required: false },
    },
    documents: { panCardDocument: { enabled: true, required: true } },
    bank: { branchName: { enabled: true, required: true } },
    details: {
      nationality: { enabled: true, required: true },
      identificationMark: { enabled: true, required: true },
      heightCm: { enabled: true, required: true },
      weightKg: { enabled: true, required: true },
      legacyUniqueId: { enabled: true, required: false },
    },
  },
};

if (apply) {
  const runRef = db.collection("clientEnrollmentProfileRepairRuns").doc(runId);
  const formConfigRef = db.collection("enrollmentFormConfig").doc("global");
  const existingConfig = await formConfigRef.get();
  const batch = db.batch();

  batch.set(runRef.collection("backups").doc("enrollmentFormConfig-global"), {
    existed: existingConfig.exists,
    data: existingConfig.data() || null,
    backedUpAt: FieldValue.serverTimestamp(),
  });
  for (const change of changes) {
    batch.set(runRef.collection("backups").doc(change.document.id), {
      existed: true,
      data: change.document.data(),
      backedUpAt: FieldValue.serverTimestamp(),
    });
    batch.set(change.document.ref, {
      ...change.update,
      enrollmentRequirementsUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  batch.set(formConfigRef, { clientOverrides }, { merge: true });
  batch.set(runRef, {
    runId,
    status: "complete",
    clientCount: changes.length,
    appliedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

const summary = {
  runId,
  mode: apply ? "apply" : "audit",
  clientCount: changes.length,
  profiles: changes.reduce((counts, change) => {
    counts[change.profile] = (counts[change.profile] || 0) + 1;
    return counts;
  }, {}),
  clients: changes.map((change) => ({ id: change.document.id, name: change.name, profile: change.profile })),
};

console.log(JSON.stringify(summary, null, 2));
await app.delete();
