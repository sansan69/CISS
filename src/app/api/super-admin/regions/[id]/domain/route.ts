import { NextResponse } from "next/server";
import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { addVercelDomain } from "@/lib/server/vercel-provisioner";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSuperAdmin(request);
    const { id } = await params;
    const regionCode = id.trim().toUpperCase();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as { domain?: string };

    if (!body.domain?.trim()) {
      return NextResponse.json({ error: "Domain is required." }, { status: 400 });
    }

    const regionSnap = await adminDb.collection("regions").doc(regionCode).get();
    if (!regionSnap.exists) {
      return NextResponse.json({ error: "Region not found." }, { status: 404 });
    }

    const region = regionSnap.data() as { vercelProjectName?: string };
    const projectName = region.vercelProjectName;

    if (!projectName) {
      return NextResponse.json({ error: "Vercel project not created yet. Provision Vercel first." }, { status: 400 });
    }

    const domain = body.domain.trim().toLowerCase();
    await addVercelDomain(projectName, domain);

    await adminDb.collection("regions").doc(regionCode).update({
      customDomain: domain,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.uid,
    });

    return NextResponse.json({
      success: true,
      domain,
      dnsInstruction: `Add a CNAME record pointing "${domain}" to "${projectName}.vercel.app".`,
    });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Failed to add domain", 500);
  }
}
