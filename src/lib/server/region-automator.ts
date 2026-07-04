import crypto from "crypto";
import type { Firestore } from "firebase-admin/firestore";

import {
  addFirebaseToProject,
  createAndroidApp,
  createGcpProject,
  createServiceAccountKey,
  createWebApp,
  deployFirestoreIndexes,
  deployFirestoreRules,
  deployStorageRules,
  enableIdentityPlatform,
  enableRequiredApis,
  getAndroidAppConfig,
  getWebAppConfig,
  provisionFirestore,
  buildDefaultStorageBucket,
} from "@/lib/server/firebase-management-client";
import {
  buildServerAuditEvent,
  buildServerUpdateAudit,
} from "@/lib/server/audit";
import {
  createRegionAdminAccount,
  seedRegionDefaults,
  validateRegionFirebaseConnection,
} from "@/lib/server/region-onboarding";
import { getRegionConnection, saveRegionConnection } from "@/lib/server/region-connections";
import {
  buildRegionEnvConfig,
  deployRegionProject,
  ensureVercelProject,
  getVercelProjectHealth,
  setVercelEnvVars,
} from "@/lib/server/vercel-provisioner";
import type {
  AutomationJob,
  AutomationStepId,
  AutomationStepResult,
  PreflightSummary,
  RegionRecord,
} from "@/types/region";

const AUTOMATION_COLLECTION = "automationJobs";
const CONCURRENT_LOCK_KEY = "region_automation_lock";
const CONCURRENT_LOCK_TTL_MS = 30 * 60 * 1000;
const STALE_RUNNING_JOB_MS = 15 * 60 * 1000;

type AutomationContext = {
  db: Firestore;
  region: RegionRecord;
  serviceAccountJson: string | null;
  actor?: { uid?: string | null; email?: string | null };
};

function now() {
  return new Date().toISOString();
}

function elapsedMs(startedAt: string): number {
  return Date.now() - new Date(startedAt).getTime();
}

export const AUTOMATION_STEPS: { stepId: AutomationStepId; label: string }[] = [
  { stepId: "preflight", label: "Preflight checks" },
  { stepId: "create_gcp_project", label: "Create GCP project" },
  { stepId: "enable_apis", label: "Enable required APIs" },
  { stepId: "add_firebase", label: "Add Firebase to project" },
  { stepId: "provision_firestore", label: "Provision Firestore database" },
  { stepId: "enable_auth", label: "Enable Authentication" },
  { stepId: "create_apps", label: "Create Android + Web apps" },
  { stepId: "collect_sdk_configs", label: "Collect SDK configurations" },
  { stepId: "generate_service_account", label: "Generate service account" },
  { stepId: "deploy_rules", label: "Deploy security rules & indexes" },
  { stepId: "seed_defaults", label: "Seed default configurations" },
  { stepId: "create_admin", label: "Create region admin account" },
  { stepId: "provision_vercel", label: "Provision Vercel project & deploy" },
  { stepId: "verify_ready", label: "Verify region readiness" },
];

function makePendingStepResult(stepId: AutomationStepId): AutomationStepResult {
  return { stepId, status: "pending", startedAt: now() };
}

function makeStepResult(stepId: AutomationStepId): AutomationStepResult {
  return { stepId, status: "running", startedAt: now() };
}

function completeStep(
  step: AutomationStepResult,
  result?: Record<string, unknown>,
): AutomationStepResult {
  return { ...step, status: "completed", completedAt: now(), elapsedMs: elapsedMs(step.startedAt), result };
}

function failStep(step: AutomationStepResult, error: string): AutomationStepResult {
  return { ...step, status: "failed", completedAt: now(), elapsedMs: elapsedMs(step.startedAt), error };
}

