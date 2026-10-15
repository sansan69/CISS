import { afterEach, describe, expect, it, vi } from "vitest";

class FakeSettingsDb {
  constructor(private readonly docs: Map<string, Record<string, unknown>>) {}

  seed(path: string, value: Record<string, unknown>) {
    this.docs.set(path, value);
  }

  collection(name: string) {
    return {
      doc: (id: string) => ({
        get: async () => {
          const value = this.docs.get(`${name}/${id}`);
          return {
            exists: value !== undefined,
            data: () => value,
          };
        },
      }),
    };
  }
}

function mockDependencies(options: {
  db: FakeSettingsDb;
  session?: Record<string, unknown> | null;
  sessionError?: Error;
  release?: Record<string, unknown>;
}) {
  vi.doMock("@/lib/firebaseAdmin", () => ({ db: options.db }));
  vi.doMock("@/lib/server/auth", () => ({
    verifyRequestAuth: vi.fn(async () => ({ uid: "guard-uid-1" })),
    unauthorizedResponse: (message: string, status = 401) =>
      Response.json({ error: message }, { status }),
  }));
  vi.doMock("@/lib/server/mobile-session", () => ({
    resolveMobileSession: vi.fn(async () => {
      if (options.sessionError) throw options.sessionError;
      return options.session === undefined
        ? { role: "guard", uid: "guard-uid-1", stateCode: "KL" }
        : options.session;
    }),
  }));
  vi.doMock("@/lib/android-release", () => ({
    getAndroidRelease: vi.fn(async () =>
      options.release ?? { mandatory: false },
    ),
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock("@/lib/firebaseAdmin");
  vi.doUnmock("@/lib/server/auth");
  vi.doUnmock("@/lib/server/mobile-session");
  vi.doUnmock("@/lib/android-release");
});

describe("GET /api/mobile/settings", () => {
  it("returns the mobile client defaults when no config documents exist", async () => {
    const db = new FakeSettingsDb(new Map());
    mockDependencies({ db });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://example.test/api/mobile/settings"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.version).toBe(1);
    expect(body.data.app).toEqual({
      minSupportedVersion: "",
      forceUpdate: false,
      maintenance: false,
      currencySymbol: "₹",
      distanceUnit: "km",
    });
    expect(body.data.modules).toMatchObject({
      attendance: true,
      qrAttendance: true,
      offlineTracking: true,
      biometricVerification: true,
      documents: true,
      leave: true,
      break: true,
      geoFence: true,
      loan: false,
      ipAttendance: false,
      uidLogin: false,
      dynamicQr: false,
    });
    // Full flags map is returned, not just the overridden keys.
    expect(Object.keys(body.data.modules)).toHaveLength(29);
  });

  it("merges appConfig/mobile and regions/{stateCode} over the defaults", async () => {
    const db = new FakeSettingsDb(new Map());
    db.seed("appConfig/mobile", {
      version: 7,
      app: {
        minSupportedVersion: "1.0.21",
        forceUpdate: true,
        currencySymbol: "$",
        distanceUnit: "mi",
      },
      modules: { loan: true, qrAttendance: false },
    });
    db.seed("regions/KL", {
      app: { maintenance: true },
      modules: { ipAttendance: true },
    });
    mockDependencies({ db });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://example.test/api/mobile/settings"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.version).toBe(7);
    expect(body.data.app).toEqual({
      minSupportedVersion: "1.0.21",
      forceUpdate: true,
      maintenance: true,
      currencySymbol: "$",
      distanceUnit: "mi",
    });
    expect(body.data.modules.loan).toBe(true);
    expect(body.data.modules.qrAttendance).toBe(false);
    expect(body.data.modules.ipAttendance).toBe(true);
    expect(body.data.modules.attendance).toBe(true);
  });

  it("forces an update when the app release is mandatory", async () => {
    const db = new FakeSettingsDb(new Map());
    mockDependencies({ db, release: { mandatory: true } });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://example.test/api/mobile/settings"),
    );
    const body = await response.json();

    expect(body.data.app.forceUpdate).toBe(true);
  });

  it("returns 500 without leaking internals when config loading fails", async () => {
    const db = new FakeSettingsDb(new Map());
    mockDependencies({
      db,
      sessionError: new Error("firestore failed at internal/secret/path"),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://example.test/api/mobile/settings"),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Could not load mobile settings.",
    });
  });

  it("rejects accounts that are not linked to a mobile profile", async () => {
    const db = new FakeSettingsDb(new Map());
    mockDependencies({ db, session: null });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://example.test/api/mobile/settings"),
    );

    expect(response.status).toBe(403);
  });
});
