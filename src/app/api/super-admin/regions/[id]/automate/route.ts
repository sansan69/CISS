import { NextResponse } from "next/server";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { startAutomation, getAutomationJob } from "@/lib/server/region-automator";
import { getRegionConnection } from "@/lib/server/region-connections";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSuperAdmin(request);
    const { id } = await params;
    const regionCode = id.trim().toUpperCase();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const regionSnap = await adminDb.collection("regions").doc(regionCode).get();
    if (!regionSnap.exists) {
      return NextResponse.json({ error: "Region not found." }, { status: 404 });
    }

    const region = regionSnap.data() as Record<string, unknown>;

    let serviceAccountJson: string | null = null;
    try {
      const connection = await getRegionConnection(adminDb, regionCode);
      if (connection) {
        serviceAccountJson = connection.serviceAccountJson;
      }
    } catch {
      // Service account not available — some steps will be skipped
    }

    const job = await startAutomation(
      adminDb,
      region as any,
      serviceAccountJson,
      { uid: actor.uid, email: actor.email },
    );

    // Update region record with job reference
    await adminDb.collection("regions").doc(regionCode).update({
      automationJobId: job.id,
      status: "config_pending",
    });

    return NextResponse.json({ job });
  } catch (error: any) {
    return unauthorizedResponse(
      error?.message || "Unauthorized",
      error?.message === "Super admin access required." ? 403 : 401,
    );
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
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const regionSnap = await adminDb.collection("regions").doc(regionCode).get();
    if (!regionSnap.exists) {
      return NextResponse.json({ error: "Region not found." }, { status: 404 });
    }

    const region = regionSnap.data() as { automationJobId?: string };
    if (!region.automationJobId) {
      return NextResponse.json({ job: null });
    }

    const job = await getAutomationJob(adminDb, region.automationJobId);
    return NextResponse.json({ job });
  } catch (error: any) {
    return unauthorizedResponse(
      error?.message || "Unauthorized",
      error?.message === "Super admin access required." ? 403 : 401,
    );
  }
}
