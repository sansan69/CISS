import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/firebaseAdmin");
});

describe("public region config", () => {
  it("serves a non-Kerala deployment's own region from its environment", async () => {
    vi.stubEnv("REGION_CODE", "TN");
    vi.stubEnv("REGION_NAME", "Tamil Nadu");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tn.ciss.example");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "ciss-tn");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "tn-key");

    const { GET } = await import("./route");
    const response = await GET(new Request("https://tn.ciss.example"), {
      params: Promise.resolve({ code: "TN" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      regionCode: "TN",
      regionName: "Tamil Nadu",
      apiUrl: "https://tn.ciss.example",
    });
    expect(body.web.projectId).toBe("ciss-tn");
    expect(body.android.apiKey).toBe("tn-key");
  });

  it("does not answer a foreign region code from local environment values", async () => {
    vi.stubEnv("REGION_CODE", "TN");
    vi.stubEnv("REGION_NAME", "Tamil Nadu");
    const get = vi.fn(async () => ({ exists: false }));
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: { collection: () => ({ doc: () => ({ get }) }) },
    }));

    const { GET } = await import("./route");
    const response = await GET(new Request("https://tn.ciss.example"), {
      params: Promise.resolve({ code: "KL" }),
    });

    expect(response.status).toBe(404);
    expect(get).toHaveBeenCalled();
  });
});
