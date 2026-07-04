import fs from "fs/promises";
import path from "path";

const FIREBASE_MANAGEMENT_BASE = "https://firebase.googleapis.com/v1beta1";
const RESOURCE_MANAGER_BASE = "https://cloudresourcemanager.googleapis.com/v1";
const SERVICE_USAGE_BASE = "https://serviceusage.googleapis.com/v1";
const IAM_BASE = "https://iam.googleapis.com/v1";
const FIRESTORE_ADMIN_BASE = "https://firestore.googleapis.com/v1";
const IDENTITY_TOOLKIT_ADMIN_BASE = "https://identitytoolkit.googleapis.com/admin/v2";
const IDENTITY_PLATFORM_BASE = "https://identityplatform.googleapis.com/v1";

type GoogleApiOptions = RequestInit & {
  acceptStatuses?: number[];
};

type FirebaseAppConfig = Record<string, string | undefined>;

async function getAccessToken(): Promise<string> {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/firebase",
    ],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token?.token) {
    throw new Error(
      "Failed to get OAuth2 access token. Ensure the HQ service account has Google Cloud and Firebase permissions.",
    );
  }
  return token.token;
}

async function parseResponse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function googleApiRequest(url: string, options: GoogleApiOptions = {}): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await parseResponse(res);
  if (!res.ok && !options.acceptStatuses?.includes(res.status)) {
    const message = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error(`Google API error (${res.status}): ${message}`);
  }
  return data;
}

