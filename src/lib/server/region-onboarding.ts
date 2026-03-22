import * as admin from "firebase-admin";

import {
  buildServerAuditEvent,
  buildServerCreateAudit,
} from "@/lib/server/audit";
import type {
  RegionCredentialInput,
  RegionOnboardingChecklist,
  RegionRecord,
  RegionStatus,
  RegionWebConfigInput,
} from "@/types/region";

type RegionAdminTarget = {
  email: string;
  password: string;
  displayName?: string | null;
};

type RegionConnectionCheck = {
  projectIdMatches: boolean;
  firestoreReachable: boolean;
  authReachable: boolean;
  storageReachable: boolean;
};

function explainValidationFailure(stage: "firestore" | "auth" | "storage", error: unknown) {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  const message = rawMessage.toLowerCase();

  if (stage === "firestore") {
    if (message.includes("database") || message.includes("not found")) {
      return "Firestore is not ready yet. Open Firebase Console > Firestore Database and create the default database first.";
    }
    return `Firestore check failed: ${rawMessage}`;
  }

  if (stage === "auth") {
    if (message.includes("no configuration corresponding") || message.includes("identity toolkit")) {
      return "Authentication is not ready yet. Open Firebase Console > Authentication, click Get started, and enable Email/Password sign-in.";
    }
    return `Firebase Auth check failed: ${rawMessage}`;
  }

  if (message.includes("bucket") || message.includes("storage")) {
    return "Storage is not ready yet. Open Firebase Console > Storage and finish the default bucket setup.";
  }
  return `Storage check failed: ${rawMessage}`;
}

export const DEFAULT_REGION_CHECKLIST: RegionOnboardingChecklist = {
  metadataSaved: true,
  firebaseValidated: false,
  defaultsSeeded: false,
  regionAdminCreated: false,
  vercelConfigured: false,
};

const DEFAULT_COMPLIANCE_SETTINGS = {
  epf: {
    employeeRate: 0.12,
    employerEpsRate: 0.0833,
    employerEpfRate: 0.0367,
    wageCeiling: 15000,
    maxEmployerContribution: 1800,
  },
  esic: {
    employeeRate: 0.0075,
    employerRate: 0.0325,
    grossWageCeiling: 21000,
  },
  professionalTax: {
    state: "Needs Review",
    slabs: [
      { upTo: 11999, monthly: 0 },
      { upTo: 17999, monthly: 120 },
      { upTo: 29999, monthly: 180 },
      { upTo: null, monthly: 200 },
    ],
  },
  tds: {
    regime: "new",
    standardDeduction: 75000,
    slabs: [
      { upTo: 300000, rate: 0 },
      { upTo: 700000, rate: 0.05 },
      { upTo: 1000000, rate: 0.1 },
      { upTo: 1200000, rate: 0.15 },
      { upTo: 1500000, rate: 0.2 },
      { upTo: null, rate: 0.3 },
    ],
  },
  bonus: {
    rate: 0.0833,
    minimumWageBase: 7000,
  },
  gratuity: {
    rate: 0.0481,
    minimumYearsForPayout: 5,
  },
  needsReview: true,
};

function parseServiceAccount(input: RegionCredentialInput) {
  const normalize = (raw: Record<string, unknown>) => {
    const projectId =
      typeof raw.projectId === "string"
        ? raw.projectId
        : typeof raw.project_id === "string"
          ? raw.project_id
          : undefined;
    const clientEmail =
      typeof raw.clientEmail === "string"
        ? raw.clientEmail
        : typeof raw.client_email === "string"
          ? raw.client_email
          : undefined;
    const privateKey =
      typeof raw.privateKey === "string"
        ? raw.privateKey
        : typeof raw.private_key === "string"
          ? raw.private_key
          : undefined;

    return {
      ...raw,
      projectId,
      clientEmail,
      privateKey,
    } as admin.ServiceAccount;
  };

  const base64 = input.serviceAccountBase64?.trim();
  if (base64) {
    const decoded = Buffer.from(base64, "base64").toString("utf-8");
    return normalize(JSON.parse(decoded) as Record<string, unknown>);
  }

  const json = input.serviceAccountJson?.trim();
  if (json) {
    return normalize(JSON.parse(json) as Record<string, unknown>);
  }

  throw new Error("Service account credentials are required for region onboarding.");
}

