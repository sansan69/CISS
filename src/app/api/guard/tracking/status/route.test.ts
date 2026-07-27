import { afterEach, describe, expect, it, vi } from "vitest";

function createDb(state?: Record<string, unknown>) {
  return {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn(async () => ({
          exists: Boolean(state),
          data: () => state ?? {},
        })),
      })),
    })),
  };
}

function mockGuard(db: ReturnType<typeof createDb>) {
  vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
  vi.doMock("@/lib/server/guard-auth", () => ({
    requireGuard: vi.fn(async () => ({
      uid: "guard-uid-1",
      employeeId: "CISS/TEST/001",
      employeeDocId: "employee-doc-1",
    })),
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("guard tracking status", () => {
  it("reports an active site only for a complete open IN state", async () => {
    mockGuard(
      createDb({
        lastStatus: "In",
        lastSiteId: "site-1",
        openSessionId: "session-1",
      }),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://example.test/api/guard/tracking/status"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      isClockedIn: true,
      siteId: "site-1",
      openSessionId: "session-1",
    });
  });

  it("does not start tracking from a stale or incomplete state", async () => {
    mockGuard(
      createDb({
        lastStatus: "Out",
        lastSiteId: "site-1",
        openSessionId: null,
      }),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://example.test/api/guard/tracking/status"),
    );

    await expect(response.json()).resolves.toEqual({
      isClockedIn: false,
      siteId: null,
      openSessionId: null,
    });
  });
});
