import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";

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

export const AADHAAR_ADMIN_EMAIL = "admin@cisskerala.app";

/**
 * Aadhaar access is intentionally narrower than ordinary administrator access.
 * Keep this check server-side: client-side role or email checks are UX only.
 */
export function requireAadhaarAdministratorToken(decodedToken: AppDecodedToken) {
  const normalizedEmail = decodedToken.email?.trim().toLowerCase();
  const hasAdministratorClaim =
    decodedToken.admin === true || decodedToken.role === "admin";

  if (
    normalizedEmail !== AADHAAR_ADMIN_EMAIL ||
    decodedToken.email_verified !== true ||
    !hasAdministratorClaim
  ) {
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
