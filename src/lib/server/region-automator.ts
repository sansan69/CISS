import crypto from "crypto";
import type { Firestore } from "firebase-admin/firestore";

import {
  buildServerAuditEvent,
  buildServerUpdateAudit,
} from "@/lib/server/audit";
import {
  createRegionAdminAccount,
  seedRegionDefaults,
  validateRegionFirebaseConnection,
} from "@/lib/server/region-onboarding";
import { saveRegionConnection } from "@/lib/server/region-connections";
import { buildRegionVercelProjectName } from "@/lib/vercel-region";
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
  { stepId: "deploy_rules", label: "Deploy security rules & indexes" },
  { stepId: "seed_defaults", label: "Seed default configurations" },
  { stepId: "generate_service_account", label: "Generate service account" },
  { stepId: "create_admin", label: "Create region admin account" },
  { stepId: "provision_vercel", label: "Provision Vercel project & deploy" },
  { stepId: "verify_ready", label: "Verify region readiness" },
];

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

function skipStep(step: AutomationStepResult, reason: string): AutomationStepResult {
  return { ...step, status: "skipped", completedAt: now(), elapsedMs: elapsedMs(step.startedAt), error: reason };
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
  serviceAccountJson: string | null,
  actor?: { uid?: string | null; email?: string | null },
): Promise<AutomationJob> {
  const jobId = crypto.randomUUID();
  const steps = AUTOMATION_STEPS.map((s) => makeStepResult(s.stepId));

  const job: AutomationJob = {
    id: jobId,
    regionCode: region.regionCode,
    status: "running",
    startedAt: now(),
    currentStepIndex: 0,
    steps,
  };

  await db.collection(AUTOMATION_COLLECTION).doc(jobId).set({
    ...job,
    auditTrail: [buildServerAuditEvent("automation_started", actor, { regionCode: region.regionCode })],
  });

  updateJobInBackground(db, jobId, region, serviceAccountJson, actor);

  return job;
}

