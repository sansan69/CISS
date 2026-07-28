import crypto from "node:crypto";

export const ENROLLMENT_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
export const ENROLLMENT_DRAFT_MAX_UPLOADS = 20;

export function createEnrollmentDraftToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashEnrollmentDraftToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function enrollmentDraftTokenMatches(token: string, expectedHash: unknown) {
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
    return false;
  }

  const actual = Buffer.from(hashEnrollmentDraftToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
