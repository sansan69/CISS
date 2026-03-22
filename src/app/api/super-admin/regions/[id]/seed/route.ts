import { NextResponse } from "next/server";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerUpdateAudit } from "@/lib/server/audit";
import { saveRegionConnection } from "@/lib/server/region-connections";
import {
  mergeChecklist,
  nextRegionStatus,
  seedRegionDefaults,
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
    };

    const seeded = await seedRegionDefaults(
      {
        firebaseProjectId: region.firebaseProjectId,
        storageBucket: region.storageBucket,
        serviceAccountJson: body.serviceAccountJson,
        serviceAccountBase64: body.serviceAccountBase64,
      },
      {
        regionCode: region.regionCode,
        regionName: region.regionName,
        firebaseProjectId: region.firebaseProjectId,
      },
      { uid: actor.uid, email: actor.email },
    );

    const connectionSaved = await saveRegionConnection(
      adminDb,
      {
        regionCode: id.toUpperCase(),
        firebaseProjectId: region.firebaseProjectId,
        storageBucket: region.storageBucket,
        serviceAccountJson: body.serviceAccountJson,
        serviceAccountBase64: body.serviceAccountBase64,
      },
      { uid: actor.uid, email: actor.email },
    );

    const checklist = mergeChecklist(region.onboardingChecklist, {
      metadataSaved: true,
      defaultsSeeded: true,
      lastSeededAt: new Date(),
    });

    await docRef.set(
      {
        onboardingChecklist: checklist,
        status: nextRegionStatus(checklist),
        seededDocs: seeded.seededDocs,
        ...(connectionSaved
          ? {
              persistentConnectionReady: true,
              lastConnectionSavedAt: new Date(),
            }
          : {}),
        ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
      },
      { merge: true },
    );

    await adminDb.collection("regionOnboardingAudit").add({
      action: "region_seeded",
      regionCode: id.toUpperCase(),
      seededDocs: seeded.seededDocs,
      ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
    });

    return NextResponse.json(seeded);
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
      { error: error?.message || "Could not seed the region backend." },
      { status },
    );
  }
}