async function updateJobInBackground(
  db: Firestore,
  jobId: string,
  region: RegionRecord,
  serviceAccountJson: string | null,
  actor?: { uid?: string | null; email?: string | null },
): Promise<void> {
  const lockAcquired = await acquireLock(db);
  if (!lockAcquired) {
    const jobDoc = db.collection(AUTOMATION_COLLECTION).doc(jobId);
    await jobDoc.update({
      status: "failed",
      error: "Another automation job is already in progress. Wait for it to complete or expire.",
      completedAt: now(),
    });
    return;
  }

  try {
    await executeSteps(db, jobId, region, serviceAccountJson, actor);
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
): Promise<void> {
  const jobRef = db.collection(AUTOMATION_COLLECTION).doc(jobId);

  for (let i = 0; i < AUTOMATION_STEPS.length; i++) {
    const stepDef = AUTOMATION_STEPS[i];

    await jobRef.update({
      currentStepIndex: i,
      [`steps.${i}.status`]: "running",
      [`steps.${i}.startedAt`]: now(),
    });

    try {
      const result = await executeStep(
        stepDef.stepId,
        db,
        region,
        serviceAccountJson,
        actor,
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
  db: Firestore,
  region: RegionRecord,
  serviceAccountJson: string | null,
  actor?: { uid?: string | null; email?: string | null },
): Promise<AutomationStepResult> {
  const step = makeStepResult(stepId);

  try {
    switch (stepId) {
      case "preflight":
        return await executePreflight(step, region);
      case "create_gcp_project":
        return await executeCreateGcpProject(step, region);
      case "enable_apis":
        return await executeEnableApis(step, region);
      case "add_firebase":
        return await executeAddFirebase(step, region);
      case "provision_firestore":
        return await executeProvisionFirestore(step, region);
      case "enable_auth":
        return await executeEnableAuth(step, region);
      case "create_apps":
        return await executeCreateApps(step, region);
      case "collect_sdk_configs":
        return await executeCollectSdkConfigs(step, region);
      case "deploy_rules":
        return await executeDeployRules(step, db, region, serviceAccountJson);
      case "seed_defaults":
        return await executeSeedDefaults(step, db, region, serviceAccountJson, actor);
      case "generate_service_account":
        return await executeGenerateServiceAccount(step, db, region, actor);
      case "create_admin":
        return await executeCreateAdmin(step, db, region, serviceAccountJson, actor);
      case "provision_vercel":
        return await executeProvisionVercel(step, db, region, actor);
      case "verify_ready":
        return await executeVerifyReady(step, db, region, serviceAccountJson);
      default:
        return skipStep(step, `Unknown step: ${stepId}`);
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
  region: RegionRecord,
): Promise<AutomationStepResult> {
  return skipStep(step, "GCP project creation requires the Google Cloud Resource Manager API. Implement after obtaining HQ service account with resourcemanager.projectCreator role.");
}

async function executeEnableApis(
  step: AutomationStepResult,
  region: RegionRecord,
): Promise<AutomationStepResult> {
  return skipStep(step, "API enablement requires Service Usage API access. Configure in the Firebase Console or implement via Service Usage REST API.");
}

async function executeAddFirebase(
  step: AutomationStepResult,
  region: RegionRecord,
): Promise<AutomationStepResult> {
  return skipStep(step, "Firebase project linking requires Firebase Management API. Implement after configuring HQ service account with firebase.managementServiceAgent role.");
}

async function executeProvisionFirestore(
  step: AutomationStepResult,
  region: RegionRecord,
): Promise<AutomationStepResult> {
  return skipStep(step, "Firestore provisioning requires Firestore Admin REST API. Deploy via firebase-tools CLI or implement via FirestoreAdmin REST API.");
}

async function executeEnableAuth(
  step: AutomationStepResult,
  region: RegionRecord,
): Promise<AutomationStepResult> {
  return skipStep(step, "Auth provider setup requires Identity Toolkit API. Implement after obtaining credentials.");
}

async function executeCreateApps(
  step: AutomationStepResult,
  region: RegionRecord,
): Promise<AutomationStepResult> {
  return skipStep(step, "Android/Web app creation requires Firebase Management API. Implement after credentials are configured.");
}

async function executeCollectSdkConfigs(
  step: AutomationStepResult,
  region: RegionRecord,
): Promise<AutomationStepResult> {
  return skipStep(step, "SDK config collection requires Firebase Management API. Implement after apps are created.");
}

async function executeDeployRules(
  step: AutomationStepResult,
  db: Firestore,
  region: RegionRecord,
  serviceAccountJson: string | null,
): Promise<AutomationStepResult> {
  if (!serviceAccountJson) {
    return skipStep(step, "Service account JSON not provided. Upload the service account in the state management UI first.");
  }

  try {
    const credentials = {
      firebaseProjectId: region.firebaseProjectId,
      storageBucket: region.storageBucket || undefined,
      serviceAccountJson,
    };

    const result = await validateRegionFirebaseConnection(credentials);
    if (!result.success) {
      return failStep(step, `Firebase connection validation failed: ${result.messages.join("; ")}`);
    }

    return completeStep(step, { validationMessages: result.messages });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return failStep(step, `Rules deployment failed: ${message}`);
  }
}

async function executeSeedDefaults(
  step: AutomationStepResult,
  db: Firestore,
  region: RegionRecord,
  serviceAccountJson: string | null,
  actor?: { uid?: string | null; email?: string | null },
): Promise<AutomationStepResult> {
  if (!serviceAccountJson) {
    return skipStep(step, "Service account JSON not provided.");
  }

  try {
    const credentials = {
      firebaseProjectId: region.firebaseProjectId,
      storageBucket: region.storageBucket || undefined,
      serviceAccountJson,
    };

    const regionInfo = { regionCode: region.regionCode, regionName: region.regionName, firebaseProjectId: region.firebaseProjectId };
    await seedRegionDefaults(credentials, regionInfo, actor || undefined);

    return completeStep(step, { seeded: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return failStep(step, `Seeding defaults failed: ${message}`);
  }
}

async function executeGenerateServiceAccount(
  step: AutomationStepResult,
  db: Firestore,
  region: RegionRecord,
  actor?: { uid?: string | null; email?: string | null },
): Promise<AutomationStepResult> {
  return skipStep(step, "Service account key generation requires IAM API. Generate from Firebase Console or implement via IAM REST API.");
}

async function executeCreateAdmin(
  step: AutomationStepResult,
  db: Firestore,
  region: RegionRecord,
  serviceAccountJson: string | null,
  actor?: { uid?: string | null; email?: string | null },
): Promise<AutomationStepResult> {
  if (!serviceAccountJson || !region.regionAdminEmail) {
    return skipStep(step, "Service account JSON or admin email not provided.");
  }

  try {
    const tempPassword = crypto.randomUUID().slice(0, 16) + "Aa1!";
    const credentials = {
      firebaseProjectId: region.firebaseProjectId,
      storageBucket: region.storageBucket || undefined,
      serviceAccountJson,
    };

    const result = await createRegionAdminAccount(
      credentials,
      { regionCode: region.regionCode, regionName: region.regionName },
      { email: region.regionAdminEmail, password: tempPassword },
    );

    return completeStep(step, {
      uid: result.uid,
      email: result.email,
      created: result.created,
      tempPassword: tempPassword,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return failStep(step, `Admin creation failed: ${message}`);
  }
}

async function executeProvisionVercel(
  step: AutomationStepResult,
  db: Firestore,
  region: RegionRecord,
  actor?: { uid?: string | null; email?: string | null },
): Promise<AutomationStepResult> {
  return skipStep(step, "Vercel provisioning requires the provision-region-vercel.mjs script to be invoked. Run it manually or integrate as a workflow step.");
}

async function executeVerifyReady(
  step: AutomationStepResult,
  db: Firestore,
  region: RegionRecord,
  serviceAccountJson: string | null,
): Promise<AutomationStepResult> {
  return skipStep(step, "Readiness verification checks not yet automated. Use the readiness checker API route.");
}

export async function getAutomationJob(
  db: Firestore,
  jobId: string,
): Promise<AutomationJob | null> {
  const snap = await db.collection(AUTOMATION_COLLECTION).doc(jobId).get();
  if (!snap.exists) return null;
  return snap.data() as AutomationJob;
}

export async function retryAutomationStep(
  db: Firestore,
  jobId: string,
  region: RegionRecord,
  serviceAccountJson: string | null,
  stepIndex: number,
  actor?: { uid?: string | null; email?: string | null },
): Promise<AutomationJob | null> {
  const job = await getAutomationJob(db, jobId);
  if (!job) return null;

  const updatedSteps = [...job.steps];
  updatedSteps[stepIndex] = makeStepResult(AUTOMATION_STEPS[stepIndex].stepId);

  const updatedJob: AutomationJob = {
    ...job,
    status: "running",
    currentStepIndex: stepIndex,
    steps: updatedSteps,
  };

  await db.collection(AUTOMATION_COLLECTION).doc(jobId).set(updatedJob);

  updateJobInBackground(db, jobId, region, serviceAccountJson, actor);

  return updatedJob;
}
