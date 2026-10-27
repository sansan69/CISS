import { NextResponse } from "next/server";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerCreateAudit, buildServerUpdateAudit } from "@/lib/server/audit";
import { saveRegionConnection } from "@/lib/server/region-connections";
import { normalizeStorageBucketName } from "@/lib/server/firebase-management-client";
import {
  DEFAULT_REGION_CHECKLIST,
  RegionInputError,
  hasServiceAccountCredentials,
  makeRegionRecord,
  mergeChecklist,
  nextRegionStatus,
  parseAndroidGoogleServices,
  readServiceAccountProject,
  stripRegionSecrets,
  validateRegionFirebaseConnection,
} from "@/lib/server/region-onboarding";
import {
  buildRegionVercelProjectName,
  buildVercelProjectDashboardUrl,
  getVercelTeamSlug,
} from "@/lib/vercel-region";
import { REGION_CODE, REGION_NAME } from "@/lib/runtime-config";
import type { RegionOnboardingMode, RegionRecord } from "@/types/region";
export const runtime = "nodejs";

/**
 * Body of the Super Admin region enrollment.
 *
 * BYO-Firebase enrollments supply the state's own project: its web config, an
 * optional Android `google-services.json` (or the three explicit Android values),
 * an optional Admin SDK service-account key, and the domains that may serve the
 * app. No GCP project is created — the state owns and shares its project.
 */
type RegionsPostBody = {
  regionCode?: string;
  regionName?: string;
  regionAdminEmail?: string | null;
  firebaseProjectId?: string;
  firebaseApiKey?: string | null;
  firebaseWebAppId?: string | null;
  storageBucket?: string | null;
  authDomain?: string | null;
  messagingSenderId?: string | null;
  measurementId?: string | null;
  serviceAccountJson?: string | null;
  serviceAccountBase64?: string | null;
  googleServicesJson?: string | null;
  androidAppId?: string | null;
  androidApiKey?: string | null;
  androidPackageName?: string | null;
  allowedDomains?: string[] | string | null;
  onboardingMode?: string | null;
};

function assertSameProject(
  label: string,
  actual: string | null | undefined,
  expected: string,
) {
  if (!actual) return;
  if (actual.trim().toLowerCase() !== expected.trim().toLowerCase()) {
    throw new RegionInputError(
      `${label} belongs to Firebase project "${actual.trim()}", but the region is configured for "${expected.trim()}". A state can only be enrolled with its own project.`,
    );
  }
}

function buildSyntheticKeralaRegion(): RegionRecord {
  const vercelTeamSlug = getVercelTeamSlug();
  return {
    id: REGION_CODE,
    regionCode: REGION_CODE,
    regionName: REGION_NAME,
    status: "live",
    firebaseProjectId:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "ciss-workforce",
    firebaseApiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || null,
    firebaseWebAppId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || null,
    storageBucket:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || null,
    authDomain:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || null,
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || null,
    measurementId:
      process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || null,
    regionAdminEmail: process.env.SUPER_ADMIN_EMAIL || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL || null,
    appMode: "regional",
    onboardingChecklist: {
      ...DEFAULT_REGION_CHECKLIST,
      metadataSaved: true,
      firebaseValidated: true,
      defaultsSeeded: true,
      regionAdminCreated: true,
      vercelConfigured: true,
    },
    vercelProjectName: "ciss",
    vercelProjectUrl: buildVercelProjectDashboardUrl("ciss", vercelTeamSlug),
    vercelProductionUrl: "https://cisskerala.site",
    vercelTeamSlug,
    isCurrentRegion: true,
    isSynthetic: true,
  };
}

