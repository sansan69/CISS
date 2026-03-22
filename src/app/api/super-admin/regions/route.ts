import { NextResponse } from "next/server";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerCreateAudit, buildServerUpdateAudit } from "@/lib/server/audit";
import {
  DEFAULT_REGION_CHECKLIST,
  makeRegionRecord,
} from "@/lib/server/region-onboarding";
import {
  buildRegionVercelProjectName,
  buildVercelProductionUrl,
  buildVercelProjectDashboardUrl,
  getVercelTeamSlug,
} from "@/lib/vercel-region";
import { REGION_CODE, REGION_NAME } from "@/lib/runtime-config";
import type { RegionRecord } from "@/types/region";

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
    const body = (await request.json()) as {
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
    };

    if (!body.regionCode?.trim() || !body.regionName?.trim() || !body.firebaseProjectId?.trim()) {
      return NextResponse.json(
        { error: "regionCode, regionName, and firebaseProjectId are required." },
        { status: 400 },
      );
    }

    const region = makeRegionRecord({
      regionCode: body.regionCode,
      regionName: body.regionName,
      regionAdminEmail: body.regionAdminEmail,
      firebaseProjectId: body.firebaseProjectId,
      firebaseApiKey: body.firebaseApiKey,
      firebaseWebAppId: body.firebaseWebAppId,
      storageBucket: body.storageBucket,
      authDomain: body.authDomain,
      messagingSenderId: body.messagingSenderId,
      measurementId: body.measurementId,
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

    await docRef.set({
      ...region,
      vercelProjectName,
      vercelProjectUrl: buildVercelProjectDashboardUrl(vercelProjectName, vercelTeamSlug),
      vercelProductionUrl: buildVercelProductionUrl(vercelProjectName, vercelTeamSlug),
      vercelTeamSlug,
      ...buildServerCreateAudit({ uid: actor.uid, email: actor.email }),
    });

    await adminDb.collection("regionOnboardingAudit").add({
      action: "region_created",
      regionCode: region.regionCode,
      regionName: region.regionName,
      firebaseProjectId: region.firebaseProjectId,
      ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
    });

    return NextResponse.json({ id: region.regionCode, region }, { status: 201 });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized", error?.message === "Super admin access required." ? 403 : 401);
  }
}
