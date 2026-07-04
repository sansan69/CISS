import { NextResponse } from "next/server";
import { requireAdminLike, unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    await requireAdminLike(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const checks: Record<string, boolean> = {};

    try {
      const districtSnap = await adminDb.collection("districts").limit(1).get();
      checks.districts = !districtSnap.empty;
    } catch { checks.districts = false; }

    try {
      const clientSnap = await adminDb.collection("clients").limit(1).get();
      checks.clients = !clientSnap.empty;
    } catch { checks.clients = false; }

    try {
      const foSnap = await adminDb.collection("fieldOfficers").limit(1).get();
      checks.fieldOfficers = !foSnap.empty;
    } catch { checks.fieldOfficers = false; }

    try {
      const configSnap = await adminDb.collection("enrollmentFormConfig").doc("global").get();
      checks.enrollmentConfig = configSnap.exists;
    } catch { checks.enrollmentConfig = false; }

    try {
      const runtimeSnap = await adminDb.collection("systemConfig").doc("runtime").get();
      checks.runtimeConfig = runtimeSnap.exists;
    } catch { checks.runtimeConfig = false; }

    const allPassed = Object.values(checks).every(Boolean);
    const errors = Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key);

    if (allPassed) {
      await adminDb.collection("regionSetupProgress").doc("default").set(
        { steps: { verify: true }, currentStep: 5 },
        { merge: true },
      );
    }

    return NextResponse.json({
      passed: allPassed,
      checks,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}
