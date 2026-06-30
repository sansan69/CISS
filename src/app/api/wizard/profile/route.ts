import { NextResponse } from "next/server";
import { requireAdminLike, unauthorizedResponse } from "@/lib/server/auth";
import { REGION_CODE, REGION_NAME } from "@/lib/runtime-config";
import { DEFAULT_SETUP_PROGRESS } from "@/lib/region-wizard";

export async function GET() {
  try {
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const configSnap = await adminDb.collection("systemConfig").doc("runtime").get();
    if (!configSnap.exists) {
      return NextResponse.json({ error: "System config not found. Seed defaults first." }, { status: 404 });
    }
    const config = configSnap.data() as Record<string, unknown>;

    const progressSnap = await adminDb.collection("regionSetupProgress").doc("default").get();
    const progress = progressSnap.exists
      ? (progressSnap.data() as Record<string, unknown>)
      : DEFAULT_SETUP_PROGRESS;

    return NextResponse.json({
      regionCode: REGION_CODE,
      regionName: REGION_NAME,
      setupComplete: progress.setupComplete ?? false,
      setupProgress: progress,
      identity: config,
    });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireAdminLike(await (await import("@/lib/server/auth")).verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as {
      regionName?: string;
      timezone?: string;
    };

    const updates: Record<string, unknown> = {};
    if (body.regionName?.trim()) updates.regionName = body.regionName.trim();
    if (body.timezone?.trim()) updates.timezone = body.timezone.trim();

    if (Object.keys(updates).length > 0) {
      await adminDb.collection("systemConfig").doc("runtime").set(updates, { merge: true });
    }

    await adminDb.collection("regionSetupProgress").doc("default").set(
      { steps: { profile: true }, startedAt: new Date().toISOString() },
      { merge: true },
    );

    return NextResponse.json({ success: true, updates });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}
