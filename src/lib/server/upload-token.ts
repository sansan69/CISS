import crypto from "node:crypto";

const DEFAULT_SECRET = "ciss-attendance-upload-secret-2026";

function getSecret(): string {
  const secret = process.env.UPLOAD_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("UPLOAD_TOKEN_SECRET or NEXTAUTH_SECRET must be configured.");
  }
  return DEFAULT_SECRET;
}

export interface UploadTokenPayload {
  employeeDocId: string;
  siteId: string;
  attemptId: string;
  exp: number;
}

/**
 * Generate a short-lived upload token for public attendance photo uploads.
 * Token format: base64(jsonPayload).base64(hmacSignature)
 */
export function generateUploadToken(
  employeeDocId: string,
  siteId: string,
  attemptId: string,
  ttlSeconds = 300,
): string {
  const payload: UploadTokenPayload = {
    employeeDocId,
    siteId,
    attemptId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a short-lived upload token. Returns the payload if valid, null otherwise.
 */
export function verifyUploadToken(token: string): UploadTokenPayload | null {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return null;

    const expectedSig = crypto
      .createHmac("sha256", getSecret())
      .update(payloadB64)
      .digest("base64url");

    if (!crypto.timingSafeEqual(Buffer.from(sig, "base64url"), Buffer.from(expectedSig, "base64url"))) {
      return null;
    }

    const payload: UploadTokenPayload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    );

    if (
      typeof payload.employeeDocId !== "string" ||
      !payload.employeeDocId ||
      typeof payload.siteId !== "string" ||
      !payload.siteId ||
      typeof payload.attemptId !== "string" ||
      !payload.attemptId ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null; // expired
    }

    return payload;
  } catch {
    return null;
  }
}
