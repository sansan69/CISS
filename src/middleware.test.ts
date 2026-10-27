import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

async function run(path: string, host: string, headers: Record<string, string> = {}) {
  vi.stubEnv("REGION_ALLOWED_DOMAINS", "ciss-tn.in");
  vi.stubEnv("NODE_ENV", "production");
  const { middleware } = await import("./middleware");
  return middleware(
    new NextRequest(`https://${host}${path}`, {
      headers: { host, ...headers },
    }),
  );
}

describe("regional host lock", () => {
  it("rejects a foreign host on pages even with prefetch headers", async () => {
    const response = await run("/dashboard", "evil.example", {
      "next-router-prefetch": "1",
      purpose: "prefetch",
    });
    expect(response.status).toBe(403);
  });

  it("rejects a foreign host on API routes", async () => {
    const response = await run("/api/health", "evil.example", {
      purpose: "prefetch",
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("locks API paths whose dynamic segment ends in an image extension", async () => {
    const response = await run("/api/documents/photo.png", "evil.example", {
      purpose: "prefetch",
    });
    expect(response.status).toBe(403);
  });

  it("locks non-API paths ending in an image extension", async () => {
    const response = await run("/documents/photo.png", "evil.example", {
      purpose: "prefetch",
    });
    expect(response.status).toBe(403);
  });

  it("serves an allowed host", async () => {
    const response = await run("/dashboard", "ciss-tn.in");
    expect(response.status).not.toBe(403);
  });

  it("is unlocked when no allowlist is configured", async () => {
    vi.stubEnv("REGION_ALLOWED_DOMAINS", "");
    vi.stubEnv("NODE_ENV", "production");
    const { middleware } = await import("./middleware");
    const response = await middleware(
      new NextRequest("https://anything.example/dashboard", {
        headers: { host: "anything.example" },
      }),
    );
    expect(response.status).not.toBe(403);
  });
});
