import { afterEach, describe, expect, it, vi } from "vitest";

type DocValue = Record<string, unknown>;

class FakeDocSnapshot {
  constructor(
    readonly id: string,
    private readonly value: DocValue | undefined,
  ) {}

  get exists() {
    return this.value !== undefined;
  }

  data() {
    return this.value;
  }
}

class FakeDocRef {
  constructor(
    private readonly store: FakeFirestore,
    readonly path: string,
  ) {}

  get id() {
    return this.path.split("/").at(-1)!;
  }

  async get() {
    return new FakeDocSnapshot(this.id, this.store.get(this.path));
  }

  collection(name: string) {
    return new FakeCollectionRef(this.store, `${this.path}/${name}`);
  }

  async set(value: DocValue, options?: { merge?: boolean }) {
    this.store.set(this.path, value, options);
  }
}

class FakeCollectionRef {
  constructor(
    private readonly store: FakeFirestore,
    private readonly path: string,
  ) {}

  doc(id: string) {
    return new FakeDocRef(this.store, `${this.path}/${id}`);
  }
}

class FakeBatch {
  private readonly operations: Array<() => void> = [];

  constructor(private readonly store: FakeFirestore) {}

  set(ref: FakeDocRef, value: DocValue, options?: { merge?: boolean }) {
    this.operations.push(() => this.store.set(ref.path, value, options));
  }

  async commit() {
    for (const operation of this.operations) operation();
  }
}

class FakeFirestore {
  private readonly docs = new Map<string, DocValue>();
  private transactionTail: Promise<unknown> = Promise.resolve();

  collection(name: string) {
    return new FakeCollectionRef(this, name);
  }

  batch() {
    return new FakeBatch(this);
  }

  runTransaction<T>(callback: (transaction: {
    get: (ref: FakeDocRef) => Promise<FakeDocSnapshot>;
    set: (ref: FakeDocRef, value: DocValue, options?: { merge?: boolean }) => void;
  }) => Promise<T>) {
    const operation = this.transactionTail.then(async () => {
      const writes: Array<() => void> = [];
      const transaction = {
        get: (ref: FakeDocRef) => ref.get(),
        set: (ref: FakeDocRef, value: DocValue, options?: { merge?: boolean }) => {
          writes.push(() => this.set(ref.path, value, options));
        },
      };
      const result = await callback(transaction);
      writes.forEach((write) => write());
      return result;
    });
    this.transactionTail = operation.catch(() => undefined);
    return operation;
  }

  seed(path: string, value: DocValue) {
    this.docs.set(path, value);
  }

  get(path: string) {
    return this.docs.get(path);
  }

  set(path: string, value: DocValue, options?: { merge?: boolean }) {
    const existing = options?.merge ? this.docs.get(path) ?? {} : {};
    this.docs.set(path, { ...existing, ...value });
  }

  paths(prefix: string) {
    return [...this.docs.keys()].filter((path) => path.startsWith(prefix));
  }
}

function seedActiveSession(db: FakeFirestore) {
  db.seed("employees/employee-doc-1", {
    fullName: "Test Guard",
    clientName: "Test Client",
    district: "Ernakulam",
  });
  db.seed("attendanceState/employee-doc-1", {
    lastStatus: "In",
    lastSiteId: "site-1",
    openSessionId: "session-1",
    lastAttendanceId: "session-1",
  });
  db.seed("attendanceSessions/session-1", {
    status: "open",
    employeeDocId: "employee-doc-1",
    siteId: "site-1",
    sourceCollection: "sites",
  });
  db.seed("attendanceLogs/session-1", {
    siteCoords: { lat: 10, lng: 76 },
    geofenceRadiusAtTime: 150,
  });
  db.seed("sites/site-1", {
    siteName: "Test Site",
    clientName: "Test Client",
    district: "Ernakulam",
    latitude: 10,
    longitude: 76,
  });
}

