import { NextResponse } from "next/server";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerUpdateAudit } from "@/lib/server/audit";
import {
  createRegionAdminAccount,
  mergeChecklist,
  nextRegionStatus,
} from "@/lib/server/region-onboarding";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSuperAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const docRef = adminDb.collection("regions").doc(id.toUpperCase());
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: "Region not found." }, { status: 404 });
    }

    const region = doc.data() as Record<string, any>;
    const body = (await request.json()) as {
      serviceAccountJson?: string;
      serviceAccountBase64?: string;
      adminEmail?: string;
      adminPassword?: string;
      adminDisplayName?: string | null;
    };

    if (!body.adminEmail?.trim() || !body.adminPassword?.trim()) {
      return NextResponse.json(
        { error: "adminEmail and adminPassword are required." },
        { status: 400 },
      );
    }

    const created = await createRegionAdminAccount(
      {
        firebaseProjectId: region.firebaseProjectId,
        storageBucket: region.storageBucket,
        serviceAccountJson: body.serviceAccountJson,
        serviceAccountBase64: body.serviceAccountBase64,
      },
      {
        regionCode: region.regionCode,
        regionName: region.regionName,
      },
      {
        email: body.adminEmail.trim(),
        password: body.adminPassword.trim(),
        displayName: body.adminDisplayName?.trim() || null,
      },
    );

    const checklist = mergeChecklist(region.onboardingChecklist, {
      metadataSaved: true,
      regionAdminCreated: true,
      lastAdminCreatedAt: new Date(),
    });

    await docRef.set(
      {
        regionAdminEmail: body.adminEmail.trim(),
        onboardingChecklist: checklist,
        status: nextRegionStatus(checklist),
        lastRegionAdminUid: created.uid,
        ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
      },
      { merge: true },
    );

    await adminDb.collection("regionOnboardingAudit").add({
      action: "region_admin_created",
      regionCode: id.toUpperCase(),
      adminEmail: body.adminEmail.trim(),
      uid: created.uid,
      created: created.created,
      ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
    });

    return NextResponse.json(created);
  } catch (error: any) {
    const status =
      error?.message === "Region not found."
        ? 404
        : error?.message === "Super admin access required."
          ? 403
          : error instanceof SyntaxError || /service account/i.test(error?.message || "")
            ? 400
            : 500;
    return NextResponse.json(
      { error: error?.message || "Could not create the region admin." },
      { status },
    );
  }
}
