import crypto from "node:crypto";

const DEVELOPMENT_SECRET = "ciss-attendance-verification-development-only";

export type AttendanceIdentificationMethod =
  | "qr"
  | "phone"
  | "employeeId"
  | "authenticated";

export type AttendanceVerificationTokenPayload = {
  employeeDocId: string;
  method: AttendanceIdentificationMethod;
  nonce: string;
  iat: number;
  exp: number;
};

function getSecret() {
  const secret =
    process.env.ATTENDANCE_VERIFICATION_SECRET ||
    process.env.UPLOAD_TOKEN_SECRET ||
    process.env.NEXTAUTH_SECRET;

  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ATTENDANCE_VERIFICATION_SECRET, UPLOAD_TOKEN_SECRET, or NEXTAUTH_SECRET must be configured.",
    );
  }
  return DEVELOPMENT_SECRET;
}

function sign(payloadBase64: string) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(payloadBase64)
    .digest("base64url");
}

export function generateAttendanceVerificationToken(input: {
  employeeDocId: string;
  method: Exclude<AttendanceIdentificationMethod, "authenticated">;
  ttlSeconds?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const payload: AttendanceVerificationTokenPayload = {
    employeeDocId: input.employeeDocId,
    method: input.method,
    nonce: crypto.randomUUID(),
    iat: now,
    exp: now + (input.ttlSeconds ?? 600),
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  return `${payloadBase64}.${sign(payloadBase64)}`;
}

export function verifyAttendanceVerificationToken(
  token: string,
): AttendanceVerificationTokenPayload | null {
  try {
    const [payloadBase64, signature] = token.split(".");
    if (!payloadBase64 || !signature) return null;

    const expected = Buffer.from(sign(payloadBase64), "base64url");
    const received = Buffer.from(signature, "base64url");
    if (
      expected.length !== received.length ||
      !crypto.timingSafeEqual(expected, received)
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(payloadBase64, "base64url").toString("utf8"),
    ) as Partial<AttendanceVerificationTokenPayload>;
    const now = Math.floor(Date.now() / 1000);

    if (
      typeof payload.employeeDocId !== "string" ||
      !payload.employeeDocId ||
      !["qr", "phone", "employeeId"].includes(String(payload.method)) ||
      typeof payload.nonce !== "string" ||
      !payload.nonce ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp < now ||
      payload.iat > now + 60
    ) {
      return null;
    }

    return payload as AttendanceVerificationTokenPayload;
  } catch {
    return null;
  }
}
