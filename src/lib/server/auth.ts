import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { isLegacyAdminEmail } from "@/lib/auth/admin";

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

export async function verifyRequestAuth(request: Request): Promise<AppDecodedToken> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  const { auth: adminAuth } = await import("@/lib/firebaseAdmin");
  return adminAuth.verifyIdToken(token) as Promise<AppDecodedToken>;
}

export function hasAdminAccess(decodedToken: Pick<AppDecodedToken, "admin" | "role" | "email">) {
  const tokenEmail =
    typeof decodedToken.email === "string" ? decodedToken.email : undefined;

  const isLegacy = isLegacyAdminEmail(tokenEmail);
  if (isLegacy) {
    console.warn(
      `[auth] Legacy admin email access used for ${tokenEmail}. ` +
      `Migrate to custom claims (role: "admin" or "superAdmin"). ` +
      `Set DISABLE_LEGACY_ADMIN_EMAILS=true to disable this path.`,
    );
  }

  const legacyDisabled =
    process.env.DISABLE_LEGACY_ADMIN_EMAILS === "true";

  return (
    decodedToken.admin === true ||
    decodedToken.role === "admin" ||
    decodedToken.role === "superAdmin" ||
    (isLegacy && !legacyDisabled)
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
