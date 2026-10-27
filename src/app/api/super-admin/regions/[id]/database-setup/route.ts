import { NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/server/auth";
import { buildServerUpdateAudit } from "@/lib/server/audit";
import {
  deployFirestoreIndexes,
  deployFirestoreRules,
  deployStorageRules,
  normalizeStorageBucketName,
  readDatabaseConfigFiles,
  verifyStorageBucketWithRegionCredentials,
} from "@/lib/server/firebase-management-client";
import { getRegionConnection } from "@/lib/server/region-connections";
import { RegionInputError, mergeChecklist } from "@/lib/server/region-onboarding";
import type {
  RegionDatabaseSetup,
  RegionDatabaseSetupStep,
  RegionDatabaseSetupStepId,
  RegionRecord,
} from "@/types/region";

export const runtime = "nodejs";
// Rules release is quick; index builds are not. The route reports unfinished
// indexes as `pending` inside this budget instead of holding the request open.
export const maxDuration = 300;

const INDEX_WAIT_BUDGET_MS = 60_000;

type StepOutcome = RegionDatabaseSetupStep;

function stepStatus(steps: StepOutcome[], step: RegionDatabaseSetupStepId) {
  return steps.find((entry) => entry.step === step);
}

function failed(first: StepOutcome | undefined) {
  return first && first.status === "failed";
}

async function loadRegion(regionCode: string) {
  const { db: adminDb } = await import("@/lib/firebaseAdmin");
  const docRef = adminDb.collection("regions").doc(regionCode);
  const snap = await docRef.get();
  return {
    adminDb,
    docRef,
    snap,
    region: snap.exists ? (snap.data() as RegionRecord) : null,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSuperAdmin(request);
    const { id } = await params;
    const regionCode = id.trim().toUpperCase();

    const { adminDb, docRef, snap, region } = await loadRegion(regionCode);
    if (!snap.exists || !region) {
      return NextResponse.json({ error: "Region not found." }, { status: 404 });
    }

    // The region's own service account is the only identity allowed to deploy
    // into the state's project. HQ ADC is deliberately not a fallback here: HQ
    // has no access to a state's project, and guessing would hide a misconfig.
    const connection = await getRegionConnection(adminDb, regionCode);
    if (!connection?.serviceAccountJson) {
      throw new RegionInputError(
        "No service account is stored for this region. Validate and save the state's service account first (POST /api/super-admin/regions/{id}/validate).",
        422,
      );
    }

    const firebaseProjectId = region.firebaseProjectId?.trim();
    if (!firebaseProjectId) {
      throw new RegionInputError("The region has no firebaseProjectId.", 422);
    }
    if (
      connection.firebaseProjectId &&
      connection.firebaseProjectId !== firebaseProjectId
    ) {
      throw new RegionInputError(
        `The stored service account belongs to "${connection.firebaseProjectId}" but the region is configured for "${firebaseProjectId}". Re-validate the region before deploying database rules.`,
        422,
      );
    }

    const suppliedBucket = region.storageBucket?.trim() || "";
    const storageBucket =
      normalizeStorageBucketName(suppliedBucket) ||
      normalizeStorageBucketName(connection.storageBucket);
    if (!storageBucket) {
      throw new RegionInputError(
        'This region has no Storage bucket. Set the bucket on the region (for example "<project-id>.firebasestorage.app") and re-enrol, then run database setup again.',
        422,
      );
    }

    const files = await readDatabaseConfigFiles();

    const steps: StepOutcome[] = [];
    const setup: RegionDatabaseSetup = { lastAttemptAt: new Date() };

    // 1. Bucket first: if the state's Storage is not reachable there is no point
    //    releasing storage rules or indexes against a half-built project.
    try {
      const bucketInfo = await verifyStorageBucketWithRegionCredentials({
        projectId: firebaseProjectId,
        storageBucket,
        serviceAccountJson: connection.serviceAccountJson,
      });
      steps.push({
        step: "bucket",
        status: "verified",
        message: `Bucket ${bucketInfo.bucket} answered a metadata call${
          bucketInfo.location ? ` (${bucketInfo.location})` : ""
        }.`,
      });
      setup.bucketVerifiedAt = new Date();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      steps.push({
        step: "bucket",
        status: "failed",
        message: `Storage bucket "${storageBucket}" could not be verified: ${message}`,
      });
      setup.lastError = `bucket: ${message}`;
    }

    // 2. Firestore rules, 3. Storage rules, 4. Indexes — each isolated so a
    //    partial run reports exactly which step stopped it.
    if (!failed(stepStatus(steps, "bucket"))) {
      try {
        await deployFirestoreRules(
          firebaseProjectId,
          files.firestoreRules,
          connection.serviceAccountJson,
        );
        steps.push({
          step: "firestoreRules",
          status: "deployed",
          message: "Firestore security rules released.",
        });
        setup.rulesDeployedAt = new Date();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        steps.push({
          step: "firestoreRules",
          status: "failed",
          message: `Firestore rules release failed: ${message}`,
        });
        setup.lastError = `firestoreRules: ${message}`;
      }
    } else {
      steps.push({
        step: "firestoreRules",
        status: "skipped",
        message: "Skipped because the Storage bucket could not be verified.",
      });
    }

    if (!steps.some((entry) => entry.status === "failed")) {
      try {
        await deployStorageRules(
          firebaseProjectId,
          files.storageRules,
          connection.serviceAccountJson,
        );
        steps.push({
          step: "storageRules",
          status: "deployed",
          message: "Storage security rules released.",
        });
        setup.storageRulesDeployedAt = new Date();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        steps.push({
          step: "storageRules",
          status: "failed",
          message: `Storage rules release failed: ${message}`,
        });
        setup.lastError = `storageRules: ${message}`;
      }
    } else {
      steps.push({
        step: "storageRules",
        status: "skipped",
        message: "Skipped because an earlier step failed.",
      });
    }

    if (!steps.some((entry) => entry.status === "failed")) {
      try {
        const indexes = await deployFirestoreIndexes(firebaseProjectId, {
          indexesFile: files.indexesFile,
          serviceAccountJson: connection.serviceAccountJson,
          maxWaitMs: INDEX_WAIT_BUDGET_MS,
        });
        steps.push({
          step: "indexes",
          status: "deployed",
          created: indexes.created,
          existing: indexes.existing,
          pending: indexes.pending,
          message:
            indexes.pending > 0
              ? `${indexes.created} created, ${indexes.existing} already present, ${indexes.pending} still building — re-run to confirm.`
              : `${indexes.created} created, ${indexes.existing} already present.`,
        });
        setup.indexes = {
          created: indexes.created,
          existing: indexes.existing,
          pending: indexes.pending,
          deployedAt: new Date(),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        steps.push({
          step: "indexes",
          status: "failed",
          message: `Firestore index deployment failed: ${message}`,
        });
        setup.lastError = `indexes: ${message}`;
      }
    } else {
      steps.push({
        step: "indexes",
        status: "skipped",
        message: "Skipped because an earlier step failed.",
      });
    }

    const anyFailed = steps.some((entry) => entry.status === "failed");
    const anyDeployed = steps.some(
      (entry) => entry.status === "deployed" || entry.status === "verified",
    );
    const indexesStep = stepStatus(steps, "indexes");

    const checklist = mergeChecklist(region.onboardingChecklist, {
      rulesDeployed:
        stepStatus(steps, "firestoreRules")?.status === "deployed" &&
        stepStatus(steps, "storageRules")?.status === "deployed",
      indexesDeployed: indexesStep?.status === "deployed",
      storageBucketVerified: stepStatus(steps, "bucket")?.status === "verified",
    });

    await docRef.set(
      {
        onboardingChecklist: checklist,
        databaseSetup: setup,
        ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
      },
      { merge: true },
    );

    await adminDb.collection("regionOnboardingAudit").add({
      action: "region_database_setup",
      regionCode,
      firebaseProjectId,
      success: !anyFailed,
      steps: steps.map((entry) => ({
        step: entry.step,
        status: entry.status,
        created: entry.created,
        existing: entry.existing,
        pending: entry.pending,
      })),
      ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
    });

    // No credential material is copied into this payload: steps, counts and
    // timestamps only.
    return NextResponse.json(
      {
        regionCode,
        ok: !anyFailed,
        status: anyFailed ? (anyDeployed ? "partial" : "failed") : "complete",
        steps,
        databaseSetup: setup,
        checklist: {
          rulesDeployed: checklist.rulesDeployed,
          indexesDeployed: checklist.indexesDeployed,
          storageBucketVerified: checklist.storageBucketVerified,
        },
      },
      { status: anyFailed ? (anyDeployed ? 207 : 500) : 200 },
    );
  } catch (error: any) {
    if (error instanceof RegionInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message: string = error?.message || "Could not set up the region database.";
    if (message === "Super admin access required.") {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (message === "Region not found.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (/token|auth|permission|credential/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin(request);
    const { id } = await params;
    const regionCode = id.trim().toUpperCase();

    const { adminDb, snap, region } = await loadRegion(regionCode);
    if (!snap.exists || !region) {
      return NextResponse.json({ error: "Region not found." }, { status: 404 });
    }

    const connection = await getRegionConnection(adminDb, regionCode).catch(
      () => null,
    );

    return NextResponse.json({
      regionCode,
      storageBucket: region.storageBucket ?? null,
      hasPersistentConnection: Boolean(connection?.serviceAccountJson),
      databaseSetup: region.databaseSetup ?? null,
      checklist: {
        rulesDeployed: region.onboardingChecklist?.rulesDeployed ?? false,
        indexesDeployed: region.onboardingChecklist?.indexesDeployed ?? false,
        storageBucketVerified:
          region.onboardingChecklist?.storageBucketVerified ?? false,
      },
    });
  } catch (error: any) {
    const message: string = error?.message || "Unauthorized";
    if (message === "Super admin access required.") {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
