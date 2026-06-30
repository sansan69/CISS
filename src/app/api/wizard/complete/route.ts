import { NextResponse } from "next/server";
import { requireAdminLike, unauthorizedResponse } from "@/lib/server/auth";

export async function POST() {
  try {
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    await adminDb.collection("regionSetupProgress").doc("default").set({
      setupComplete: true,
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
