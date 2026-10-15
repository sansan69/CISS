import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import {
  isDesignatedAadhaarAdministrator,
} from "@/lib/aadhaar-admin-policy";

export { AADHAAR_ADMIN_EMAIL } from "@/lib/aadhaar-admin-policy";

export type AppDecodedToken = DecodedIdToken & {
  admin?: boolean;
  role?: string;
  stateCode?: string;
  assignedDistricts?: string[];
  clientId?: string;
  clientName?: string;
  employeeId?: string;
  employeeDocId?: string;
};

export async function verifyRequestAuth(
  request: Request,
  checkRevoked = false,
): Promise<AppDecodedToken> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  const { auth: adminAuth } = await import("@/lib/firebaseAdmin");
  return adminAuth.verifyIdToken(token, checkRevoked) as Promise<AppDecodedToken>;
}

export function hasAdminAccess(decodedToken: Pick<AppDecodedToken, "admin" | "role" | "email">) {
  return (
    decodedToken.admin === true ||
    decodedToken.role === "admin" ||
    decodedToken.role === "superAdmin"
  );
}

export function hasFieldOfficerAccess(decodedToken: Pick<AppDecodedToken, "role">) {
  return decodedToken.role === "fieldOfficer";
}

export function hasClientAccess(decodedToken: Pick<AppDecodedToken, "role">) {
  return decodedToken.role === "client";
}

export function requireAdminLike(decodedToken: AppDecodedToken) {
  if (!hasAdminAccess(decodedToken)) {
    throw new Error("Admin access required.");
  }
  return decodedToken;
}

export function requireAdminOrFieldOfficer(decodedToken: AppDecodedToken) {
  if (!hasAdminAccess(decodedToken) && !hasFieldOfficerAccess(decodedToken)) {
    throw new Error("Field officer or admin access required.");
  }
  return decodedToken;
}

export async function requireAdmin(request: Request) {
  const decodedToken = await verifyRequestAuth(request);
  return requireAdminLike(decodedToken);
}

/**
 * Aadhaar access is intentionally narrower than ordinary administrator access.
 * Keep this check server-side: client-side role or email checks are UX only.
 */
export function requireAadhaarAdministratorToken(decodedToken: AppDecodedToken) {
  if (!isDesignatedAadhaarAdministrator({
    email: decodedToken.email,
    emailVerified: decodedToken.email_verified,
    role: decodedToken.role,
    admin: decodedToken.admin,
  })) {
    throw new Error("Aadhaar administrator access required.");
  }

  return decodedToken;
}

export async function requireAadhaarAdministrator(request: Request) {
  const decodedToken = await verifyRequestAuth(request, true);
  return requireAadhaarAdministratorToken(decodedToken);
}

export async function requireSuperAdmin(request: Request) {
  const decodedToken = await verifyRequestAuth(request);
  if (decodedToken.role !== "superAdmin") {
    throw new Error("Super admin access required.");
  }
  return decodedToken;
}

export async function requireScopedAdmin(request: Request) {
  const decodedToken = await verifyRequestAuth(request);
  if (!hasAdminAccess(decodedToken)) {
    throw new Error("Admin access required.");
  }
  return {
    ...decodedToken,
    scope: {
      stateCode: decodedToken.stateCode ?? undefined,
      assignedDistricts: decodedToken.assignedDistricts ?? undefined,
    },
  };
}

export function unauthorizedResponse(message: string, status = 401) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Firebase Admin error codes that mean the caller's session is unusable rather
 * than the request being faulty.
 */
const sessionErrorCodes = new Set([
  "auth/argument-error",
  "auth/invalid-id-token",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/user-disabled",
  "auth/user-not-found",
]);

/**
 * True when [error] came from a missing or invalid caller session. Routes use
 * this to answer 401 instead of reporting a server fault (500) for what is
 * simply an unauthenticated request.
 */
export function isAuthFailure(error: unknown): boolean {
  const candidate = error as { message?: unknown; code?: unknown } | null;
  const message = typeof candidate?.message === "string" ? candidate.message : "";
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  return message.includes("Missing bearer token") || sessionErrorCodes.has(code);
}
