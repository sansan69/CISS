import { NextResponse } from "next/server";
import * as admin from "firebase-admin";
import crypto from "crypto";

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

async function runDiagnosticFirestoreWrite(credentials: {
  firebaseProjectId: string;
  storageBucket?: string | null;
  serviceAccountJson: string;
}) {
  const serviceAccount = JSON.parse(credentials.serviceAccountJson) as admin.ServiceAccount;
  const appName = `readiness-diagnostic-${credentials.firebaseProjectId}-${crypto.randomUUID()}`;
  const app = admin.initializeApp(
    {
      credential: admin.credential.cert({
        ...serviceAccount,
        privateKey: serviceAccount.privateKey?.replace(/\\n/g, "\n"),
      }),
      projectId: credentials.firebaseProjectId,
      storageBucket: credentials.storageBucket || undefined,
    },
    appName,
  );

  try {
    const db = app.firestore();
    const docRef = db.collection("_diagnostics").doc(`readiness-${crypto.randomUUID()}`);
    const payload = {
      check: "region_readiness",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await docRef.set(payload);
    const snap = await docRef.get();
    await docRef.delete();

    return snap.exists;
  } finally {
    await app.delete().catch(() => undefined);
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

        try {
          const diagnosticPassed = await runDiagnosticFirestoreWrite({
            firebaseProjectId: connection.firebaseProjectId,
            storageBucket: connection.storageBucket,
            serviceAccountJson: connection.serviceAccountJson,
          });
          checks.push({
            checkId: "diagnostic_write",
            label: "Diagnostic Firestore write/read/delete",
            passed: diagnosticPassed,
            message: diagnosticPassed
              ? "Regional Firestore accepted a diagnostic write/read/delete."
              : "Diagnostic write did not round-trip successfully.",
          });
        } catch (error: unknown) {
          checks.push({
            checkId: "diagnostic_write",
            label: "Diagnostic Firestore write/read/delete",
            passed: false,
            message: `Diagnostic write failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
        }
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
