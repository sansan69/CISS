import { NextResponse } from "next/server";
import { requireAdminLike, unauthorizedResponse } from "@/lib/server/auth";
import { REGION_CODE } from "@/lib/runtime-config";

export async function POST() {
  try {
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

    return NextResponse.json({
      passed: allPassed,
      checks,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}
