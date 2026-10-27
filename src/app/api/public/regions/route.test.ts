import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/firebaseAdmin");
});

async function callRegions() {
  const { GET } = await import("./route");
  const response = await GET();
  return { status: response.status, body: await response.json() };
}

describe("public region discovery", () => {
  it("advertises the deployment's own region instead of always injecting Kerala", async () => {
    vi.stubEnv("REGION_CODE", "TN");
    vi.stubEnv("REGION_NAME", "Tamil Nadu");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tn.ciss.example");
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: {
        collection: () => ({
          where: () => ({ get: async () => ({ docs: [] }) }),
        }),
      },
    }));

    const { status, body } = await callRegions();

    expect(status).toBe(200);
    expect(body.regions).toHaveLength(1);
    expect(body.regions[0]).toMatchObject({
      code: "TN",
      name: "Tamil Nadu",
      apiUrl: "https://tn.ciss.example",
    });
    expect(body.regions.some((region: { code: string }) => region.code === "KL")).toBe(
      false,
    );
  });

  it("still falls back to the own region when the registry is unavailable", async () => {
    vi.stubEnv("REGION_CODE", "KL");
    vi.stubEnv("REGION_NAME", "Kerala");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cisskerala.site");
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: {
        collection: () => ({
          where: () => ({
            get: async () => {
              throw new Error("registry unavailable");
            },
          }),
        }),
      },
    }));

    const { status, body } = await callRegions();

    expect(status).toBe(200);
    expect(body.regions[0]).toMatchObject({ code: "KL", name: "Kerala" });
    expect(body.error).toBeUndefined();
  });
});
