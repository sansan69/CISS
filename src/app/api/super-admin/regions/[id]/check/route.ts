import { NextResponse } from "next/server";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { validateRegionFirebaseConnection } from "@/lib/server/region-onboarding";
import { getRegionConnection } from "@/lib/server/region-connections";
import { buildRegionVercelProjectName } from "@/lib/vercel-region";
import type { ReadinessCheckResult, ReadinessSummary } from "@/types/region";

async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
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
    const checks: ReadinessCheckResult[] = [];

    // 1. Firestore check via region connection
    let firestoreReachable = false;
    let authReachable = false;
    let storageReachable = false;

    try {
      const connection = await getRegionConnection(adminDb, regionCode);
      if (connection) {
        const credentials = {
          firebaseProjectId: connection.firebaseProjectId,
          storageBucket: connection.storageBucket || undefined,
          serviceAccountJson: connection.serviceAccountJson,
        };

        const validation = await validateRegionFirebaseConnection(credentials);
        firestoreReachable = validation.checks.firestoreReachable;
        authReachable = validation.checks.authReachable;
        storageReachable = connection.storageBucket ? validation.checks.storageReachable : true;

        checks.push({
          checkId: "firestore",
          label: "Firestore reachable",
          passed: firestoreReachable,
          message: firestoreReachable ? "Firestore is reachable" : "Firestore is not reachable. Check the Firestore Database page in Firebase Console.",
        });

        checks.push({
          checkId: "auth",
          label: "Firebase Auth reachable",
          passed: authReachable,
          message: authReachable ? "Auth is reachable" : "Auth is not reachable. Enable Email/Password sign-in in Firebase Console > Authentication.",
        });

        checks.push({
          checkId: "storage",
          label: "Cloud Storage reachable",
          passed: storageReachable,
          message: storageReachable ? "Storage is reachable" : "Storage is not reachable or not configured.",
        });
      } else {
        checks.push({
          checkId: "connection",
          label: "Region connection",
          passed: false,
          message: "No service account credentials saved. Upload the service account in the state management UI.",
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      checks.push({
        checkId: "firebase_connection",
        label: "Firebase connection",
        passed: false,
        message: `Failed to connect: ${message}`,
      });
    }

    // 3. Vercel URL check
    const vercelProductionUrl = region.vercelProductionUrl as string | undefined;
    if (vercelProductionUrl) {
      const urlReachable = await probeUrl(vercelProductionUrl);
      checks.push({
        checkId: "vercel_url",
        label: "Vercel deployment URL",
        passed: urlReachable,
        message: urlReachable
          ? `Deployment responds at ${vercelProductionUrl}`
          : `Deployment at ${vercelProductionUrl} is not responding. Check Vercel dashboard.`,
      });
    } else {
      checks.push({
        checkId: "vercel_url",
        label: "Vercel deployment URL",
        passed: false,
        message: "No Vercel production URL configured. Run Vercel provisioning first.",
      });
    }

    // 4. Admin email
    const adminEmail = region.regionAdminEmail as string | undefined;
    checks.push({
      checkId: "admin_email",
      label: "Admin email configured",
      passed: Boolean(adminEmail),
      message: adminEmail ? `Admin email: ${adminEmail}` : "No admin email set for this region.",
    });

    // 5. Region record status
    const status = region.status as string;
    checks.push({
      checkId: "region_status",
      label: "Region status",
      passed: status === "live" || status === "ready",
      message: status === "live" || status === "ready"
        ? `Region status is "${status}"`
        : `Region status is "${status}". Complete onboarding steps first.`,
    });

    const healthy = checks.every((c) => c.passed);
    const summary: ReadinessSummary = {
      healthy,
      regionCode,
      checks,
      checkedAt: new Date().toISOString(),
    };

    return NextResponse.json({ summary });
  } catch (error: any) {
    return unauthorizedResponse(
      error?.message || "Unauthorized",
      error?.message === "Super admin access required." ? 403 : 401,
    );
  }
}