async function pollOperation(
  operationName: string,
  fallbackBaseUrl: string,
  maxRetries = 60,
): Promise<any> {
  const operationUrl = operationName.startsWith("http")
    ? operationName
    : `${fallbackBaseUrl}/${operationName.replace(/^\//, "")}`;

  for (let i = 0; i < maxRetries; i++) {
    const result = await googleApiRequest(operationUrl);
    if (result?.done) {
      if (result.error) throw new Error(`Operation failed: ${result.error.message}`);
      return result.response || result;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Operation ${operationName} did not complete within ${maxRetries * 2}s.`);
}

function isNotFoundResponse(data: any) {
  return data?.error?.code === 404 || data?.error?.status === "NOT_FOUND";
}

function normalizeStorageBucket(projectId: string, value?: string | null) {
  if (value) return value;
  return `${projectId}.appspot.com`;
}

export async function createGcpProject(projectId: string, displayName: string): Promise<{ projectId: string; projectNumber: string; created: boolean }> {
  const existing = await googleApiRequest(`${RESOURCE_MANAGER_BASE}/projects/${projectId}`, {
    acceptStatuses: [404],
  });

  if (existing && !isNotFoundResponse(existing)) {
    return { projectId, projectNumber: String(existing.projectNumber || ""), created: false };
  }

  const result = await googleApiRequest(`${RESOURCE_MANAGER_BASE}/projects`, {
    method: "POST",
    body: JSON.stringify({ projectId, name: displayName }),
  });
  const project = result?.name ? await pollOperation(result.name, RESOURCE_MANAGER_BASE) : result;
  return {
    projectId,
    projectNumber: String(project?.projectNumber || result?.projectNumber || ""),
    created: true,
  };
}

export async function getAvailableProjects(): Promise<string[]> {
  const result = await googleApiRequest(`${FIREBASE_MANAGEMENT_BASE}/availableProjects`);
  return (result?.projectInfo || []).map((p: any) => p.project).filter(Boolean);
}

export async function enableRequiredApis(projectId: string): Promise<{ enabledApis: string[] }> {
  const apis = [
    "cloudresourcemanager.googleapis.com",
    "firebase.googleapis.com",
    "firebaserules.googleapis.com",
    "firebasestorage.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "identitytoolkit.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ];

  const result = await googleApiRequest(`${SERVICE_USAGE_BASE}/projects/${projectId}/services:batchEnable`, {
    method: "POST",
    body: JSON.stringify({ serviceIds: apis }),
  });
  if (result?.name) await pollOperation(result.name, SERVICE_USAGE_BASE);
  return { enabledApis: apis };
}

export async function addFirebaseToProject(projectId: string): Promise<{ projectId: string; alreadyConfigured: boolean }> {
  const existing = await googleApiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}`, {
    acceptStatuses: [404],
  });
  if (existing && !isNotFoundResponse(existing)) {
    return { projectId, alreadyConfigured: true };
  }

  const result = await googleApiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}:addFirebase`, {
    method: "POST",
    body: "{}",
  });
  if (result?.name) await pollOperation(result.name, FIREBASE_MANAGEMENT_BASE);
  return { projectId, alreadyConfigured: false };
}

export async function provisionFirestore(projectId: string, locationId = process.env.REGION_FIRESTORE_LOCATION || "asia-south1"): Promise<{ locationId: string; created: boolean }> {
  const dbPath = `${FIRESTORE_ADMIN_BASE}/projects/${projectId}/databases/(default)`;
  const existing = await googleApiRequest(dbPath, { acceptStatuses: [404] });
  if (existing && !isNotFoundResponse(existing)) {
    return { locationId: existing.locationId || locationId, created: false };
  }

  const result = await googleApiRequest(`${FIRESTORE_ADMIN_BASE}/projects/${projectId}/databases?databaseId=(default)`, {
    method: "POST",
    body: JSON.stringify({
      type: "FIRESTORE_NATIVE",
      locationId,
      concurrencyMode: "OPTIMISTIC",
    }),
  });
  if (result?.name) await pollOperation(result.name, FIRESTORE_ADMIN_BASE);
  return { locationId, created: true };
}

export async function enableIdentityPlatform(projectId: string): Promise<{ emailPasswordEnabled: boolean }> {
  const current = await googleApiRequest(`${IDENTITY_TOOLKIT_ADMIN_BASE}/projects/${projectId}/config`, {
    acceptStatuses: [404],
  });

  if (isNotFoundResponse(current)) {
    await googleApiRequest(`${IDENTITY_PLATFORM_BASE}/projects/${projectId}/identityPlatform:initializeAuth`, {
      method: "POST",
      body: "{}",
      acceptStatuses: [409],
    });
  }

  await googleApiRequest(
    `${IDENTITY_TOOLKIT_ADMIN_BASE}/projects/${projectId}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`,
    {
      method: "PATCH",
      body: JSON.stringify({
        signIn: {
          email: {
            enabled: true,
            passwordRequired: true,
          },
        },
      }),
    },
  );

  return { emailPasswordEnabled: true };
}

async function listApps(projectId: string, appType: "androidApps" | "webApps"): Promise<any[]> {
  const result = await googleApiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}/${appType}`);
  return result?.apps || [];
}

export async function createAndroidApp(projectId: string, displayName: string, packageName: string): Promise<{ appId: string; created: boolean }> {
  const existing = (await listApps(projectId, "androidApps")).find(
    (app) => app.packageName === packageName || app.displayName === displayName,
  );
  if (existing?.appId) return { appId: existing.appId, created: false };

  const result = await googleApiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}/androidApps`, {
    method: "POST",
    body: JSON.stringify({ displayName, packageName }),
  });
  const app = result?.name ? await pollOperation(result.name, FIREBASE_MANAGEMENT_BASE) : result;
  const appId = app?.appId || app?.name?.split("/").pop();
  if (!appId) throw new Error("Firebase Android app was created, but no appId was returned.");
  return { appId, created: true };
}

export async function createWebApp(projectId: string, displayName: string): Promise<{ appId: string; created: boolean }> {
  const existing = (await listApps(projectId, "webApps")).find((app) => app.displayName === displayName);
  if (existing?.appId) return { appId: existing.appId, created: false };

  const result = await googleApiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}/webApps`, {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
  const app = result?.name ? await pollOperation(result.name, FIREBASE_MANAGEMENT_BASE) : result;
  const appId = app?.appId || app?.name?.split("/").pop();
  if (!appId) throw new Error("Firebase Web app was created, but no appId was returned.");
  return { appId, created: true };
}

