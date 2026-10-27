import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("QR badge signing secret", () => {
  it("refuses to sign in production when no server-side secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CISS_QR_SECRET", "");
    vi.stubEnv("ATTENDANCE_VERIFICATION_SECRET", "");
    vi.stubEnv("UPLOAD_TOKEN_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "public-api-key");

    const { generateQrToken } = await import("./qr-token");
    await expect(
      generateQrToken("CISS/TEST/001", "9999999999"),
    ).rejects.toThrow(/CISS_QR_SECRET/);
  });

  it("does not derive the signature from the public Firebase API key", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CISS_QR_SECRET", "server-only-secret");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "public-key-one");

    const first = await import("./qr-token");
    const token = await first.generateQrToken("CISS/TEST/001", "9999999999");

    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "public-key-two");
    const second = await import("./qr-token");
    const tokenAgain = await second.generateQrToken("CISS/TEST/001", "9999999999");

    expect(tokenAgain).toBe(token);
    expect(await second.verifyQrToken("CISS/TEST/001", "9999999999", token)).toBe(true);
    expect(await second.verifyQrToken("CISS/TEST/002", "9999999999", token)).toBe(false);
  });
});
