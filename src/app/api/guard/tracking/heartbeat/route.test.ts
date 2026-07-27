import { afterEach, describe, expect, it, vi } from "vitest";

type StoredDocument = {
  exists: boolean;
  data: () => Record<string, unknown>;
};

function createDb(seed: Record<string, Record<string, unknown>> = {}) {
  const writes = new Map<string, Record<string, unknown>>();
  const document = (path: string) => ({
    id: path.split("/").at(-1),
    path,
    async get(): Promise<StoredDocument> {
      const value = seed[path];
      return {
        exists: Boolean(value),
        data: () => value ?? {},
      };
    },
    collection(name: string) {
      return {
        doc(id: string) {
          return document(`${path}/${name}/${id}`);
        },
      };
    },
  });

  return {
    writes,
    collection(name: string) {
      return {
        doc(id: string) {
          return document(`${name}/${id}`);
        },
      };
    },
    batch() {
      const pending: Array<{
        path: string;
        data: Record<string, unknown>;
      }> = [];
      return {
        set(
          ref: { path: string },
          data: Record<string, unknown>,
          _options?: { merge: boolean },
        ) {
          pending.push({ path: ref.path, data });
        },
        async commit() {
          for (const item of pending) {
            writes.set(item.path, item.data);
          }
        },
      };
    },
  };
}

function createRequest(body: Record<string, unknown>) {
  return new Request("https://example.test/api/guard/tracking/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockSharedDependencies(db: ReturnType<typeof createDb>) {
  vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
  vi.doMock("@/lib/server/guard-auth", () => ({
    requireGuard: vi.fn(async () => ({
      uid: "guard-uid-1",
      employeeId: "CISS/TEST/001",
      employeeDocId: "employee-doc-1",
    })),
  }));
  vi.doMock("@/lib/server/rate-limit", () => ({
    buildRateLimitKey: vi.fn(() => "guard-heartbeat:guard-uid-1"),
    checkRateLimit: vi.fn(async () => ({
      allowed: true,
      remaining: 29,
      resetAt: new Date(),
      totalAttempts: 1,
    })),
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("guard tracking heartbeat", () => {
  it("rejects invalid coordinates before reading attendance data", async () => {
    const db = createDb();
    mockSharedDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(
      createRequest({
        siteId: "site-1",
        lat: 91,
        lng: 76,
        accuracy: 12,
      }),
    );

    expect(response.status).toBe(400);
    expect(db.writes.size).toBe(0);
  });

  it("requires an open IN attendance session", async () => {
    const db = createDb({
      "employees/employee-doc-1": { fullName: "Test Guard" },
    });
    mockSharedDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(
      createRequest({
        siteId: "site-1",
        lat: 10,
        lng: 76,
        accuracy: 12,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Mark IN"),
    });
  });

  it("computes geofence status on the server and stores scoped history", async () => {
    const db = createDb({
      "employees/employee-doc-1": {
        fullName: "Test Guard",
        clientName: "Test Client",
        district: "Ernakulam",
      },
      "attendanceState/employee-doc-1": {
        lastStatus: "In",
        lastSiteId: "site-1",
        openSessionId: "session-1",
        lastAttendanceId: "session-1",
      },
      "attendanceSessions/session-1": {
        status: "open",
        employeeDocId: "employee-doc-1",
        siteId: "site-1",
        sourceCollection: "sites",
      },
      "attendanceLogs/session-1": {
        siteCoords: { lat: 10, lng: 76 },
        geofenceRadiusAtTime: 150,
      },
      "sites/site-1": {
        siteName: "Test Site",
        clientName: "Test Client",
        district: "Ernakulam",
        latitude: 10,
        longitude: 76,
      },
    });
    mockSharedDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(
      createRequest({
        siteId: "site-1",
        lat: 10.01,
        lng: 76,
        accuracy: 12,
        capturedAt: new Date().toISOString(),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      zoneStatus: "out_of_zone",
      gpsReliable: true,
    });
    expect(body.distanceFromSite).toBeGreaterThan(1_000);

    const current = db.writes.get("guardLocations/employee-doc-1");
    expect(current).toMatchObject({
      attendanceSessionId: "session-1",
      siteId: "site-1",
      clientName: "Test Client",
      district: "Ernakulam",
      zoneStatus: "out_of_zone",
      isOutOfZone: true,
    });

    const history = [...db.writes.entries()].find(([path]) =>
      path.startsWith(
        "guardLocations/employee-doc-1/locationHistory/session-1_",
      ),
    );
    expect(history?.[1]).toMatchObject({
      clientName: "Test Client",
      district: "Ernakulam",
      attendanceSessionId: "session-1",
    });
  });
});
