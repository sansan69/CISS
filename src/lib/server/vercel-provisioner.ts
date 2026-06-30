import type { RegionRecord } from "@/types/region";

const VERCEL_API_BASE = "https://api.vercel.com";

function getVercelToken(): string {
  const token = process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN;
  if (!token) throw new Error("VERCEL_TOKEN is not configured.");
  return token;
}

function getTeamSlug(): string {
  return process.env.VERCEL_REGION_TEAM_SLUG || "sansan69s-projects";
}

async function vercelApi(endpoint: string, options: RequestInit = {}): Promise<any> {
  const url = `${VERCEL_API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${getVercelToken()}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Vercel API error: ${data.error?.message || res.statusText}`);
  return data;
}

function buildProjectName(region: RegionRecord): string {
  const slug = region.regionName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `ciss-${slug || region.regionCode.toLowerCase()}`.slice(0, 80);
}

export async function buildRegionEnvConfig(region: RegionRecord): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    APP_MODE: "regional",
    NEXT_PUBLIC_APP_MODE: "regional",
    REGION_CODE: region.regionCode,
    NEXT_PUBLIC_REGION_CODE: region.regionCode,
    REGION_NAME: region.regionName,
    NEXT_PUBLIC_REGION_NAME: region.regionName,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: region.firebaseProjectId,
  };

  if (region.firebaseApiKey) env.NEXT_PUBLIC_FIREBASE_API_KEY = region.firebaseApiKey;
  if (region.firebaseWebAppId) env.NEXT_PUBLIC_FIREBASE_APP_ID = region.firebaseWebAppId;
  if (region.storageBucket) env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = region.storageBucket;
  if (region.authDomain) env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = region.authDomain;
  if (region.messagingSenderId) env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = region.messagingSenderId;
  if (region.measurementId) env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID = region.measurementId;
  if (region.androidAppId) env.NEXT_PUBLIC_FIREBASE_ANDROID_APP_ID = region.androidAppId;
  if (region.androidApiKey) env.NEXT_PUBLIC_FIREBASE_ANDROID_API_KEY = region.androidApiKey;

  return env;
}

export async function ensureVercelProject(region: RegionRecord): Promise<{
  projectName: string;
  projectUrl: string;
  productionUrl: string;
  alreadyExisted: boolean;
}> {
  const projectName = buildProjectName(region);

  let alreadyExisted = false;
  let project;
  try {
    project = await vercelApi(`/v9/projects/${projectName}`);
    alreadyExisted = true;
  } catch {
    project = await vercelApi("/v10/projects", {
      method: "POST",
      body: JSON.stringify({ name: projectName, framework: "nextjs" }),
    });
  }

  return {
    projectName: project.name || projectName,
    projectUrl: `https://vercel.com/${getTeamSlug()}/${project.name || projectName}`,
    productionUrl: `https://${project.name || projectName}.vercel.app`,
    alreadyExisted,
  };
}

export async function setVercelEnvVars(projectName: string, envVars: Record<string, string>, target = "production"): Promise<void> {
  for (const [key, value] of Object.entries(envVars)) {
    if (!value) continue;
    await vercelApi(`/v10/projects/${projectName}/env`, {
      method: "POST",
      body: JSON.stringify({
        type: "encrypted",
        key,
        value,
        target: [target],
      }),
    });
  }
}

export async function deployRegionProject(projectName: string): Promise<{ url: string; alias: string[] }> {
  const deploy = await vercelApi(`/v13/deployments`, {
    method: "POST",
    body: JSON.stringify({
      name: projectName,
      project: projectName,
      target: "production",
      withLatestCommit: true,
    }),
  });
  return { url: deploy.url || "", alias: deploy.alias || [] };
}

export async function getVercelProjectHealth(projectName: string): Promise<{
  exists: boolean;
  lastDeploymentUrl: string | null;
  lastDeploymentCreatedAt: string | null;
  envCount: number;
}> {
  try {
    const project = await vercelApi(`/v9/projects/${projectName}`);
    const lastDeploy = await vercelApi(`/v6/deployments?projectId=${project.id}&limit=1&target=production`);
    const deployment = lastDeploy.deployments?.[0];
    return {
      exists: true,
      lastDeploymentUrl: deployment?.url || null,
      lastDeploymentCreatedAt: deployment?.createdAt || null,
      envCount: (await vercelApi(`/v10/projects/${projectName}/env?limit=100`)).envs?.length || 0,
    };
  } catch {
    return { exists: false, lastDeploymentUrl: null, lastDeploymentCreatedAt: null, envCount: 0 };
  }
}

export async function addVercelDomain(projectName: string, domain: string): Promise<void> {
  await vercelApi(`/v10/projects/${projectName}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
}

export function buildVercelProjectUrl(projectName: string): string {
  return `https://vercel.com/${getTeamSlug()}/${projectName}`;
}

export function buildVercelProductionUrl(projectName: string): string {
  return `https://${projectName}.vercel.app`;
}
