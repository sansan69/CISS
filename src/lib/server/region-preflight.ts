import type { PreflightCheckResult, PreflightSummary } from "@/types/region";

function now(): string {
  return new Date().toISOString();
}

export async function runPreflightChecks(
  firebaseProjectId: string,
  regionCode: string,
): Promise<PreflightSummary> {
  const checks: PreflightCheckResult[] = [];

  // 1. GCP OAuth token reachable
  let gcpAccess = false;
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    gcpAccess = Boolean(token?.token);
    checks.push({
      checkId: "gcp_access_token",
      label: "GCP OAuth2 access token",
      passed: gcpAccess,
      message: gcpAccess ? "Successfully obtained GCP access token" : "Failed to get access token. Check HQ service account credentials.",
    });
  } catch (error: unknown) {
    checks.push({
      checkId: "gcp_access_token",
      label: "GCP OAuth2 access token",
      passed: false,
      message: `Failed to get access token: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }

  // 2. Firebase Management API reachable
  if (gcpAccess) {
    try {
      const { getAvailableProjects } = await import("@/lib/server/firebase-management-client");
      const projects = await getAvailableProjects();
      const projectExists = projects.some((p: string) => p === `projects/${firebaseProjectId}`);
      checks.push({
        checkId: "firebase_api_reachable",
        label: "Firebase Management API reachable",
        passed: true,
        message: projectExists
          ? `Project "${firebaseProjectId}" found. Use "add Firebase" to attach services.`
          : `Project "${firebaseProjectId}" not found. It may already have Firebase or need creation.`,
      });
    } catch (error: unknown) {
      checks.push({
        checkId: "firebase_api_reachable",
        label: "Firebase Management API reachable",
        passed: false,
        message: `Firebase API call failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  } else {
    checks.push({
      checkId: "firebase_api_reachable",
      label: "Firebase Management API reachable",
      passed: false,
      message: "Skipped — no GCP access token available.",
    });
  }

  // 3. Vercel token
  const vercelToken = process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN;
  let vercelValid = false;
  if (vercelToken) {
    try {
      const res = await fetch("https://api.vercel.com/v9/user", {
        headers: { Authorization: `Bearer ${vercelToken}` },
      });
      vercelValid = res.ok;
    } catch { vercelValid = false; }
  }
  checks.push({
    checkId: "vercel_token",
    label: "Vercel API token",
    passed: vercelValid,
    message: vercelValid ? "Vercel token is valid" : "VERCEL_TOKEN is not configured or invalid.",
  });

  // 4. REGION_CONNECTIONS_SECRET
  const hasSecret = Boolean(process.env.REGION_CONNECTIONS_SECRET);
  checks.push({
    checkId: "region_connections_secret",
    label: "REGION_CONNECTIONS_SECRET",
    passed: hasSecret,
    message: hasSecret ? "Encryption key is configured" : "REGION_CONNECTIONS_SECRET is not set. Cross-region connections will fail.",
  });

  // 5. Firebase Admin SDK configured
  const hasAdminSdk = Boolean(
    process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64 ||
    process.env.FIREBASE_ADMIN_SDK_CONFIG ||
    process.env.FIREBASE_ADMIN_PRIVATE_KEY,
  );
  checks.push({
    checkId: "firebase_admin_sdk",
    label: "Firebase Admin SDK configured",
    passed: hasAdminSdk,
    message: hasAdminSdk ? "Admin SDK credentials found" : "No Admin SDK credentials configured.",
  });

  // 6. Project ID format
  const projectIdValid = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(firebaseProjectId);
  checks.push({
    checkId: "project_id_format",
    label: "Project ID format",
    passed: projectIdValid,
    message: projectIdValid
      ? `Project ID "${firebaseProjectId}" is valid`
      : `Invalid project ID "${firebaseProjectId}". Must be 6-30 chars, lowercase, start with letter.`,
  });

  // 7. Region code format
  const codeValid = /^[A-Z]{2,5}$/.test(regionCode);
  checks.push({
    checkId: "region_code_format",
    label: "Region code format",
    passed: codeValid,
    message: codeValid ? `Region code "${regionCode}" is valid` : `Invalid region code "${regionCode}". Must be 2-5 uppercase letters.`,
  });

  return {
    allPassed: checks.every((c) => c.passed),
    checks,
    validatedAt: now(),
  };
}