async function acquireLock(adminDb: Firestore): Promise<boolean> {
  try {
    const lockRef = adminDb.collection("systemConfig").doc(CONCURRENT_LOCK_KEY);
    const now = Date.now();
    const existing = await lockRef.get();
    if (existing.exists) {
      const data = existing.data() as { lockedAt: number } | undefined;
      if (data && now - data.lockedAt < CONCURRENT_LOCK_TTL_MS) {
        return false;
      }
    }
    await lockRef.set({ lockedAt: now, lockedBy: "automator" }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

async function releaseLock(adminDb: Firestore): Promise<void> {
  try {
    await adminDb.collection("systemConfig").doc(CONCURRENT_LOCK_KEY).delete();
  } catch {
    // Non-critical
  }
}

function findCurrentStep(job: AutomationJob): number {
  for (let i = 0; i < job.steps.length; i++) {
    if (job.steps[i].status === "running") return i;
  }
  return job.currentStepIndex;
}

export async function startAutomation(
  db: Firestore,
  region: RegionRecord,
  _serviceAccountJson: string | null,
  actor?: { uid?: string | null; email?: string | null },
): Promise<AutomationJob> {
  const jobId = crypto.randomUUID();
  const timestamp = now();
  const steps = AUTOMATION_STEPS.map((s) => makePendingStepResult(s.stepId));

  const job: AutomationJob = {
    id: jobId,
    regionCode: region.regionCode,
    status: "queued",
    startedAt: timestamp,
    queuedAt: timestamp,
    currentStepIndex: 0,
    steps,
  };

  await db.collection(AUTOMATION_COLLECTION).doc(jobId).set({
    ...job,
    auditTrail: [buildServerAuditEvent("automation_queued", actor, { regionCode: region.regionCode })],
  });

  return job;
}

async function runClaimedJob(
  db: Firestore,
  jobId: string,
  region: RegionRecord,
  serviceAccountJson: string | null,
  actor?: { uid?: string | null; email?: string | null },
  startStepIndex = 0,
): Promise<void> {
  const lockAcquired = await acquireLock(db);
  if (!lockAcquired) {
    const jobDoc = db.collection(AUTOMATION_COLLECTION).doc(jobId);
    await jobDoc.update({
      status: "queued",
      error: "Another automation job is already in progress. This job has been returned to the queue.",
      queuedAt: now(),
    });
    return;
  }

  try {
    await executeSteps(db, jobId, region, serviceAccountJson, actor, startStepIndex);
  } finally {
    await releaseLock(db);
  }
}

async function executeSteps(
  db: Firestore,
  jobId: string,
  region: RegionRecord,
  serviceAccountJson: string | null,
  actor?: { uid?: string | null; email?: string | null },
  startStepIndex = 0,
): Promise<void> {
  const jobRef = db.collection(AUTOMATION_COLLECTION).doc(jobId);
  const context: AutomationContext = { db, region, serviceAccountJson, actor };

  for (let i = startStepIndex; i < AUTOMATION_STEPS.length; i++) {
    const stepDef = AUTOMATION_STEPS[i];

    await jobRef.update({
      currentStepIndex: i,
      [`steps.${i}.status`]: "running",
      [`steps.${i}.startedAt`]: now(),
    });

    try {
      const result = await executeStep(
        stepDef.stepId,
        context,
      );

      await jobRef.update({
        [`steps.${i}.status`]: result.status,
        [`steps.${i}.completedAt`]: result.completedAt,
        [`steps.${i}.elapsedMs`]: result.elapsedMs,
        [`steps.${i}.error`]: result.error || null,
        [`steps.${i}.result`]: result.result || null,
      });

      if (result.status === "failed") {
        await jobRef.update({
          status: "failed",
          error: `Step ${stepDef.stepId} failed: ${result.error}`,
          completedAt: now(),
        });
        return;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      await jobRef.update({
        [`steps.${i}.status`]: "failed",
        [`steps.${i}.completedAt`]: now(),
        [`steps.${i}.elapsedMs`]: 0,
        [`steps.${i}.error`]: message,
        status: "failed",
        error: `Step ${stepDef.stepId} crashed: ${message}`,
        completedAt: now(),
      });
      return;
    }
  }

  await jobRef.update({ status: "completed", completedAt: now() });
}

async function executeStep(
  stepId: AutomationStepId,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  const step = makeStepResult(stepId);
  const { db, region, serviceAccountJson, actor } = context;

  try {
    switch (stepId) {
      case "preflight":
        return await executePreflight(step, region);
      case "create_gcp_project":
        return await executeCreateGcpProject(step, context);
      case "enable_apis":
        return await executeEnableApis(step, context);
      case "add_firebase":
        return await executeAddFirebase(step, context);
      case "provision_firestore":
        return await executeProvisionFirestore(step, context);
      case "enable_auth":
        return await executeEnableAuth(step, context);
      case "create_apps":
        return await executeCreateApps(step, context);
      case "collect_sdk_configs":
        return await executeCollectSdkConfigs(step, context);
      case "deploy_rules":
        return await executeDeployRules(step, context);
      case "seed_defaults":
        return await executeSeedDefaults(step, context);
      case "generate_service_account":
        return await executeGenerateServiceAccount(step, context);
      case "create_admin":
        return await executeCreateAdmin(step, context);
      case "provision_vercel":
        return await executeProvisionVercel(step, context);
      case "verify_ready":
        return await executeVerifyReady(step, context);
      default:
        return failStep(step, `Unknown step: ${stepId}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return failStep(step, message);
  }
}

async function executePreflight(
  step: AutomationStepResult,
  region: RegionRecord,
): Promise<AutomationStepResult> {
  const checks: { checkId: string; label: string; passed: boolean; message: string }[] = [];

  // Check GCP project ID format
  const projectIdValid = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(region.firebaseProjectId);
  checks.push({
    checkId: "project_id_format",
    label: "Firebase project ID format",
    passed: projectIdValid,
    message: projectIdValid ? `Project ID "${region.firebaseProjectId}" is valid` : `Invalid project ID format: "${region.firebaseProjectId}"`,
  });

  // Check region code format
  const codeValid = /^[A-Z]{2,5}$/.test(region.regionCode);
  checks.push({
    checkId: "region_code_format",
    label: "Region code format",
    passed: codeValid,
    message: codeValid ? `Region code "${region.regionCode}" is valid` : `Region code must be 2-5 uppercase letters, got "${region.regionCode}"`,
  });

  // Check required env vars exist
  const hasRegionConnectionsSecret = Boolean(process.env.REGION_CONNECTIONS_SECRET);
  checks.push({
    checkId: "region_connections_secret",
    label: "REGION_CONNECTIONS_SECRET configured",
    passed: hasRegionConnectionsSecret,
    message: hasRegionConnectionsSecret ? "Secret is configured" : "REGION_CONNECTIONS_SECRET is not set",
  });

  const hasVercelToken = Boolean(process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN);
  checks.push({
    checkId: "vercel_token",
    label: "Vercel API token configured",
    passed: hasVercelToken,
    message: hasVercelToken ? "Vercel token is configured" : "VERCEL_TOKEN is not set",
  });

  const allPassed = checks.every((c) => c.passed);
  const preflight: PreflightSummary = { allPassed, checks, validatedAt: now() };

  return allPassed
    ? completeStep(step, { preflight: JSON.parse(JSON.stringify(preflight)) })
    : failStep(step, `Preflight checks failed: ${checks.filter((c) => !c.passed).map((c) => c.message).join("; ")}`);
}

async function executeCreateGcpProject(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  const result = await createGcpProject(context.region.firebaseProjectId, `CISS ${context.region.regionName}`);
  return completeStep(step, result);
}

async function executeEnableApis(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  const result = await enableRequiredApis(context.region.firebaseProjectId);
  return completeStep(step, result);
}

async function executeAddFirebase(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  const result = await addFirebaseToProject(context.region.firebaseProjectId);
  return completeStep(step, result);
}

async function executeProvisionFirestore(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  const result = await provisionFirestore(context.region.firebaseProjectId);
  return completeStep(step, result);
}

async function executeEnableAuth(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  const result = await enableIdentityPlatform(context.region.firebaseProjectId);
  return completeStep(step, result);
}

async function executeCreateApps(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  const packageName = process.env.ANDROID_PACKAGE_NAME || "com.ciss.workforce";
  const androidApp = await createAndroidApp(
    context.region.firebaseProjectId,
    `CISS Workforce ${context.region.regionCode}`,
    packageName,
  );
  const webApp = await createWebApp(
    context.region.firebaseProjectId,
    `CISS Workforce ${context.region.regionCode} Web`,
  );

  await context.db.collection("regions").doc(context.region.regionCode).set(
    {
      androidAppId: androidApp.appId,
      firebaseWebAppId: webApp.appId,
      webAppId: webApp.appId,
      storageBucket: context.region.storageBucket || buildDefaultStorageBucket(context.region.firebaseProjectId),
      ...buildServerUpdateAudit(context.actor),
    },
    { merge: true },
  );

  context.region = {
    ...context.region,
    androidAppId: androidApp.appId,
    firebaseWebAppId: webApp.appId,
    webAppId: webApp.appId,
    storageBucket: context.region.storageBucket || buildDefaultStorageBucket(context.region.firebaseProjectId),
  };

  return completeStep(step, { androidApp, webApp, packageName });
}

async function executeCollectSdkConfigs(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  const androidAppId = context.region.androidAppId;
  const webAppId = context.region.firebaseWebAppId || context.region.webAppId;
  if (!androidAppId || !webAppId) {
    return failStep(step, "Android/Web app IDs are missing. Run create_apps first.");
  }

  const [androidConfig, webConfig] = await Promise.all([
    getAndroidAppConfig(context.region.firebaseProjectId, androidAppId),
    getWebAppConfig(context.region.firebaseProjectId, webAppId),
  ]);

  const update = {
    androidApiKey: androidConfig.apiKey || null,
    androidAppId: androidConfig.appId || androidAppId,
    firebaseApiKey: webConfig.apiKey || null,
    webApiKey: webConfig.apiKey || null,
    firebaseWebAppId: webConfig.appId || webAppId,
    webAppId: webConfig.appId || webAppId,
    authDomain: webConfig.authDomain || `${context.region.firebaseProjectId}.firebaseapp.com`,
    messagingSenderId: webConfig.messagingSenderId || androidConfig.messagingSenderId || null,
    storageBucket: webConfig.storageBucket || androidConfig.storageBucket || context.region.storageBucket || buildDefaultStorageBucket(context.region.firebaseProjectId),
    measurementId: webConfig.measurementId || null,
    ...buildServerUpdateAudit(context.actor),
  };

  await context.db.collection("regions").doc(context.region.regionCode).set(update, { merge: true });
  context.region = { ...context.region, ...update };

  return completeStep(step, {
    androidAppId: update.androidAppId,
    webAppId: update.firebaseWebAppId,
    hasAndroidApiKey: Boolean(update.androidApiKey),
    hasWebApiKey: Boolean(update.firebaseApiKey),
  });
}

async function executeDeployRules(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  if (!context.serviceAccountJson) {
    return failStep(step, "Service account JSON is required before rules and indexes can be deployed.");
  }

  try {
    const fs = await import("fs/promises");
    const [firestoreRules, storageRules] = await Promise.all([
      fs.readFile("firestore.rules", "utf8"),
      fs.readFile("storage.rules", "utf8"),
    ]);

    await deployFirestoreRules(context.region.firebaseProjectId, firestoreRules, context.serviceAccountJson);
    await deployStorageRules(context.region.firebaseProjectId, storageRules, context.serviceAccountJson);
    const indexes = await deployFirestoreIndexes(context.region.firebaseProjectId);

    return completeStep(step, { firestoreRules: true, storageRules: true, indexes });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return failStep(step, `Rules deployment failed: ${message}`);
  }
}

async function executeSeedDefaults(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  if (!context.serviceAccountJson) {
    return failStep(step, "Service account JSON is required before regional defaults can be seeded.");
  }

  try {
    const credentials = {
      firebaseProjectId: context.region.firebaseProjectId,
      storageBucket: context.region.storageBucket || undefined,
      serviceAccountJson: context.serviceAccountJson,
    };

    const regionInfo = {
      regionCode: context.region.regionCode,
      regionName: context.region.regionName,
      firebaseProjectId: context.region.firebaseProjectId,
    };
    await seedRegionDefaults(credentials, regionInfo, context.actor || undefined);

    return completeStep(step, { seeded: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return failStep(step, `Seeding defaults failed: ${message}`);
  }
}

async function executeGenerateServiceAccount(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  const result = await createServiceAccountKey(context.region.firebaseProjectId);
  context.serviceAccountJson = result.serviceAccountJson;

  const storageBucket = context.region.storageBucket || buildDefaultStorageBucket(context.region.firebaseProjectId);
  await saveRegionConnection(
    context.db,
    {
      regionCode: context.region.regionCode,
      firebaseProjectId: context.region.firebaseProjectId,
      storageBucket,
      serviceAccountJson: result.serviceAccountJson,
    },
    context.actor,
  );

  await context.db.collection("regions").doc(context.region.regionCode).set(
    {
      persistentConnectionReady: true,
      lastConnectionSavedAt: new Date().toISOString(),
      storageBucket,
      ...buildServerUpdateAudit(context.actor),
    },
    { merge: true },
  );

  context.region = { ...context.region, persistentConnectionReady: true, storageBucket };

  return completeStep(step, {
    serviceAccountEmail: result.serviceAccountEmail,
    keyStored: true,
  });
}

async function executeCreateAdmin(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  if (!context.serviceAccountJson || !context.region.regionAdminEmail) {
    return failStep(step, "Service account JSON and region admin email are required.");
  }

  try {
    const tempPassword = crypto.randomUUID().slice(0, 16) + "Aa1!";
    const credentials = {
      firebaseProjectId: context.region.firebaseProjectId,
      storageBucket: context.region.storageBucket || undefined,
      serviceAccountJson: context.serviceAccountJson,
    };

    const result = await createRegionAdminAccount(
      credentials,
      { regionCode: context.region.regionCode, regionName: context.region.regionName },
      { email: context.region.regionAdminEmail, password: tempPassword },
    );

    await context.db.collection("regions").doc(context.region.regionCode).set(
      {
        lastRegionAdminUid: result.uid,
        onboardingChecklist: {
          regionAdminCreated: true,
          lastAdminCreatedAt: new Date().toISOString(),
        },
        ...buildServerUpdateAudit(context.actor),
      },
      { merge: true },
    );

    return completeStep(step, {
      uid: result.uid,
      email: result.email,
      created: result.created,
      handoff: "Send a Firebase password reset link from the region admin panel. Temporary passwords are not stored in automation results.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return failStep(step, `Admin creation failed: ${message}`);
  }
}

async function executeProvisionVercel(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  const project = await ensureVercelProject(context.region);
  const env = await buildRegionEnvConfig(context.region);
  if (context.serviceAccountJson) {
    env.FIREBASE_ADMIN_SDK_CONFIG_BASE64 = Buffer.from(context.serviceAccountJson, "utf8").toString("base64");
  }
  await setVercelEnvVars(project.projectName, env);

  let deployment: { url: string; alias: string[] } | null = null;
  try {
    deployment = await deployRegionProject(project.projectName);
  } catch {
    deployment = null;
  }

  const health = await getVercelProjectHealth(project.projectName);
  const productionUrl = deployment?.url ? `https://${deployment.url}` : project.productionUrl;
  await context.db.collection("regions").doc(context.region.regionCode).set(
    {
      vercelProjectName: project.projectName,
      vercelProjectUrl: project.projectUrl,
      vercelProductionUrl: productionUrl,
      onboardingChecklist: { vercelConfigured: true },
      ...buildServerUpdateAudit(context.actor),
    },
    { merge: true },
  );

  context.region = {
    ...context.region,
    vercelProjectName: project.projectName,
    vercelProjectUrl: project.projectUrl,
    vercelProductionUrl: productionUrl,
  };

  return completeStep(step, {
    projectName: project.projectName,
    projectUrl: project.projectUrl,
    productionUrl,
    deploymentTriggered: Boolean(deployment),
    health,
  });
}

async function executeVerifyReady(
  step: AutomationStepResult,
  context: AutomationContext,
): Promise<AutomationStepResult> {
  if (!context.serviceAccountJson) {
    return failStep(step, "Service account JSON is required for readiness verification.");
  }

  const credentials = {
    firebaseProjectId: context.region.firebaseProjectId,
    storageBucket: context.region.storageBucket || undefined,
    serviceAccountJson: context.serviceAccountJson,
  };
  const result = await validateRegionFirebaseConnection(credentials);
  if (!result.success) {
    return failStep(step, `Firebase readiness failed: ${result.messages.join("; ")}`);
  }

  const requiredConfig = [
    context.region.firebaseProjectId,
    context.region.firebaseApiKey || context.region.webApiKey,
    context.region.firebaseWebAppId || context.region.webAppId,
    context.region.androidAppId,
    context.region.storageBucket,
  ];
  if (requiredConfig.some((value) => !value)) {
    return failStep(step, "Region Firebase SDK configuration is incomplete.");
  }

  await context.db.collection("regions").doc(context.region.regionCode).set(
    {
      status: "ready",
      onboardingChecklist: {
        firebaseValidated: true,
        defaultsSeeded: true,
        regionAdminCreated: true,
        vercelConfigured: Boolean(context.region.vercelProjectName),
      },
      validationSummary: {
        checks: {
          projectIdMatches: true,
          firestoreReachable: true,
          authReachable: true,
          storageReachable: true,
        },
        messages: result.messages,
        validatedAt: new Date().toISOString(),
      },
      ...buildServerUpdateAudit(context.actor),
    },
    { merge: true },
  );

  return completeStep(step, { ready: true, messages: result.messages });
}

export async function getAutomationJob(
  db: Firestore,
  jobId: string,
): Promise<AutomationJob | null> {
  const snap = await db.collection(AUTOMATION_COLLECTION).doc(jobId).get();
  if (!snap.exists) return null;
  return snap.data() as AutomationJob;
}

async function claimNextAutomationJob(db: Firestore, workerId: string): Promise<AutomationJob | null> {
  const queuedSnap = await db
    .collection(AUTOMATION_COLLECTION)
    .where("status", "==", "queued")
    .limit(10)
    .get();

  const staleCutoff = Date.now() - STALE_RUNNING_JOB_MS;
  const runningSnap = queuedSnap.empty
    ? await db.collection(AUTOMATION_COLLECTION).where("status", "==", "running").limit(10).get()
    : null;

  const candidates = queuedSnap.empty
    ? (runningSnap?.docs || []).filter((doc) => {
        const data = doc.data() as AutomationJob;
        return !data.claimedAt || new Date(data.claimedAt).getTime() < staleCutoff;
      })
    : queuedSnap.docs;

  const candidate = candidates
    .map((doc) => ({ doc, data: doc.data() as AutomationJob }))
    .sort((a, b) => (a.data.queuedAt || a.data.startedAt).localeCompare(b.data.queuedAt || b.data.startedAt))[0];

  if (!candidate) return null;

  return db.runTransaction(async (transaction) => {
    const ref = candidate.doc.ref;
    const fresh = await transaction.get(ref);
    if (!fresh.exists) return null;

    const job = fresh.data() as AutomationJob;
    const isQueued = job.status === "queued";
    const isStaleRunning =
      job.status === "running" &&
      (!job.claimedAt || new Date(job.claimedAt).getTime() < staleCutoff);

    if (!isQueued && !isStaleRunning) return null;

    const claimedAt = now();
    transaction.update(ref, {
      status: "running",
      claimedAt,
      workerId,
      error: null,
    });

    return { ...job, status: "running", claimedAt, workerId };
  });
}

export async function processNextAutomationJob(db: Firestore): Promise<{
  processed: boolean;
  jobId?: string;
  regionCode?: string;
  status?: AutomationJob["status"];
  message?: string;
}> {
  const workerId = `worker-${crypto.randomUUID()}`;
  const job = await claimNextAutomationJob(db, workerId);
  if (!job) {
    return { processed: false, message: "No queued automation jobs." };
  }

  const regionSnap = await db.collection("regions").doc(job.regionCode).get();
  if (!regionSnap.exists) {
    await db.collection(AUTOMATION_COLLECTION).doc(job.id).update({
      status: "failed",
      error: `Region ${job.regionCode} no longer exists.`,
      completedAt: now(),
    });
    return { processed: true, jobId: job.id, regionCode: job.regionCode, status: "failed" };
  }

  const region = {
    ...(regionSnap.data() as RegionRecord),
    id: job.regionCode,
    regionCode: job.regionCode,
  };
  const connection = await getRegionConnection(db, job.regionCode).catch(() => null);
  const startStepIndex = findCurrentStep(job);

  await runClaimedJob(
    db,
    job.id,
    region,
    connection?.serviceAccountJson || null,
    { uid: job.workerId || workerId, email: "automation-worker@ciss.local" },
    startStepIndex,
  );

  const refreshed = await getAutomationJob(db, job.id);
  return {
    processed: true,
    jobId: job.id,
    regionCode: job.regionCode,
    status: refreshed?.status,
  };
}

export async function retryAutomationStep(
  db: Firestore,
  jobId: string,
  region: RegionRecord,
  _serviceAccountJson: string | null,
  stepIndex: number,
  actor?: { uid?: string | null; email?: string | null },
): Promise<AutomationJob | null> {
  const job = await getAutomationJob(db, jobId);
  if (!job) return null;
  if (stepIndex < 0 || stepIndex >= AUTOMATION_STEPS.length) {
    throw new Error(`Invalid automation step index: ${stepIndex}`);
  }

  const updatedSteps = [...job.steps];
  for (let i = stepIndex; i < updatedSteps.length; i++) {
    updatedSteps[i] = makePendingStepResult(AUTOMATION_STEPS[i].stepId);
  }

  const updatedJob: AutomationJob = {
    ...job,
    status: "queued",
    currentStepIndex: stepIndex,
    steps: updatedSteps,
    queuedAt: now(),
    completedAt: undefined,
    error: undefined,
  };

  await db.collection(AUTOMATION_COLLECTION).doc(jobId).set({
    ...updatedJob,
    auditTrail: [buildServerAuditEvent("automation_retried", actor, { regionCode: region.regionCode, stepIndex })],
  }, { merge: true });

  return updatedJob;
}
