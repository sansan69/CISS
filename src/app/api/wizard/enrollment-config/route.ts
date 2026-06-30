import { NextResponse } from "next/server";
import { requireAdminLike, unauthorizedResponse } from "@/lib/server/auth";
import { DEFAULT_ENROLLMENT_FORM_CONFIG } from "@/lib/region-wizard";

export async function GET() {
  try {
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const configSnap = await adminDb.collection("enrollmentFormConfig").doc("global").get();
    if (configSnap.exists) {
      return NextResponse.json({ config: configSnap.data() });
    }
    return NextResponse.json({ config: DEFAULT_ENROLLMENT_FORM_CONFIG, source: "defaults" });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

export async function PUT(request: Request) {
  try {
    await requireAdminLike(await (await import("@/lib/server/auth")).verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = await request.json();
    await adminDb.collection("enrollmentFormConfig").doc("global").set(body.config, { merge: true });
    await adminDb.collection("regionSetupProgress").doc("default").set(
      { steps: { enrollmentConfig: true } },
      { merge: true },
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}
