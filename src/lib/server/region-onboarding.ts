import * as admin from "firebase-admin";

import {
  buildServerAuditEvent,
  buildServerCreateAudit,
} from "@/lib/server/audit";
import {
  DEFAULT_ENROLLMENT_FORM_CONFIG,
  DEFAULT_SETUP_PROGRESS,
} from "@/lib/region-wizard";
import type {
  AndroidGoogleServicesConfig,
  RegionCredentialInput,
  RegionOnboardingChecklist,
  RegionOnboardingMode,
  RegionRecord,
  RegionStatus,
  RegionWebConfigInput,
} from "@/types/region";

type RegionAdminTarget = {
  email: string;
  password: string;
  displayName?: string | null;
};

/**
 * Input error raised by the onboarding helpers. The route maps `status` onto the
 * HTTP response so the UI can show the server message without clearing the form.
 */
export class RegionInputError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RegionInputError";
    this.status = status;
  }
}

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

export const REGION_DEFAULT_SEEDED_DOCS = [
  "systemConfig/runtime",
  "enrollmentFormConfig/global",
  "regionSetupProgress/default",
] as const;

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

export const MAX_ALLOWED_DOMAINS = 20;

/** RFC-1123 host label: alphanumerics plus interior hyphens. */
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Fields that must never be echoed by a route or copied onto a region document. */
const REGION_SECRET_FIELDS = [
  "serviceAccount",
  "serviceAccountJson",
  "serviceAccountBase64",
  "encryptedServiceAccount",
  "privateKey",
  "private_key",
  "clientEmail",
  "client_email",
] as const;

function invalidDomain(raw: string, detail: string): RegionInputError {
  return new RegionInputError(
    `Invalid allowed domain "${raw.trim()}": ${detail} Use a hostname such as "ciss-tn.in" or "*.ciss-tn.in".`,
  );
}

/**
 * Reduce one allowlist entry to a bare lowercase hostname.
 *
 * Operators paste whatever they have: `https://CISS-TN.in/`, `ciss-tn.in:443`,
 * `ciss-tn.in.`, or a wildcard. All of those are the same lock entry, and the
 * host matcher in `domain-lock.ts` compares bare hostnames only.
 */