function normalizeRegionCode(regionCode: string) {
  return regionCode.trim().toUpperCase();
}

export function makeRegionRecord(
  input: {
    regionCode: string;
    regionName: string;
    regionAdminEmail?: string | null;
  } & RegionWebConfigInput,
): RegionRecord {
  const regionCode = normalizeRegionCode(input.regionCode);

  return {
    id: regionCode,
    regionCode,
    regionName: input.regionName.trim(),
    regionAdminEmail: input.regionAdminEmail?.trim() || null,
    firebaseProjectId: input.firebaseProjectId.trim(),
    firebaseApiKey: input.firebaseApiKey?.trim() || null,
    firebaseWebAppId: input.firebaseWebAppId?.trim() || null,
    storageBucket: input.storageBucket?.trim() || null,
    authDomain: input.authDomain?.trim() || null,
    messagingSenderId: input.messagingSenderId?.trim() || null,
    measurementId: input.measurementId?.trim() || null,
    status: "config_pending",
    appMode: "regional",
    onboardingChecklist: DEFAULT_REGION_CHECKLIST,
  };
}

async function withRegionAdminApp<T>(
  credentials: RegionCredentialInput,
  callback: (ctx: {
    app: admin.app.App;
    db: FirebaseFirestore.Firestore;
    auth: admin.auth.Auth;
    bucket: (ReturnType<admin.app.App["storage"]>["bucket"] extends (...args: any[]) => infer T ? T : any) | null;
    serviceAccount: admin.ServiceAccount;
  }) => Promise<T>,
) {
  const serviceAccount = parseServiceAccount(credentials);
  const projectId = credentials.firebaseProjectId.trim();

  if (serviceAccount.projectId && serviceAccount.projectId !== projectId) {
    throw new Error(
      `Service account project (${serviceAccount.projectId}) does not match Firebase project (${projectId}).`,
    );
  }

  const appName = `region-onboarding-${projectId}-${Date.now()}`;
  const app = admin.initializeApp(
    {
      credential: admin.credential.cert({
        ...serviceAccount,
        privateKey: serviceAccount.privateKey?.replace(/\\n/g, "\n"),
      }),
      projectId,
      storageBucket: credentials.storageBucket || undefined,
    },
    appName,
  );

  try {
    return await callback({
      app,
      db: app.firestore(),
      auth: app.auth(),
      bucket: credentials.storageBucket
        ? app.storage().bucket(credentials.storageBucket)
        : null,
      serviceAccount,
    });
  } finally {
    await app.delete().catch(() => undefined);
  }
}

export async function validateRegionFirebaseConnection(
  credentials: RegionCredentialInput,
) {
  return withRegionAdminApp(credentials, async ({ db, auth, bucket, serviceAccount }) => {
    const checks: RegionConnectionCheck = {
      projectIdMatches:
        !serviceAccount.projectId ||
        serviceAccount.projectId === credentials.firebaseProjectId,
      firestoreReachable: false,
      authReachable: false,
      storageReachable: false,
    };

    const messages: string[] = [];

    try {
      await db.listCollections();
      checks.firestoreReachable = true;
      messages.push("Firestore connection verified.");
    } catch (error) {
      messages.push(explainValidationFailure("firestore", error));
    }

    try {
      await auth.listUsers(1);
      checks.authReachable = true;
      messages.push("Firebase Auth access verified.");
    } catch (error) {
      messages.push(explainValidationFailure("auth", error));
    }

    if (credentials.storageBucket && bucket) {
      try {
        await bucket.getMetadata();
        checks.storageReachable = true;
        messages.push("Cloud Storage bucket access verified.");
      } catch (error) {
        messages.push(explainValidationFailure("storage", error));
      }
    } else {
      messages.push(
        "Storage bucket was not provided in the region record. Add it after Storage has been initialized in Firebase Console.",
      );
    }

    return {
      checks,
      messages,
      success:
        checks.projectIdMatches &&
        checks.firestoreReachable &&
        checks.authReachable &&
        (credentials.storageBucket ? checks.storageReachable : true),
    };
  });
}