function createRequest(body: unknown) {
  return new Request("https://example.test/api/mobile/tracking/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockSharedDependencies(db: FakeFirestore) {
  vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
  vi.doMock("@/lib/server/guard-auth", () => ({
    requireGuard: vi.fn(async () => ({
      uid: "guard-uid-1",
      employeeId: "CISS/TEST/001",
      employeeDocId: "employee-doc-1",
    })),
  }));
  vi.doMock("@/lib/server/rate-limit", () => ({
    buildRateLimitKey: vi.fn(() => "guard-tracking-batch:guard-uid-1"),
    checkRateLimit: vi.fn(async () => ({
      allowed: true,
      remaining: 119,
      resetAt: new Date(),
      totalAttempts: 1,
    })),
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("POST /api/mobile/tracking/batch", () => {
  it("requires an open IN attendance session", async () => {
    const db = new FakeFirestore();
    db.seed("employees/employee-doc-1", { fullName: "Test Guard" });
    mockSharedDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(
      createRequest({
        samples: [{ siteId: "site-1", latitude: 10, longitude: 76, accuracy: 12 }],
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Mark IN"),
    });
  });

  it("accepts valid samples, rejects invalid ones, and persists AMS fields", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    mockSharedDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(
      createRequest({
        samples: [
          {
            siteId: "site-1",
            lat: 10,
            lng: 76,
            accuracy: 8,
            capturedAt: new Date().toISOString(),
          },
          { siteId: "site-1", latitude: 10, longitude: 76 },
          // Last valid sample wins the merged current/history document.
          {
            siteId: "site-1",
            latitude: 10.01,
            longitude: 76,
            accuracy: 12,
            locationAccuracy: 12,
            altitude: 14,
            bearing: 90,
            speed: 4.2,
            activity: "walking",
            isMock: false,
            isGPSOn: true,
            batteryPercentage: 73,
            wifiConnected: true,
            networkType: "wifi",
            capturedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ accepted: 2, rejected: 1 });

    const current = db.get("guardLocations/employee-doc-1");
    expect(current).toMatchObject({
      siteId: "site-1",
      clientName: "Test Client",
      district: "Ernakulam",
      activity: "walking",
      isMock: false,
      isGPSOn: true,
      altitude: 14,
      bearing: 90,
      locationAccuracy: 12,
      batteryPercentage: 73,
      wifiConnected: true,
      networkType: "wifi",
    });

    const historyPath = db
      .paths("guardLocations/employee-doc-1/locationHistory/")
      .at(0);
    expect(historyPath).toBeDefined();
    expect(db.get(historyPath!)).toMatchObject({
      activity: "walking",
      isGPSOn: true,
      batteryPercentage: 73,
      attendanceSessionId: "session-1",
    });
  });

  it("rejects samples that do not match the open session site", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    mockSharedDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(
      createRequest({
        samples: [
          {
            siteId: "other-site",
            latitude: 10,
            longitude: 76,
            accuracy: 12,
            capturedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 0, rejected: 1 });
  });

  it("does not regress the current pin with a stale queued sample", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    const newerStored = Date.now();
    db.seed("guardLocations/employee-doc-1", {
      sampleCapturedAtMs: newerStored,
      lat: 1.111,
      lng: 2.222,
      activity: "still",
    });
    mockSharedDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(
      createRequest({
        samples: [
          {
            siteId: "site-1",
            latitude: 10.5,
            longitude: 76.5,
            accuracy: 12,
            activity: "walking",
            capturedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 1, rejected: 0 });

    const current = db.get("guardLocations/employee-doc-1");
    expect(current).toMatchObject({
      lat: 1.111,
      lng: 2.222,
      activity: "still",
      sampleCapturedAtMs: newerStored,
    });

    const historyPath = db
      .paths("guardLocations/employee-doc-1/locationHistory/")
      .at(0);
    expect(historyPath).toBeDefined();
    expect(db.get(historyPath!)).toMatchObject({
      lat: 10.5,
      activity: "walking",
    });
  });

  it("rejects buffered samples captured before the active session started", async () => {
    const db = new FakeFirestore();
    const now = Date.now();
    seedActiveSession(db);
    db.set("attendanceSessions/session-1", {
      startedAt: new Date(now - 60_000),
    }, { merge: true });
    mockSharedDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(createRequest({ samples: [{
      siteId: "site-1", lat: 10, lng: 76, accuracy: 8,
      capturedAt: new Date(now - 60 * 60_000).toISOString(),
    }] }));

    expect(await response.json()).toEqual({ accepted: 0, rejected: 1 });
    expect(db.paths("guardLocations/")).toHaveLength(0);
  });

  it("tolerates a device clock slightly behind a server-stamped session start", async () => {
    // The guard check-in flow does not send reportedAtClient, so
    // attendanceSessions.startedAt is stamped from the server clock while the
    // samples carry the handset clock. A handset running 30s behind must not
    // lose the breadcrumbs it captured just after checking in.
    const db = new FakeFirestore();
    const now = Date.now();
    seedActiveSession(db);
    db.set("attendanceSessions/session-1", {
      startedAt: new Date(now - 60_000),
    }, { merge: true });
    mockSharedDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(createRequest({ samples: [{
      siteId: "site-1", lat: 10, lng: 76, accuracy: 8,
      capturedAt: new Date(now - 90_000).toISOString(),
    }] }));

    expect(await response.json()).toEqual({ accepted: 1, rejected: 0 });
    expect(db.get("guardLocations/employee-doc-1")).toBeDefined();
    expect(
      db.paths("guardLocations/employee-doc-1/locationHistory/"),
    ).toHaveLength(1);
  });

  it("advances the current pin when the sample is newer than the stored one", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    db.seed("guardLocations/employee-doc-1", {
      sampleCapturedAtMs: Date.now() - 60 * 60 * 1000,
      lat: 1.111,
      activity: "still",
    });
    mockSharedDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(
      createRequest({
        samples: [
          {
            siteId: "site-1",
            latitude: 10.5,
            longitude: 76.5,
            accuracy: 12,
            activity: "walking",
            capturedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 1, rejected: 0 });
    expect(db.get("guardLocations/employee-doc-1")).toMatchObject({
      lat: 10.5,
      activity: "walking",
    });
  });

  it("trims batches beyond 200 samples", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    mockSharedDependencies(db);

    const capturedAt = new Date().toISOString();
    const samples = Array.from({ length: 205 }, () => ({
      siteId: "site-1",
      latitude: 10,
      longitude: 76,
      accuracy: 10,
      capturedAt,
    }));

    const { POST } = await import("./route");
    const response = await POST(createRequest({ samples }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ accepted: 200, rejected: 5 });
  });

  it("keeps the newest live pin when an older queued batch commits later", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    mockSharedDependencies(db);

    const originalRunTransaction = db.runTransaction.bind(db);
    let releaseOlder!: () => void;
    let announceOlder!: () => void;
    const olderWaiting = new Promise<void>((resolve) => { announceOlder = resolve; });
    const gate = new Promise<void>((resolve) => { releaseOlder = resolve; });
    let transactionCount = 0;
    vi.spyOn(db, "runTransaction").mockImplementation((callback: any) => {
      if (++transactionCount !== 1) return originalRunTransaction(callback);
      announceOlder();
      return gate.then(() => originalRunTransaction(callback));
    });

    const { POST } = await import("./route");
    const now = Date.now();
    const olderRequest = POST(createRequest({ samples: [{
      siteId: "site-1", lat: 10, lng: 76, accuracy: 8,
      capturedAt: new Date(now - 6 * 60_000).toISOString(),
    }] }));
    await olderWaiting;
    const newerResponse = await POST(createRequest({ samples: [{
      siteId: "site-1", lat: 10.001, lng: 76, accuracy: 8,
      capturedAt: new Date(now).toISOString(),
    }] }));
    expect(newerResponse.status).toBe(200);
    releaseOlder();
    expect((await olderRequest).status).toBe(200);

    expect(db.get("guardLocations/employee-doc-1")?.sampleCapturedAtMs).toBe(now);
    expect(db.paths("guardLocations/employee-doc-1/locationHistory/")).toHaveLength(2);
  });

  it("keeps accepted sample history without restoring a pin after checkout", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    mockSharedDependencies(db);

    const originalRunTransaction = db.runTransaction.bind(db);
    let releaseAfterCheckout!: () => void;
    let announceTransaction!: () => void;
    const transactionWaiting = new Promise<void>((resolve) => { announceTransaction = resolve; });
    const gate = new Promise<void>((resolve) => { releaseAfterCheckout = resolve; });
    vi.spyOn(db, "runTransaction").mockImplementation((callback: any) => {
      announceTransaction();
      return gate.then(() => originalRunTransaction(callback));
    });

    const { POST } = await import("./route");
    const responsePromise = POST(createRequest({ samples: [{
      siteId: "site-1", lat: 10, lng: 76, accuracy: 8,
      capturedAt: new Date().toISOString(),
    }] }));
    await transactionWaiting;
    db.set("attendanceState/employee-doc-1", {
      lastStatus: "Out", openSessionId: null,
    }, { merge: true });
    db.set("attendanceSessions/session-1", { status: "closed" }, { merge: true });
    releaseAfterCheckout();

    expect((await responsePromise).status).toBe(200);
    expect(db.get("guardLocations/employee-doc-1")).toBeUndefined();
    expect(db.paths("guardLocations/employee-doc-1/locationHistory/")).toHaveLength(1);
  });
});