function normalizeDomainToken(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) throw invalidDomain(raw, "the entry is empty.");

  // Scheme (https://, http://, or a pasted //host).
  const scheme = value.match(/^[a-z][a-z0-9+.-]*:\/\//);
  if (scheme) value = value.slice(scheme[0].length);
  else if (value.startsWith("//")) value = value.slice(2);

  // Path, query, fragment.
  value = value.split(/[/?#]/, 1)[0] ?? "";

  // Userinfo is never part of a host allowlist.
  if (value.includes("@")) throw invalidDomain(raw, "credentials are not allowed in a domain.");

  let wildcard = false;
  if (value.startsWith("*.")) {
    wildcard = true;
    value = value.slice(2);
  }
  if (value.includes("*")) {
    throw invalidDomain(raw, "a wildcard is only allowed as the leading \"*.\" label.");
  }

  // Port suffix (only a numeric port is a port; anything else is not a hostname).
  const port = value.match(/:([0-9]{1,5})$/);
  if (port) value = value.slice(0, -port[0].length);
  else if (value.includes(":")) throw invalidDomain(raw, "IPv6 literals are not supported.");

  // Trailing dot is the DNS root form of the same host.
  value = value.replace(/\.+$/, "");

  if (!value) throw invalidDomain(raw, "the hostname is empty.");
  if (/\s/.test(value)) throw invalidDomain(raw, "the hostname contains whitespace.");
  if (value.length > 253) throw invalidDomain(raw, "the hostname is too long.");

  const labels = value.split(".");
  if (labels.length < 2) throw invalidDomain(raw, "the hostname must contain a dot.");
  if (labels.some((label) => !DOMAIN_LABEL.test(label))) {
    throw invalidDomain(raw, "the hostname is not a valid DNS name.");
  }

  return wildcard ? `*.${value}` : value;
}

/**
 * Normalise the host allowlist that locks a region's deployment to the domains
 * that are allowed to serve it.
 *
 * Accepts an array or a newline/comma separated string, strips scheme, path and
 * port, lowercases, drops the trailing dot, dedupes, and rejects anything that is
 * not a bare hostname (or `*.sub.domain`). Empty input yields an empty list,
 * which `domain-lock.ts` treats as "not locked".
 */
export function normalizeAllowedDomains(
  input: string[] | string | null | undefined,
): string[] {
  if (input === null || input === undefined) return [];

  const entries = Array.isArray(input) ? input : [input];
  const tokens: string[] = [];

  for (const entry of entries) {
    if (typeof entry !== "string") {
      throw new RegionInputError("allowedDomains must be an array of hostnames.");
    }
    for (const piece of entry.split(/[\n,;]+/)) {
      const trimmed = piece.trim();
      if (trimmed) tokens.push(trimmed);
    }
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const token of tokens) {
    const domain = normalizeDomainToken(token);
    if (seen.has(domain)) continue;
    seen.add(domain);
    normalized.push(domain);
  }

  if (normalized.length > MAX_ALLOWED_DOMAINS) {
    throw new RegionInputError(
      `At most ${MAX_ALLOWED_DOMAINS} allowed domains can be configured (received ${normalized.length}).`,
    );
  }

  return normalized;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Read the Android client config out of a Firebase `google-services.json`.
 *
 * Only the four values the platform actually needs are extracted; the rest of the
 * file (OAuth client secrets in some downloads, project numbers, etc.) is dropped.
 * Mirrors the Firebase console download shape:
 * `project_info.project_id`, `client[0].client_info.mobilesdk_app_id`,
 * `client[0].client_info.android_client_info.package_name`, and
 * `client[0].api_key[0].current_key`.
 */
export function parseAndroidGoogleServices(
  jsonText: string,
  options: { packageName?: string | null } = {},
): AndroidGoogleServicesConfig {
  const text = String(jsonText ?? "").trim().replace(/^\uFEFF/, "");
  if (!text) throw new RegionInputError("google-services.json is empty.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RegionInputError(
      "google-services.json is not valid JSON. Paste the file exactly as downloaded from Firebase Console > Project settings > Your apps.",
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RegionInputError("google-services.json must contain a JSON object.");
  }

  const root = parsed as Record<string, unknown>;
  const projectInfo = root.project_info as Record<string, unknown> | undefined;
  const projectId = optionalNonEmptyString(projectInfo?.project_id);
  if (!projectId) {
    throw new RegionInputError(
      "google-services.json is missing project_info.project_id. It does not look like a Firebase config file.",
    );
  }

  const clientEntries = Array.isArray(root.client)
    ? (root.client as unknown[])
    : [];
  if (clientEntries.length === 0) {
    throw new RegionInputError(
      "google-services.json has no client entry. Re-download it after adding an Android app to the state's Firebase project.",
    );
  }

  // A project may host several Android apps (staging + production). When the
  // caller names the package we enrol that client, never "client[0]" by accident.
  const wantedPackage = options.packageName?.trim();
  const clientAtIndex = clientEntries[0] as Record<string, unknown> | undefined;
  let client: Record<string, unknown> | undefined = clientAtIndex;

  if (wantedPackage) {
    client = clientEntries.find((entry) => {
      const info = (entry as Record<string, unknown> | null)?.client_info as
        | Record<string, unknown>
        | undefined;
      const androidInfo = info?.android_client_info as Record<string, unknown> | undefined;
      return optionalNonEmptyString(androidInfo?.package_name) === wantedPackage;
    }) as Record<string, unknown> | undefined;

    if (!client) {
      const available = clientEntries
        .map((entry) => {
          const info = (entry as Record<string, unknown> | null)?.client_info as
            | Record<string, unknown>
            | undefined;
          const androidInfo = info?.android_client_info as Record<string, unknown> | undefined;
          return optionalNonEmptyString(androidInfo?.package_name);
        })
        .filter((value): value is string => Boolean(value));
      throw new RegionInputError(
        `google-services.json has no Android app for package "${wantedPackage}". It contains: ${
          available.length ? available.join(", ") : "no Android clients"
        }.`,
      );
    }
  }

  if (!client || typeof client !== "object") {
    throw new RegionInputError(
      "google-services.json has no usable client entry. Re-download it after adding an Android app to the state's Firebase project.",
    );
  }

  const clientInfo = client.client_info as Record<string, unknown> | undefined;
  if (!clientInfo || typeof clientInfo !== "object") {
    throw new RegionInputError("google-services.json is missing client[0].client_info.");
  }

  const appId = optionalNonEmptyString(clientInfo.mobilesdk_app_id);
  if (!appId) {
    throw new RegionInputError(
      "google-services.json is missing client[0].client_info.mobilesdk_app_id.",
    );
  }

  const androidClientInfo = clientInfo.android_client_info as
    | Record<string, unknown>
    | undefined;
  const packageName = optionalNonEmptyString(androidClientInfo?.package_name);
  if (!packageName) {
    throw new RegionInputError(
      "google-services.json is missing client[0].client_info.android_client_info.package_name.",
    );
  }

  const apiKeyEntry = Array.isArray(client.api_key)
    ? (client.api_key[0] as Record<string, unknown> | undefined)
    : undefined;
  const apiKey = optionalNonEmptyString(apiKeyEntry?.current_key);
  if (!apiKey) {
    throw new RegionInputError(
      "google-services.json is missing client[0].api_key[0].current_key.",
    );
  }

  return { projectId, appId, apiKey, packageName };
}

export function hasServiceAccountCredentials(
  input: Pick<RegionCredentialInput, "serviceAccountJson" | "serviceAccountBase64">,
): boolean {
  return Boolean(
    input.serviceAccountJson?.trim() || input.serviceAccountBase64?.trim(),
  );
}

/**
 * Read only the project id from a service-account key.
 *
 * The key itself stays in memory for the duration of the request; the returned
 * record is deliberately limited to the non-secret project identifier so callers
 * can compare it with the web config without handling credentials.
 */
export function readServiceAccountProject(
  credentials: Pick<RegionCredentialInput, "serviceAccountJson" | "serviceAccountBase64">,
): { projectId: string } {
  let account: admin.ServiceAccount;
  try {
    account = parseServiceAccount({
      firebaseProjectId: "",
      ...credentials,
    });
  } catch (error) {
    if (error instanceof RegionInputError) throw error;
    throw new RegionInputError(
      "Service account JSON could not be parsed. Paste the complete JSON key file for the state's Firebase project.",
    );
  }

  if (!account.projectId) {
    throw new RegionInputError("Service account JSON is missing project_id.");
  }
  if (!account.clientEmail) {
    throw new RegionInputError("Service account JSON is missing client_email.");
  }
  if (!account.privateKey) {
    throw new RegionInputError("Service account JSON is missing private_key.");
  }

  return { projectId: account.projectId };
}

/**
 * Defence in depth for responses and documents: drop anything that looks like a
 * credential even if a caller handed us a record that should not contain one.
 */
export function stripRegionSecrets<T extends object>(region: T): T {
  const copy = { ...region } as Record<string, unknown>;
  for (const field of REGION_SECRET_FIELDS) {
    delete copy[field];
  }
  return copy as T;
}

export function makeRegionRecord(
  input: {
    regionCode: string;
    regionName: string;
    regionAdminEmail?: string | null;
    /** True when the caller is enrolling with a state-owned service account. */
    hasServiceAccount?: boolean;
  } & RegionWebConfigInput,
): RegionRecord {
  const regionCode = normalizeRegionCode(input.regionCode);
  const regionName = input.regionName?.trim() ?? "";
  const firebaseProjectId = input.firebaseProjectId?.trim() ?? "";

  if (!regionCode) throw new RegionInputError("regionCode is required.");
  if (!regionName) throw new RegionInputError("regionName is required.");
  if (!firebaseProjectId) throw new RegionInputError("firebaseProjectId is required.");

  const onboardingMode: RegionOnboardingMode = input.onboardingMode
    ? input.onboardingMode
    : input.hasServiceAccount
      ? "byo_firebase"
      : "automated";

  if (onboardingMode !== "byo_firebase" && onboardingMode !== "automated") {
    throw new RegionInputError(
      'onboardingMode must be "byo_firebase" or "automated".',
    );
  }

  return {
    id: regionCode,
    regionCode,
    regionName,
    regionAdminEmail: input.regionAdminEmail?.trim() || null,
    firebaseProjectId,
    firebaseApiKey: input.firebaseApiKey?.trim() || null,
    firebaseWebAppId: input.firebaseWebAppId?.trim() || null,
    storageBucket: input.storageBucket?.trim() || null,
    authDomain: input.authDomain?.trim() || null,
    messagingSenderId: input.messagingSenderId?.trim() || null,
    measurementId: input.measurementId?.trim() || null,
    androidAppId: input.androidAppId?.trim() || null,
    androidApiKey: input.androidApiKey?.trim() || null,
    androidPackageName: input.androidPackageName?.trim() || null,
    allowedDomains: normalizeAllowedDomains(input.allowedDomains),
    onboardingMode,
    status: "config_pending",
    appMode: "regional",
    onboardingChecklist: { ...DEFAULT_REGION_CHECKLIST },
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
        // The Storage emulator does not implement bucket metadata (404/501).
        // Treat that as verified only when the emulator host is explicitly
        // configured, so real deployments still fail closed on a bad bucket.
        const emulator = Boolean(process.env.FIREBASE_STORAGE_EMULATOR_HOST);
        if (emulator) {
          // The Storage emulator does not implement bucket management at all,
          // so any metadata failure here is an emulator limitation rather than
          // evidence about the bucket. Real deployments still fail closed.
          checks.storageReachable = true;
          messages.push(
            "Cloud Storage bucket check skipped: the Storage emulator does not implement bucket metadata.",
          );
        } else {
          messages.push(explainValidationFailure("storage", error));
        }
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

    const systemConfigRef = db.collection("systemConfig").doc("runtime");
    const enrollmentConfigRef = db.collection("enrollmentFormConfig").doc("global");
    const setupProgressRef = db.collection("regionSetupProgress").doc("default");

    batch.set(
      systemConfigRef,
      {
        appMode: "regional",
        regionCode: region.regionCode,
        regionName: region.regionName,
        firebaseProjectId: region.firebaseProjectId,
        seededAt: new Date(),
        onboardingReady: true,
        setupComplete: false,
        setupCompletedAt: null,
        ...buildServerCreateAudit(actor),
      },
      { merge: true },
    );

    batch.set(
      enrollmentConfigRef,
      {
        ...DEFAULT_ENROLLMENT_FORM_CONFIG,
        regionCode: region.regionCode,
        regionName: region.regionName,
        ...buildServerCreateAudit(actor),
      },
      { merge: true },
    );

    batch.set(
      setupProgressRef,
      {
        ...DEFAULT_SETUP_PROGRESS,
        regionCode: region.regionCode,
        regionName: region.regionName,
        ...buildServerCreateAudit(actor),
      },
      { merge: true },
    );

    await batch.commit();

    return {
      seededDocs: [...REGION_DEFAULT_SEEDED_DOCS],
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
        emailVerified: true,
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