export async function getAndroidAppConfig(projectId: string, appId: string): Promise<FirebaseAppConfig> {
  const config = await googleApiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}/androidApps/${appId}/config`);
  if (config?.configFileContents) {
    const decoded = Buffer.from(config.configFileContents, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    const client = parsed.client?.[0] || {};
    return {
      apiKey: client.api_key?.[0]?.current_key,
      appId: client.client_info?.mobilesdk_app_id,
      projectId: parsed.project_info?.project_id || projectId,
      messagingSenderId: parsed.project_info?.project_number,
      storageBucket: parsed.project_info?.storage_bucket,
    };
  }

  return config || {};
}

export async function getWebAppConfig(projectId: string, appId: string): Promise<FirebaseAppConfig> {
  const config = await googleApiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}/webApps/${appId}/config`);
  return config || {};
}

export async function getAdminSdkConfig(projectId: string): Promise<Record<string, string>> {
  const config = await googleApiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}/adminSdkConfig`);
  return config as Record<string, string>;
}

async function getIamPolicy(projectId: string): Promise<any> {
  return googleApiRequest(`${RESOURCE_MANAGER_BASE}/projects/${projectId}:getIamPolicy`, {
    method: "POST",
    body: "{}",
  });
}

async function setIamPolicy(projectId: string, policy: any): Promise<void> {
  await googleApiRequest(`${RESOURCE_MANAGER_BASE}/projects/${projectId}:setIamPolicy`, {
    method: "POST",
    body: JSON.stringify({ policy }),
  });
}

async function ensureProjectRoles(projectId: string, member: string, roles: string[]): Promise<void> {
  const policy = await getIamPolicy(projectId);
  policy.bindings = Array.isArray(policy.bindings) ? policy.bindings : [];

  let changed = false;
  for (const role of roles) {
    let binding = policy.bindings.find((candidate: any) => candidate.role === role);
    if (!binding) {
      binding = { role, members: [] };
      policy.bindings.push(binding);
    }
    if (!binding.members.includes(member)) {
      binding.members.push(member);
      changed = true;
    }
  }

  if (changed) await setIamPolicy(projectId, policy);
}

export async function createServiceAccountKey(projectId: string): Promise<{ privateKeyData: string; serviceAccountEmail: string; serviceAccountJson: string }> {
  const accountId = "ciss-region-admin";
  const serviceAccountEmail = `${accountId}@${projectId}.iam.gserviceaccount.com`;
  const encodedEmail = encodeURIComponent(serviceAccountEmail);

  const existing = await googleApiRequest(`${IAM_BASE}/projects/${projectId}/serviceAccounts/${encodedEmail}`, {
    acceptStatuses: [404],
  });

  if (isNotFoundResponse(existing)) {
    await googleApiRequest(`${IAM_BASE}/projects/${projectId}/serviceAccounts`, {
      method: "POST",
      body: JSON.stringify({
        accountId,
        serviceAccount: {
          displayName: "CISS Regional Admin",
          description: "Service account used by CISS HQ automation for this regional Firebase project.",
        },
      }),
    });
  }

  await ensureProjectRoles(projectId, `serviceAccount:${serviceAccountEmail}`, [
    "roles/datastore.owner",
    "roles/firebaseauth.admin",
    "roles/firebaserules.admin",
    "roles/storage.admin",
  ]);

  const result = await googleApiRequest(`${IAM_BASE}/projects/${projectId}/serviceAccounts/${encodedEmail}/keys`, {
    method: "POST",
    body: JSON.stringify({
      keyAlgorithm: "KEY_ALG_RSA_2048",
      privateKeyType: "TYPE_GOOGLE_CREDENTIALS_FILE",
    }),
  });

  const privateKeyData = result?.privateKeyData || "";
  if (!privateKeyData) throw new Error("IAM did not return service account privateKeyData.");
  const serviceAccountJson = Buffer.from(privateKeyData, "base64").toString("utf8");
  JSON.parse(serviceAccountJson);

  return { privateKeyData, serviceAccountEmail, serviceAccountJson };
}

export async function listFirestoreIndexes(projectId: string): Promise<{ name: string; state: string; collectionGroup?: string; fields?: any[] }[]> {
  const result = await googleApiRequest(`${FIRESTORE_ADMIN_BASE}/projects/${projectId}/databases/(default)/collectionGroups/-/indexes`);
  return (result?.indexes || []).map((idx: any) => ({
    name: idx.name,
    state: idx.state,
    collectionGroup: idx.name?.split("/collectionGroups/")?.[1]?.split("/")?.[0],
    fields: idx.fields || [],
  }));
}

export async function deployFirestoreRules(projectId: string, rulesSource: string, serviceAccountJson?: string): Promise<void> {
  const adminModule = await import("firebase-admin");
  const appName = `rules-deploy-${projectId}-${Date.now()}`;
  const credential = serviceAccountJson
    ? adminModule.credential.cert(JSON.parse(serviceAccountJson))
    : adminModule.credential.applicationDefault();

  const app = adminModule.initializeApp({ projectId, credential }, appName);
  try {
    await app.securityRules().releaseFirestoreRulesetFromSource(rulesSource);
  } finally {
    await app.delete().catch(() => {});
  }
}

export async function deployStorageRules(projectId: string, rulesSource: string, serviceAccountJson?: string): Promise<void> {
  const adminModule = await import("firebase-admin");
  const appName = `storage-rules-deploy-${projectId}-${Date.now()}`;
  const credential = serviceAccountJson
    ? adminModule.credential.cert(JSON.parse(serviceAccountJson))
    : adminModule.credential.applicationDefault();

  const app = adminModule.initializeApp({ projectId, credential }, appName);
  try {
    await app.securityRules().releaseStorageRulesetFromSource(rulesSource);
  } finally {
    await app.delete().catch(() => {});
  }
}

function indexSignature(index: { collectionGroup: string; queryScope?: string; fields: any[] }) {
  return JSON.stringify({
    collectionGroup: index.collectionGroup,
    queryScope: index.queryScope || "COLLECTION",
    fields: index.fields.map((field) => ({
      fieldPath: field.fieldPath,
      order: field.order || null,
      arrayConfig: field.arrayConfig || null,
    })),
  });
}

export async function deployFirestoreIndexes(projectId: string, indexesFile = path.join(process.cwd(), "firestore.indexes.json")): Promise<{ created: number; existing: number }> {
  const raw = await fs.readFile(indexesFile, "utf8");
  const definition = JSON.parse(raw) as { indexes?: Array<{ collectionGroup: string; queryScope?: string; fields: any[] }> };
  const desired = definition.indexes || [];
  const existing = await listFirestoreIndexes(projectId);
  const existingSignatures = new Set(
    existing
      .filter((idx) => idx.collectionGroup && idx.fields)
      .map((idx) => indexSignature({
        collectionGroup: idx.collectionGroup || "",
        queryScope: "COLLECTION",
        fields: idx.fields || [],
      })),
  );

  let created = 0;
  let alreadyPresent = 0;
  for (const index of desired) {
    if (existingSignatures.has(indexSignature(index))) {
      alreadyPresent += 1;
      continue;
    }

    const fields = index.fields.map((field) => ({
      fieldPath: field.fieldPath,
      ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : { order: field.order }),
    }));
    const result = await googleApiRequest(
      `${FIRESTORE_ADMIN_BASE}/projects/${projectId}/databases/(default)/collectionGroups/${encodeURIComponent(index.collectionGroup)}/indexes`,
      {
        method: "POST",
        body: JSON.stringify({
          queryScope: index.queryScope || "COLLECTION",
          fields,
        }),
      },
    );
    if (result?.name) await pollOperation(result.name, FIRESTORE_ADMIN_BASE, 5).catch(() => {});
    created += 1;
  }

  return { created, existing: alreadyPresent };
}

export function buildDefaultStorageBucket(projectId: string) {
  return normalizeStorageBucket(projectId);
}
