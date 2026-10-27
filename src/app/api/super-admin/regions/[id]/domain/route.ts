import { NextResponse } from "next/server";
import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerUpdateAudit } from "@/lib/server/audit";
import {
  addVercelDomain,
  deployRegionProject,
  upsertVercelEnvVar,
} from "@/lib/server/vercel-provisioner";
export const runtime = "nodejs";

function normalizeDomains(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,\n]/)
      : [];
  const domains = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    let host = value.trim().toLowerCase();
    if (!host) continue;
    if (host.includes("://")) {
      try {
        host = new URL(host).hostname;
      } catch {
        continue;
      }
    }
    host = (host.split("/")[0] ?? host).replace(/:\d+$/, "").replace(/\.$/, "");
    if (!/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
      continue;
    }
    domains.add(host);
  }
  return [...domains].slice(0, 20);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSuperAdmin(request);
    const { id } = await params;
    const regionCode = id.trim().toUpperCase();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as { domain?: string; domains?: string[] };

    const requested = normalizeDomains(body.domains ?? body.domain);
    if (requested.length === 0) {
      return NextResponse.json(
        { error: "Enter at least one valid domain (hostname only, e.g. ciss-tn.in)." },
        { status: 400 },
      );
    }

    const regionSnap = await adminDb.collection("regions").doc(regionCode).get();
    if (!regionSnap.exists) {
      return NextResponse.json({ error: "Region not found." }, { status: 404 });
    }

    const region = regionSnap.data() as {
      vercelProjectName?: string;
      allowedDomains?: string[];
      customDomain?: string | null;
    };
    const projectName = region.vercelProjectName;
    const dnsInstructions: string[] = [];
    const merged = [...new Set([...(region.allowedDomains ?? []), ...requested])];
    if (merged.length > 20) {
      return NextResponse.json(
        {
          error: `A region can be locked to at most 20 domains; this change would make ${merged.length}. Remove a domain first.`,
        },
        { status: 400 },
      );
    }

    // Register the domains on the regional Vercel project when one exists. The
    // lock itself is stored on the region record regardless, so an operator can
    // enroll domains before Vercel provisioning is complete.
    if (projectName) {
      for (const domain of requested) {
        try {
          await addVercelDomain(projectName, domain);
          dnsInstructions.push(
            `Add a CNAME record pointing "${domain}" to "${projectName}.vercel.app".`,
          );
        } catch (error) {
          dnsInstructions.push(
            `Could not add "${domain}" to Vercel automatically: ${
              error instanceof Error ? error.message : "unknown error"
            }. Add it manually in the Vercel project.`,
          );
        }
      }
    } else {
      dnsInstructions.push(
        "Domain saved on the region record. Provision the Vercel project to register it there.",
      );
    }

    if (projectName) {
      // The regional runtime reads REGION_ALLOWED_DOMAINS from its environment;
      // update it and redeploy so the host lock actually changes.
      try {
        await upsertVercelEnvVar(
          projectName,
          "REGION_ALLOWED_DOMAINS",
          merged.join(","),
        );
        await deployRegionProject(projectName);
        dnsInstructions.push(
          "The regional deployment was redeployed with the updated host lock.",
        );
      } catch (error) {
        dnsInstructions.push(
          `Domains saved, but the Vercel env/redeploy failed: ${
            error instanceof Error ? error.message : "unknown error"
          }. Set REGION_ALLOWED_DOMAINS=${merged.join(",")} manually and redeploy.`,
        );
      }
    }

    await adminDb.collection("regions").doc(regionCode).update({
      allowedDomains: merged,
      customDomain: region.customDomain || merged[0] || null,
      ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
    });

    await adminDb.collection("regionOnboardingAudit").add({
      action: "region_domains_locked",
      regionCode,
      domains: requested,
      ...buildServerUpdateAudit({ uid: actor.uid, email: actor.email }),
    });

    return NextResponse.json({
      success: true,
      domains: merged,
      added: requested,
      dnsInstructions,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to add domain";
    return unauthorizedResponse(message, message.includes("Super admin") ? 403 : 500);
  }
}
