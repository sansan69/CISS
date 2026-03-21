import { NextResponse } from "next/server";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerUpdateAudit } from "@/lib/server/audit";
import {
  mergeChecklist,
  nextRegionStatus,
  validateRegionFirebaseConnection,
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

    const result = await validateRegionFirebaseConnection({
      firebaseProjectId: region.firebaseProjectId,
      storageBucket: region.storageBucket,
      serviceAccountJson: body.serviceAccountJson,
      serviceAccountBase64: body.serviceAccountBase64,
    });

    const checklist = mergeChecklist(region.onboardingChecklist, {
      metadataSaved: true,
      firebaseValidated: result.success,
      lastValidatedAt: new Date(),
    });

    await docRef.set(
      {
        onboardingChecklist: checklist,
        status: nextRegionStatus(checklist),
        validationSummary: {
          checks: result.checks,
          messages: result.messages,
          validatedAt: new Date(),
        },
        ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
      },
      { merge: true },
    );

    await adminDb.collection("regionOnboardingAudit").add({
      action: "region_validated",
      regionCode: id.toUpperCase(),
      success: result.success,
      checks: result.checks,
      ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
    });

    return NextResponse.json(result);
  } catch (error: any) {
    const status = error?.message === "Region not found." ? 404 : error?.message === "Super admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
