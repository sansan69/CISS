import { NextResponse } from "next/server";
import { isLegacyAdminEmail } from "@/lib/auth/admin";

export async function verifyRequestAuth(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  const { auth: adminAuth } = await import("@/lib/firebaseAdmin");
  return adminAuth.verifyIdToken(token);
}

export async function requireAdmin(request: Request) {
  const decodedToken = await verifyRequestAuth(request);
  const tokenEmail = typeof decodedToken.email === "string" ? decodedToken.email : undefined;

  if (
    decodedToken.admin !== true &&
    decodedToken.role !== "admin" &&
    !isLegacyAdminEmail(tokenEmail)
  ) {
    throw new Error("Admin access required.");
  }

  return decodedToken;
}

export function unauthorizedResponse(message: string, status = 401) {
  return NextResponse.json({ error: message }, { status });
}
