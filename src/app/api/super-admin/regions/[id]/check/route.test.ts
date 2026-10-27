import { afterEach, describe, expect, it, vi } from "vitest";

type RegionOverrides = Record<string, unknown>;

function mockModules(region: RegionOverrides) {
  const db = {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn(async () => ({
          exists: true,
          data: () => ({
            status: "live",
            regionAdminEmail: "admin@example.test",
            ...region,
          }),
        })),
      })),
    })),
  };

  vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
  vi.doMock("@/lib/server/auth", () => ({
    requireSuperAdmin: vi.fn(async () => ({ uid: "super-admin-1", role: "superAdmin" })),
    unauthorizedResponse: (message: string, status: number) =>
      new Response(JSON.stringify({ error: message }), { status }),
  }));
  vi.doMock("@/lib/server/region-connections", () => ({
    getRegionConnection: vi.fn(async () => null),
  }));
}

async function checkRegion(region: RegionOverrides) {
  mockModules(region);
  const { GET } = await import("./route");
  const response = await GET(
    new Request("https://example.test/api/super-admin/regions/TN/check"),
    { params: Promise.resolve({ id: "TN" }) },
  );
  const body = (await response.json()) as {
    summary?: { checks: Array<{ checkId: string; passed: boolean; message: string }> };
  };
  return body.summary!.checks.find((check) => check.checkId === "vercel_url")!;
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("region readiness Vercel URL probe", () => {
  it("fetches a validated public https deployment URL with a timeout", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const check = await checkRegion({ vercelProductionUrl: "https://ciss-tn.vercel.app" });

    expect(check.passed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe("https://ciss-tn.vercel.app/");
    expect(init.method).toBe("HEAD");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["link-local metadata", "http://169.254.169.254/latest/meta-data"],
    ["loopback", "https://127.0.0.1:8443/"],
    ["private network", "https://10.0.0.5/"],
    ["internal suffix", "https://metadata.google.internal/"],
    ["credentials", "https://user:pass@ciss-tn.vercel.app/"],
    ["unencrypted", "http://ciss-tn.vercel.app/"],
    ["bare hostname", "https://internal-service/"],
  ])("skips the probe for a %s target", async (_label, url) => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const check = await checkRegion({ vercelProductionUrl: url });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(check.passed).toBe(false);
    expect(check.message).toContain("not a public https URL");
  });

  it("reports an unreachable but valid deployment URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    const check = await checkRegion({ vercelProductionUrl: "https://ciss-tn.vercel.app" });

    expect(check.passed).toBe(false);
    expect(check.message).toContain("is not responding");
  });
});
