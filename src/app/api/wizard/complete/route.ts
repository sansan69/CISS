import { NextResponse } from "next/server";
import { requireAdminLike, unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireAdminLike(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const progressSnap = await adminDb.collection("regionSetupProgress").doc("default").get();
    const progress = progressSnap.data() as { steps?: Record<string, boolean> } | undefined;
    const requiredSteps = ["profile", "districts", "enrollmentConfig", "clients", "fieldOfficers", "verify"];
    const missingSteps = requiredSteps.filter((step) => progress?.steps?.[step] !== true);

    if (missingSteps.length > 0) {
      return NextResponse.json(
        { error: `Complete the remaining setup steps first: ${missingSteps.join(", ")}` },
        { status: 400 },
      );
    }

    await adminDb.collection("regionSetupProgress").doc("default").set({
      setupComplete: true,
      currentStep: 6,
      completedAt: new Date().toISOString(),
      steps: {
        profile: true,
        districts: true,
        enrollmentConfig: true,
        clients: true,
        fieldOfficers: true,
        verify: true,
      },
    }, { merge: true });

    await adminDb.collection("systemConfig").doc("runtime").set({
      setupComplete: true,
      setupCompletedAt: new Date().toISOString(),
    }, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}
