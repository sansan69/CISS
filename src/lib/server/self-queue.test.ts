import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSelfUrl, resolveConfiguredAppOrigin } from "./self-queue";

const originalAppUrl = process.env.APP_URL;
const originalPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const originalVercelUrl = process.env.VERCEL_URL;

function restoreEnv() {
  for (const [key, value] of [
    ["APP_URL", originalAppUrl],
    ["NEXT_PUBLIC_APP_URL", originalPublicAppUrl],
    ["VERCEL_PROJECT_PRODUCTION_URL", originalVercelProductionUrl],
    ["VERCEL_URL", originalVercelUrl],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe("self-queue re-queue origin", () => {
  it("resolves the canonical origin from configuration", () => {
    expect(
      resolveConfiguredAppOrigin({ NEXT_PUBLIC_APP_URL: "https://cisskerala.site" }),
    ).toBe("https://cisskerala.site");
    expect(
      resolveConfiguredAppOrigin({ APP_URL: "https://tn.cisskerala.site/app" }),
    ).toBe("https://tn.cisskerala.site");
    // Server-side override wins over the public build variable.
    expect(
      resolveConfiguredAppOrigin({
        APP_URL: "https://regional.example.org",
        NEXT_PUBLIC_APP_URL: "https://cisskerala.site",
      }),
    ).toBe("https://regional.example.org");
    expect(resolveConfiguredAppOrigin({})).toBeNull();
  });

  it("rejects schemes, credentials, and malformed values", () => {
    expect(resolveConfiguredAppOrigin({ APP_URL: "http://cisskerala.site" })).toBeNull();
    expect(
      resolveConfiguredAppOrigin({ APP_URL: "https://user:pass@cisskerala.site" }),
    ).toBeNull();
    expect(resolveConfiguredAppOrigin({ APP_URL: "not a url" })).toBeNull();
    expect(
      resolveConfiguredAppOrigin({
        APP_URL: "ftp://cisskerala.site",
        NEXT_PUBLIC_APP_URL: "https://cisskerala.site",
      }),
    ).toBe("https://cisskerala.site");
  });

  it("falls back to platform-assigned hostnames, never to the request", () => {
    // Vercel system variables are bare hostnames set by the platform.
    expect(
      resolveConfiguredAppOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "cisskerala.site" }),
    ).toBe("https://cisskerala.site");
    expect(
      resolveConfiguredAppOrigin({ VERCEL_URL: "ciss-workforce-abc123.vercel.app" }),
    ).toBe("https://ciss-workforce-abc123.vercel.app");
    // An explicit configuration still wins over the platform hostnames.
    expect(
      resolveConfiguredAppOrigin({
        NEXT_PUBLIC_APP_URL: "https://cisskerala.site",
        VERCEL_PROJECT_PRODUCTION_URL: "ciss-tn.vercel.app",
      }),
    ).toBe("https://cisskerala.site");
    expect(
      resolveConfiguredAppOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "http://ciss-tn.vercel.app" }),
    ).toBeNull();
  });

  it("ignores the request origin so a spoofed Host cannot receive the cron secret", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://cisskerala.site";

    expect(
      buildSelfUrl("https://attacker.example/api/attendance/auto-checkout", "/api/attendance/auto-checkout"),
    ).toBe("https://cisskerala.site/api/attendance/auto-checkout");
    expect(
      buildSelfUrl("http://169.254.169.254/latest/meta-data", "/api/internal/automation-worker"),
    ).toBe("https://cisskerala.site/api/internal/automation-worker");
  });

  it("normalises the path and refuses to build a URL when no origin is configured", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://cisskerala.site/";
    expect(buildSelfUrl("https://attacker.example/x", "api/admin/claims/repair")).toBe(
      "https://cisskerala.site/api/admin/claims/repair",
    );

    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(buildSelfUrl("https://cisskerala.site/api/x", "/api/x")).toBe("");
  });
});

/** Minimal in-memory Firestore stand-in for the self-queue state document. */
function mockStateDb() {
  const state: Record<string, unknown> = {};
  const stateRef = { id: "job-1" };
  const snapshot = { get: (key: string) => state[key] };
  const transaction = {
    get: async () => snapshot,
    set: (_ref: unknown, value: Record<string, unknown>) => {
      Object.assign(state, value);
    },
  };
  vi.doMock("@/lib/firebaseAdmin", () => ({
    db: {
      collection: () => ({ doc: () => stateRef }),
      runTransaction: async (fn: (tx: typeof transaction) => Promise<unknown>) => fn(transaction),
    },
  }));
}

async function runOneChunk(selfUrl: string) {
  vi.resetModules();
  mockStateDb();
  const { runChunked } = await import("./self-queue");
  return runChunked(
    {
      stateCollection: "queueJobs",
      jobId: "job-1",
      budgetMs: 0,
      selfUrl,
      cronSecret: "cron-secret",
    },
    async () => ({ chunk: { id: "chunk-1" }, cursor: 1 }),
    async () => ({ done: false, processed: 1 }),
  );
}

describe("self-queue re-queue destination", () => {
  it("sends the cron secret only to the configured origin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://cisskerala.site";
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runOneChunk("https://cisskerala.site/api/admin/claims/repair");

    expect(result.status).toBe("re-queued");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe("https://cisskerala.site/api/admin/claims/repair");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer cron-secret");
  });

  it("does not re-queue to a destination outside the configured origin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://cisskerala.site";
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await runOneChunk("https://attacker.example/api/admin/claims/repair");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not re-queue at all when no origin is configured", async () => {
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runOneChunk("https://attacker.example/api/admin/claims/repair");

    expect(result.status).toBe("re-queued");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
