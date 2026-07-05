import { NextResponse } from "next/server";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { getAutomationJob } from "@/lib/server/region-automator";
export const runtime = "nodejs";

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

    const region = regionSnap.data() as { automationJobId?: string | null };
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
