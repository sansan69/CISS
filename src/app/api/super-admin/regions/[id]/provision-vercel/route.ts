import { NextResponse } from "next/server";
import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerUpdateAudit } from "@/lib/server/audit";
import { buildRegionEnvConfig, ensureVercelProject, setVercelEnvVars, getVercelProjectHealth } from "@/lib/server/vercel-provisioner";

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

    const region = { id: regionSnap.id, ...regionSnap.data() } as Record<string, unknown>;

    const project = await ensureVercelProject(region as any);
    const envVars = await buildRegionEnvConfig(region as any);

    if (!project.alreadyExisted) {
      await setVercelEnvVars(project.projectName, envVars);
    }

    const health = await getVercelProjectHealth(project.projectName);

    await adminDb.collection("regions").doc(regionCode).update({
      vercelProjectName: project.projectName,
      vercelProjectUrl: project.projectUrl,
      vercelProductionUrl: project.productionUrl,
      lastVercelProvisionedAt: new Date().toISOString(),
      ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
    });

    return NextResponse.json({
      project: {
        name: project.projectName,
        url: project.projectUrl,
        productionUrl: project.productionUrl,
        alreadyExisted: project.alreadyExisted,
        envVarsSet: Object.keys(envVars).length,
      },
      health,
    });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Provisioning failed", 500);
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
    const region = regionSnap.data() as Record<string, unknown>;
    const projectName = region.vercelProjectName as string;

    if (!projectName) {
      return NextResponse.json({ health: null, message: "No Vercel project created yet." });
    }

    const health = await getVercelProjectHealth(projectName);
    return NextResponse.json({ health });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Failed to check Vercel health", 500);
  }
}