export async function GET(request: Request) {
  try {
    await requireSuperAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const snapshot = await adminDb.collection("regions").orderBy("regionCode").get();
    const regions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as RegionRecord[];

    if (!regions.some((region) => region.regionCode === REGION_CODE)) {
      regions.unshift(buildSyntheticKeralaRegion());
    }

    return NextResponse.json({ regions });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized", error?.message === "Super admin access required." ? 403 : 401);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSuperAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = ((await request.json()) ?? {}) as RegionsPostBody;

    const regionCode = body.regionCode?.trim() ?? "";
    const regionName = body.regionName?.trim() ?? "";
    const firebaseProjectId = body.firebaseProjectId?.trim() ?? "";

    if (!regionCode || !regionName || !firebaseProjectId) {
      return NextResponse.json(
        { error: "regionCode, regionName, and firebaseProjectId are required." },
        { status: 400 },
      );
    }

    const onboardingModeInput = body.onboardingMode?.trim() || undefined;
    if (
      onboardingModeInput &&
      onboardingModeInput !== "byo_firebase" &&
      onboardingModeInput !== "automated"
    ) {
      throw new RegionInputError('onboardingMode must be "byo_firebase" or "automated".');
    }

    // Android client config: a pasted google-services.json, or the explicit
    // values, never both with conflicting content.
    let android = {
      androidAppId: body.androidAppId?.trim() || null,
      androidApiKey: body.androidApiKey?.trim() || null,
      androidPackageName: body.androidPackageName?.trim() || null,
    };

    if (body.googleServicesJson?.trim()) {
      // When the operator also names the package, enrol that client rather than
      // whichever Android app happens to be first in a multi-app file.
      const parsed = parseAndroidGoogleServices(body.googleServicesJson, {
        packageName: android.androidPackageName,
      });
      assertSameProject("google-services.json", parsed.projectId, firebaseProjectId);

      for (const [label, explicit, fromFile] of [
        ["androidAppId", android.androidAppId, parsed.appId],
        ["androidApiKey", android.androidApiKey, parsed.apiKey],
        ["androidPackageName", android.androidPackageName, parsed.packageName],
      ] as const) {
        if (explicit && explicit !== fromFile) {
          throw new RegionInputError(
            `${label} does not match the value inside google-services.json. Send the file or the explicit values, not both.`,
          );
        }
      }

      android = {
        androidAppId: parsed.appId,
        androidApiKey: parsed.apiKey,
        androidPackageName: parsed.packageName,
      };
    }

    // Project agreement is checked before anything is persisted, so a state can
    // never be enrolled against someone else's project.
    const hasServiceAccount = hasServiceAccountCredentials(body);
    if (hasServiceAccount) {
      const serviceAccount = readServiceAccountProject({
        serviceAccountJson: body.serviceAccountJson ?? undefined,
        serviceAccountBase64: body.serviceAccountBase64 ?? undefined,
      });
      assertSameProject("The service account", serviceAccount.projectId, firebaseProjectId);
    }

    // Storage: Firebase does not create the default bucket for us, and a region
    // without one cannot store training material, document scans or attendance
    // selfies. A BYO enrolment must therefore name the bucket its project has
    // enabled - both to validate it now and to deploy the rules later.
    const suppliedBucket = body.storageBucket?.trim() || "";
    const storageBucket = suppliedBucket
      ? normalizeStorageBucketName(suppliedBucket)
      : null;
    if (suppliedBucket && !storageBucket) {
      throw new RegionInputError(
        `storageBucket "${suppliedBucket}" is not a valid Cloud Storage bucket name. Use the bare bucket name (for example "ciss-tn.firebasestorage.app"), not a gs:// URL or a console link.`,
        422,
      );
    }
    if (hasServiceAccount && !storageBucket) {
      throw new RegionInputError(
        'storageBucket is required when enrolling a state\'s own Firebase project. Enable Cloud Storage in the state\'s Firebase console (Storage > Get started) and send the bucket name, for example "<project-id>.firebasestorage.app".',
        422,
      );
    }

    const region = makeRegionRecord({
      regionCode,
      regionName,
      regionAdminEmail: body.regionAdminEmail,
      firebaseProjectId,
      firebaseApiKey: body.firebaseApiKey,
      firebaseWebAppId: body.firebaseWebAppId,
      storageBucket,
      authDomain: body.authDomain,
      messagingSenderId: body.messagingSenderId,
      measurementId: body.measurementId,
      ...android,
      allowedDomains: body.allowedDomains ?? null,
      onboardingMode: onboardingModeInput as RegionOnboardingMode | undefined,
      hasServiceAccount,
    });

    const vercelTeamSlug = getVercelTeamSlug();
    const vercelProjectName = buildRegionVercelProjectName(region.regionName, region.regionCode);

    const docRef = adminDb.collection("regions").doc(region.regionCode);
    const existing = await docRef.get();
    if (existing.exists) {
      return NextResponse.json(
        { error: `Region ${region.regionCode} already exists.` },
        { status: 409 },
      );
    }

    let connectionSaved: boolean | null = null;
    let validation: Awaited<ReturnType<typeof validateRegionFirebaseConnection>> | null = null;

    if (hasServiceAccount) {
      try {
        validation = await validateRegionFirebaseConnection({
          firebaseProjectId: region.firebaseProjectId,
          storageBucket: region.storageBucket,
          serviceAccountJson: body.serviceAccountJson ?? undefined,
          serviceAccountBase64: body.serviceAccountBase64 ?? undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new RegionInputError(
          `Could not validate the state's Firebase project with the supplied service account: ${message}`,
          422,
        );
      }

      if (validation.success) {
        // AES-256-GCM at rest (region-connections). The plaintext key is never
        // written to the region document, the audit log, or this response.
        connectionSaved = await saveRegionConnection(
          adminDb,
          {
            regionCode: region.regionCode,
            firebaseProjectId: region.firebaseProjectId,
            storageBucket: region.storageBucket,
            serviceAccountJson: body.serviceAccountJson ?? undefined,
            serviceAccountBase64: body.serviceAccountBase64 ?? undefined,
          },
          { uid: actor.uid, email: actor.email },
        );
      }
    }

    const checklist = mergeChecklist(DEFAULT_REGION_CHECKLIST, {
      metadataSaved: true,
      ...(validation
        ? { firebaseValidated: validation.success, lastValidatedAt: new Date() }
        : {}),
    });

    const storedRegion: RegionRecord = {
      ...region,
      status: nextRegionStatus(checklist),
      onboardingChecklist: checklist,
      ...(validation
        ? {
            validationSummary: {
              checks: validation.checks,
              messages: validation.messages,
              validatedAt: new Date(),
            },
          }
        : {}),
      ...(connectionSaved
        ? { persistentConnectionReady: true, lastConnectionSavedAt: new Date() }
        : {}),
      vercelProjectName,
      vercelProjectUrl: buildVercelProjectDashboardUrl(vercelProjectName, vercelTeamSlug),
      vercelProductionUrl: null,
      vercelTeamSlug,
    };

    await docRef.set({
      ...stripRegionSecrets(storedRegion),
      ...buildServerCreateAudit({ uid: actor.uid, email: actor.email }),
    });

    await adminDb.collection("regionOnboardingAudit").add({
      action: "region_created",
      regionCode: region.regionCode,
      regionName: region.regionName,
      firebaseProjectId: region.firebaseProjectId,
      onboardingMode: region.onboardingMode,
      hasServiceAccount,
      firebaseValidated: Boolean(validation?.success),
      hasGoogleServicesJson: Boolean(body.googleServicesJson?.trim()),
      androidPackageName: region.androidPackageName,
      allowedDomains: region.allowedDomains,
      ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
    });

    // Never echo credentials. `stripRegionSecrets` is defence in depth: the record
    // above is built from non-secret input only.
    const responseRegion = stripRegionSecrets(storedRegion);

    if (validation && !validation.success) {
      // The metadata is kept as `config_pending` so the operator can retry
      // `POST /regions/{id}/validate` without re-typing the config, but the
      // credential is not persisted and no secret is echoed back.
      return NextResponse.json(
        {
          error:
            "Firebase validation failed. The region was saved as config_pending — fix the state's Firebase project, then retry validation with the same service account.",
          id: region.regionCode,
          region: responseRegion,
          checks: validation.checks,
          messages: validation.messages,
        },
        { status: 422 },
      );
    }

    return NextResponse.json(
      {
        id: region.regionCode,
        region: responseRegion,
        firebaseValidated: Boolean(validation?.success),
        hasPersistentConnection: Boolean(connectionSaved),
      },
      { status: 201 },
    );
  } catch (error: any) {
    if (error instanceof RegionInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const message: string = error?.message || "Could not create the region.";
    if (message === "Super admin access required.") {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    // requireSuperAdmin throws "Missing bearer token." or a Firebase Auth
    // verification error; everything else is an unexpected server failure.
    if (/token|auth|permission|credential/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