export async function seedRegionDefaults(
  credentials: RegionCredentialInput,
  region: Pick<RegionRecord, "regionCode" | "regionName" | "firebaseProjectId">,
  actor?: { uid?: string | null; email?: string | null },
) {
  return withRegionAdminApp(credentials, async ({ db }) => {
    const batch = db.batch();

    const complianceRef = db.collection("complianceSettings").doc("global");
    const systemConfigRef = db.collection("systemConfig").doc("runtime");

    batch.set(
      complianceRef,
      {
        ...DEFAULT_COMPLIANCE_SETTINGS,
        regionCode: region.regionCode,
        regionName: region.regionName,
        sourceProjectId: region.firebaseProjectId,
        ...buildServerCreateAudit(actor),
      },
      { merge: true },
    );

    batch.set(
      systemConfigRef,
      {
        appMode: "regional",
        regionCode: region.regionCode,
        regionName: region.regionName,
        firebaseProjectId: region.firebaseProjectId,
        seededAt: new Date(),
        onboardingReady: true,
        ...buildServerCreateAudit(actor),
      },
      { merge: true },
    );

    await batch.commit();

    return {
      seededDocs: ["complianceSettings/global", "systemConfig/runtime"],
    };
  });
}

export async function createRegionAdminAccount(
  credentials: RegionCredentialInput,
  region: Pick<RegionRecord, "regionCode" | "regionName">,
  target: RegionAdminTarget,
) {
  return withRegionAdminApp(credentials, async ({ auth }) => {
    let userRecord: admin.auth.UserRecord | null = null;
    let created = false;

    try {
      userRecord = await auth.getUserByEmail(target.email);
    } catch (error: any) {
      if (error?.code !== "auth/user-not-found") {
        throw error;
      }
    }

    if (!userRecord) {
      userRecord = await auth.createUser({
        email: target.email,
        password: target.password,
        displayName: target.displayName || undefined,
      });
      created = true;
    } else if (target.displayName && !userRecord.displayName) {
      await auth.updateUser(userRecord.uid, { displayName: target.displayName });
      userRecord = await auth.getUser(userRecord.uid);
    }

    await auth.setCustomUserClaims(userRecord.uid, {
      role: "admin",
      admin: true,
      stateCode: region.regionCode,
    });

    return {
      uid: userRecord.uid,
      email: userRecord.email,
      created,
      regionCode: region.regionCode,
    };
  });
}

export function mergeChecklist(
  current: Partial<RegionOnboardingChecklist> | undefined | null,
  patch: Partial<RegionOnboardingChecklist> | undefined | null,
) {
  return {
    ...DEFAULT_REGION_CHECKLIST,
    ...current,
    ...patch,
  };
}

export function nextRegionStatus(checklist: RegionOnboardingChecklist): RegionStatus {
  if (
    checklist.metadataSaved &&
    checklist.firebaseValidated &&
    checklist.defaultsSeeded &&
    checklist.regionAdminCreated &&
    checklist.vercelConfigured
  ) {
    return "ready";
  }
  if (
    checklist.metadataSaved &&
    checklist.firebaseValidated &&
    checklist.defaultsSeeded &&
    checklist.regionAdminCreated
  ) {
    return "seeded";
  }
  if (checklist.defaultsSeeded) return "seeded";
  if (checklist.firebaseValidated) return "validated";
  if (checklist.metadataSaved) return "config_pending";
  return "draft";
}

export function buildRegionAudit(
  action: string,
  actor?: { uid?: string | null; email?: string | null },
  details: Record<string, unknown> = {},
) {
  return buildServerAuditEvent(action, actor, details);
}
