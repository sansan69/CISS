import { NextResponse } from "next/server";
import * as admin from "firebase-admin";
import crypto from "crypto";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { validateRegionFirebaseConnection } from "@/lib/server/region-onboarding";
import { getRegionConnection } from "@/lib/server/region-connections";
import { buildRegionVercelProjectName } from "@/lib/vercel-region";
import type { ReadinessCheckResult, ReadinessSummary } from "@/types/region";
export const runtime = "nodejs";

const PROBE_TIMEOUT_MS = 5_000;

/** Hostname suffixes that resolve to internal/infrastructure addresses. */
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".home.arpa",
  ".in-addr.arpa",
  ".ip6.arpa",
];

/**
 * Reject hosts that cannot be a public deployment URL. A region's
 * `vercelProductionUrl` comes from a stored document, so it is attacker-
 * influenceable state rather than trusted configuration: probing it with no
 * validation turns this readiness check into an SSRF-style reachability oracle
 * against metadata endpoints, loopback, and private networks.
 *
 * IP literals are rejected outright (Vercel/custom domains are hostnames), as
 * are internal suffixes and non-default ports. DNS rebinding is out of scope
 * for a fetch-only probe; blocking literals and internal names covers the
 * predictable cases.
 */
function isPrivateOrReservedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!host) return true;
  if (host === "localhost" || host === "metadata.google.internal") return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // IPv6 literals arrive bracketed and contain colons after normalisation.
  if (host.includes(":")) return true;
  // IPv4 literal — reject every literal rather than enumerate private ranges.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  return false;
}

/**
 * Validate a stored deployment URL before it is fetched.
 *
 * @returns the parsed URL, or `null` when the value is not a public https URL.
 */
function validatedPublicHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    if (!url.hostname.includes(".")) return null;
    if (isPrivateOrReservedHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

type ProbeResult = { reachable: boolean; invalidUrl?: boolean };

async function probeUrl(rawUrl: string): Promise<ProbeResult> {
  const url = validatedPublicHttpsUrl(rawUrl);
  if (!url) return { reachable: false, invalidUrl: true };
  try {
    const res = await fetch(url.toString(), {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return { reachable: res.status >= 200 && res.status < 400 };
  } catch {
    return { reachable: false };
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

    // 3. Vercel URL check. The stored URL is validated (public https only,
    // timeout + manual redirect) before any outbound request is made.
    const vercelProductionUrl = region.vercelProductionUrl as string | undefined;
    if (vercelProductionUrl) {
      const probe = await probeUrl(vercelProductionUrl);
      checks.push({
        checkId: "vercel_url",
        label: "Vercel deployment URL",
        passed: probe.reachable,
        message: probe.reachable
          ? `Deployment responds at ${vercelProductionUrl}`
          : probe.invalidUrl
            ? "Configured deployment URL is not a public https URL. Probe skipped — set a valid production URL."
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
