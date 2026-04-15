import { NextResponse } from "next/server";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerUpdateAudit } from "@/lib/server/audit";
import {
  DEFAULT_REGION_CHECKLIST,
  mergeChecklist,
  nextRegionStatus,
} from "@/lib/server/region-onboarding";
import {
  buildRegionVercelProjectName,
  buildVercelProjectDashboardUrl,
  getVercelTeamSlug,
} from "@/lib/vercel-region";
import type { RegionRecord } from "@/types/region";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const doc = await adminDb.collection("regions").doc(id.toUpperCase()).get();

    if (!doc.exists) {
      return NextResponse.json({ error: "Region not found." }, { status: 404 });
    }

    return NextResponse.json({
      region: {
        id: doc.id,
        ...doc.data(),
      } as RegionRecord,
    });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized", error?.message === "Super admin access required." ? 403 : 401);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSuperAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as Partial<RegionRecord>;

    const docRef = adminDb.collection("regions").doc(id.toUpperCase());
    const existing = await docRef.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Region not found." }, { status: 404 });
    }

    const current = existing.data() as Partial<RegionRecord>;
    const checklist = mergeChecklist(current.onboardingChecklist, body.onboardingChecklist);
    const regionName = body.regionName?.trim() || current.regionName || id.toUpperCase();
    const vercelTeamSlug =
      body.vercelTeamSlug?.trim() || current.vercelTeamSlug || getVercelTeamSlug();
    const vercelProjectName =
      body.vercelProjectName?.trim() ||
      current.vercelProjectName ||
      buildRegionVercelProjectName(regionName, id.toUpperCase());

    const patch: Record<string, unknown> = {
      regionName,
      regionAdminEmail:
        body.regionAdminEmail === undefined
          ? current.regionAdminEmail ?? null
          : body.regionAdminEmail?.trim() || null,
      firebaseProjectId:
        body.firebaseProjectId?.trim() || current.firebaseProjectId || "",
      firebaseApiKey:
        body.firebaseApiKey === undefined
          ? current.firebaseApiKey ?? null
          : body.firebaseApiKey?.trim() || null,
      firebaseWebAppId:
        body.firebaseWebAppId === undefined
          ? current.firebaseWebAppId ?? null
          : body.firebaseWebAppId?.trim() || null,
      storageBucket:
        body.storageBucket === undefined
          ? current.storageBucket ?? null
          : body.storageBucket?.trim() || null,
      authDomain:
        body.authDomain === undefined
          ? current.authDomain ?? null
          : body.authDomain?.trim() || null,
      messagingSenderId:
        body.messagingSenderId === undefined
          ? current.messagingSenderId ?? null
          : body.messagingSenderId?.trim() || null,
      measurementId:
        body.measurementId === undefined
          ? current.measurementId ?? null
          : body.measurementId?.trim() || null,
      vercelProjectName:
        body.vercelProjectName === undefined
          ? vercelProjectName
          : body.vercelProjectName?.trim() || null,
      vercelProjectUrl:
        body.vercelProjectUrl === undefined
          ? (vercelProjectName
              ? buildVercelProjectDashboardUrl(vercelProjectName, vercelTeamSlug)
              : current.vercelProjectUrl ?? null)
          : body.vercelProjectUrl?.trim() || null,
      vercelProductionUrl:
        body.vercelProductionUrl === undefined
          ? current.vercelProductionUrl ?? null
          : body.vercelProductionUrl?.trim() || null,
      vercelTeamSlug:
        body.vercelTeamSlug === undefined
          ? vercelTeamSlug
          : body.vercelTeamSlug?.trim() || null,
      lastVercelProvisionedAt:
        body.lastVercelProvisionedAt === undefined
          ? current.lastVercelProvisionedAt ?? null
          : body.lastVercelProvisionedAt ?? null,
      onboardingChecklist: checklist,
      status: nextRegionStatus(checklist),
      ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
    };

    await docRef.set(patch, { merge: true });
    await adminDb.collection("regionOnboardingAudit").add({
      action: "region_updated",
      regionCode: id.toUpperCase(),
      updates: Object.keys(body),
      ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
    });

    return NextResponse.json({
      id: id.toUpperCase(),
      region: {
        id: id.toUpperCase(),
        ...current,
        ...patch,
      },
    });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized", error?.message === "Super admin access required." ? 403 : 401);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSuperAdmin(request);
    const { id } = await params;
    const regionCode = id.toUpperCase();

    if (regionCode === "KL") {
      return NextResponse.json(
        { error: "The Kerala region cannot be deleted from HQ onboarding." },
        { status: 400 },
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const docRef = adminDb.collection("regions").doc(regionCode);
    const existing = await docRef.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Region not found." }, { status: 404 });
    }

    await Promise.all([
      docRef.delete(),
      adminDb.collection("regionConnections").doc(regionCode).delete().catch(() => undefined),
    ]);

    await adminDb.collection("regionOnboardingAudit").add({
      action: "region_deleted",
      regionCode,
      ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
    });

    return NextResponse.json({ ok: true, regionCode });
  } catch (error: any) {
    return unauthorizedResponse(
      error?.message || "Unauthorized",
      error?.message === "Super admin access required." ? 403 : 401,
    );
  }
}
