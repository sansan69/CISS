import { NextResponse } from "next/server";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { retryAutomationStep } from "@/lib/server/region-automator";
import { getRegionConnection } from "@/lib/server/region-connections";
import type { RegionRecord } from "@/types/region";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSuperAdmin(request);
    const { id } = await params;
    const regionCode = id.trim().toUpperCase();
    const body = (await request.json().catch(() => ({}))) as {
      jobId?: string;
      stepIndex?: number;
    };

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const regionSnap = await adminDb.collection("regions").doc(regionCode).get();
    if (!regionSnap.exists) {
      return NextResponse.json({ error: "Region not found." }, { status: 404 });
    }

    const region = regionSnap.data() as RegionRecord;
    const jobId = body.jobId || region.automationJobId;
    if (!jobId) {
      return NextResponse.json({ error: "No automation job exists for this region." }, { status: 400 });
    }

    const stepIndex = Number.isInteger(body.stepIndex) ? Number(body.stepIndex) : 0;
    if (stepIndex < 0) {
      return NextResponse.json({ error: "Invalid retry step index." }, { status: 400 });
    }

    let serviceAccountJson: string | null = null;
    const connection = await getRegionConnection(adminDb, regionCode).catch(() => null);
    if (connection) serviceAccountJson = connection.serviceAccountJson;

    const job = await retryAutomationStep(
      adminDb,
      jobId,
      { ...region, id: regionCode, regionCode },
      serviceAccountJson,
      stepIndex,
      { uid: actor.uid, email: actor.email },
    );

    if (!job) {
      return NextResponse.json({ error: "Automation job not found." }, { status: 404 });
    }

    await adminDb.collection("regions").doc(regionCode).set(
      {
        automationJobId: job.id,
        status: "config_pending",
      },
      { merge: true },
    );

    return NextResponse.json({ job });
  } catch (error: any) {
    return unauthorizedResponse(
      error?.message || "Unauthorized",
      error?.message === "Super admin access required." ? 403 : 401,
    );
  }
}
