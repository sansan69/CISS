const FIREBASE_MANAGEMENT_BASE = "https://firebase.googleapis.com/v1beta1";
const RESOURCE_MANAGER_BASE = "https://cloudresourcemanager.googleapis.com/v1";
const SERVICE_USAGE_BASE = "https://serviceusage.googleapis.com/v1";
const IAM_BASE = "https://iam.googleapis.com/v1";
const FIRESTORE_ADMIN_BASE = "https://firestore.googleapis.com/v1";
const IDENTITY_TOOLKIT_BASE = "https://identitytoolkit.googleapis.com/v1";

async function getAccessToken(): Promise<string> {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/firebase"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token?.token) throw new Error("Failed to get OAuth2 access token. Ensure the HQ service account has the required permissions.");
  return token.token;
}

async function apiRequest(url: string, options: RequestInit = {}): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 409 && message.toLowerCase().includes("already exists")) {
      return { alreadyExists: true, message };
    }
    throw new Error(`Firebase Management API error: ${message}`);
  }
  return data;
}

async function pollOperation(operationName: string, maxRetries = 30): Promise<any> {
  const baseUrl = operationName.startsWith("http") ? "" : "https://firebase.googleapis.com/v1";
  for (let i = 0; i < maxRetries; i++) {
    const result = await apiRequest(`${baseUrl}/${operationName}`);
    if (result.done) {
      if (result.error) throw new Error(`Operation failed: ${result.error.message}`);
      return result.response || result;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Operation ${operationName} did not complete within ${maxRetries * 2}s`);
}

export async function createGcpProject(projectId: string, displayName: string): Promise<{ projectId: string; projectNumber: string }> {
  const result = await apiRequest(`${RESOURCE_MANAGER_BASE}/projects`, {
    method: "POST",
    body: JSON.stringify({ projectId, name: displayName }),
  });
  return { projectId, projectNumber: result.projectNumber || "" };
}

export async function getAvailableProjects(): Promise<string[]> {
  const result = await apiRequest(`${FIREBASE_MANAGEMENT_BASE}/availableProjects`);
  return (result.projectInfo || []).map((p: any) => p.project);
}

export async function addFirebaseToProject(projectId: string): Promise<any> {
  const result = await apiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}:addFirebase`, {
    method: "POST",
    body: "{}",
  });
  return pollOperation(result.name);
}

export async function enableRequiredApis(projectId: string): Promise<void> {
  const apis = [
    "firestore.googleapis.com",
    "firebaserules.googleapis.com",
    "identitytoolkit.googleapis.com",
    "storage.googleapis.com",
    "firebasestorage.googleapis.com",
    "firebase.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ];
  await apiRequest(`${SERVICE_USAGE_BASE}/projects/${projectId}/services:batchEnable`, {
    method: "POST",
    body: JSON.stringify({ serviceIds: apis.map((a) => `projects/${projectId}/services/${a}`) }),
  });
}

export async function provisionFirestore(projectId: string, locationId = "nam5"): Promise<any> {
  const result = await apiRequest(`${FIRESTORE_ADMIN_BASE}/projects/${projectId}/databases?databaseId=(default)`, {
    method: "POST",
    body: JSON.stringify({
      type: "FIRESTORE_NATIVE",
      locationId,
      concurrencyMode: "OPTIMISTIC",
    }),
  });
  return pollOperation(result.name);
}

export async function enableIdentityPlatform(projectId: string): Promise<any> {
  const result = await apiRequest(
    `https://identityplatform.googleapis.com/v1/projects/${projectId}/identityPlatform:initializeAuth`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return result;
}

export async function createAndroidApp(projectId: string, displayName: string, packageName: string): Promise<{ appId: string; apiKey: string }> {
  const result = await apiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}/androidApps`, {
    method: "POST",
    body: JSON.stringify({ displayName, packageName }),
  });
  const app = await pollOperation(result.name);
  return { appId: (app as any)?.appId || (app as any)?.name?.split("/").pop() || "", apiKey: "" };
}

export async function createWebApp(projectId: string, displayName: string): Promise<{ appId: string; apiKey: string }> {
  const result = await apiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}/webApps`, {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
  const app = await pollOperation(result.name);
  return { appId: (app as any)?.appId || (app as any)?.name?.split("/").pop() || "", apiKey: "" };
}

export async function getAndroidAppConfig(projectId: string, appId: string): Promise<Record<string, string>> {
  const config = await apiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}/androidApps/${appId}/config`);
  return config as Record<string, string>;
}

export async function getWebAppConfig(projectId: string, appId: string): Promise<Record<string, string>> {
  const config = await apiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}/webApps/${appId}/config`);
  return config as Record<string, string>;
}

export async function getAdminSdkConfig(projectId: string): Promise<Record<string, string>> {
  const config = await apiRequest(`${FIREBASE_MANAGEMENT_BASE}/projects/${projectId}/adminSdkConfig`);
  return config as Record<string, string>;
}

export async function createServiceAccountKey(projectId: string): Promise<{ privateKeyData: string; serviceAccountEmail: string }> {
  const email = `firebase-adminsdk-${projectId.slice(-5).replace(/[^a-z0-9]/g, "")}@${projectId}.iam.gserviceaccount.com`;
  try {
    const result = await apiRequest(`${IAM_BASE}/projects/${projectId}/serviceAccounts/${email}/keys`, {
      method: "POST",
      body: JSON.stringify({ keyAlgorithm: "KEY_ALG_RSA_2048", privateKeyType: "TYPE_GOOGLE_CREDENTIALS_FILE" }),
    });
    return {
      privateKeyData: result.privateKeyData || "",
      serviceAccountEmail: email,
    };
  } catch {
    return { privateKeyData: "", serviceAccountEmail: email };
  }
}

export async function listFirestoreIndexes(projectId: string): Promise<{ name: string; state: string }[]> {
  const result = await apiRequest(`${FIRESTORE_ADMIN_BASE}/projects/${projectId}/databases/(default)/collectionGroups/-/indexes`);
  return (result.indexes || []).map((idx: any) => ({ name: idx.name, state: idx.state }));
}

export async function deployFirestoreRules(projectId: string, rulesSource: string): Promise<void> {
  const adminModule = await import("firebase-admin");
  const appName = `rules-deploy-${projectId}-${Date.now()}`;
  const existingApps = (adminModule.apps || []).filter((a): a is NonNullable<typeof a> => a?.name === appName);
  for (const app of existingApps) { await app.delete().catch(() => {}); }
  const app = adminModule.initializeApp({ projectId, credential: adminModule.credential.applicationDefault() }, appName);
  try {
    await app.securityRules().releaseFirestoreRulesetFromSource(rulesSource);
  } finally {
    await app.delete().catch(() => {});
  }
}
