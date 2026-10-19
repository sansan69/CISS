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

  where(field: string, operator: string, value: unknown) {
    return new FakeQuery(this.store, this.path, [[field, operator, value]]);
  }
}

class FakeQuery {
  constructor(
    private readonly store: FakeFirestore,
    private readonly path: string,
    private readonly filters: Array<[string, string, unknown]>,
    private readonly cap = Infinity,
    private readonly sort?: [string, "asc" | "desc"],
    private readonly cursor?: string,
  ) {}
  where(field: string, operator: string, value: unknown) {
    return new FakeQuery(this.store, this.path, [...this.filters, [field, operator, value]], this.cap, this.sort, this.cursor);
  }
  orderBy(field: string, direction: "asc" | "desc" = "asc") { return new FakeQuery(this.store, this.path, this.filters, this.cap, [field, direction], this.cursor); }
  limit(cap: number) { return new FakeQuery(this.store, this.path, this.filters, cap, this.sort, this.cursor); }
  startAfter(doc: { id: string }) { return new FakeQuery(this.store, this.path, this.filters, this.cap, this.sort, doc.id); }
  async get() {
    const prefix = `${this.path}/`;
    const valueOf = (value: unknown) => value instanceof Date ? value.getTime()
      : value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function" ? value.toDate().getTime()
      : value;
    let paths = this.store.paths(prefix)
      .filter((path) => this.filters.every(([field, operator, expected]) => {
        const actual = valueOf(this.store.get(path)?.[field]);
        const target = valueOf(expected);
        return operator === "==" ? actual === target
          : operator === ">=" ? Number(actual) >= Number(target)
          : operator === "<=" ? Number(actual) <= Number(target)
          : false;
      }));
    if (this.sort) {
      const [field, direction] = this.sort;
      paths.sort((a, b) => {
        const av = valueOf(this.store.get(a)?.[field]);
        const bv = valueOf(this.store.get(b)?.[field]);
        return (Number(bv) - Number(av)) * (direction === "desc" ? 1 : -1);
      });
    }
    if (this.cursor) paths = paths.slice(paths.findIndex((path) => path.slice(prefix.length) === this.cursor) + 1);
    const docs = paths.slice(0, this.cap)
      .map((path) => new FakeDocSnapshot(path.slice(prefix.length), this.store.get(path)));
    this.store.recordQueryRead(docs.length);
    return { docs };
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
  queryCount = 0;
  queryDocumentCount = 0;
  recordQueryRead(count: number) { this.queryCount += 1; this.queryDocumentCount += count; }

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

  it("saves queued samples for a closed historical session after a new session starts without moving the live pin", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    const capturedAt = new Date(Date.now() - 60 * 60_000);
    db.seed("attendanceSessions/session-a", {
      status: "closed", employeeDocId: "employee-doc-1", siteId: "site-1",
      sourceCollection: "sites", startedAt: new Date(capturedAt.getTime() - 60_000), endedAt: new Date(capturedAt.getTime() + 60_000),
    });
    db.seed("attendanceLogs/session-a", { siteCoords: { lat: 10, lng: 76 }, geofenceRadiusAtTime: 150 });
    db.seed("attendanceSessions/session-1", {
      status: "open", employeeDocId: "employee-doc-1", siteId: "site-1",
      sourceCollection: "sites", startedAt: new Date(Date.now() - 30_000),
    });
    db.seed("guardLocations/employee-doc-1", {
      attendanceSessionId: "session-1", siteId: "site-1", lat: 11, lng: 77,
      sampleCapturedAtMs: Date.now(),
    });
    mockSharedDependencies(db);

    const { POST } = await import("./route");
    const sample = { siteId: "site-1", attendanceSessionId: "session-a", lat: 10, lng: 76, accuracy: 8, capturedAt: capturedAt.toISOString() };
    const first = await POST(createRequest({ samples: [sample] }));
    const second = await POST(createRequest({ samples: [sample] }));

    expect(await first.json()).toMatchObject({ accepted: 1, rejected: 0 });
    expect(await second.json()).toMatchObject({ accepted: 1, rejected: 0 });
    expect(db.get("guardLocations/employee-doc-1")).toMatchObject({ attendanceSessionId: "session-1", lat: 11, lng: 77 });
    expect(db.paths("guardLocations/employee-doc-1/locationHistory/")).toHaveLength(1);
    expect(db.get(db.paths("guardLocations/employee-doc-1/locationHistory/")[0])).toMatchObject({ attendanceSessionId: "session-a", lat: 10 });
  });

  it("saves buffered historical samples without a current open session", async () => {
    const db = new FakeFirestore();
    db.seed("employees/employee-doc-1", { fullName: "Test Guard", clientName: "Test Client", district: "Ernakulam" });
    db.seed("attendanceState/employee-doc-1", { lastStatus: "Out", lastSiteId: "site-1" });
    const capturedAt = new Date(Date.now() - 60 * 60_000);
    db.seed("attendanceSessions/session-a", {
      status: "closed", employeeDocId: "employee-doc-1", siteId: "site-1",
      sourceCollection: "sites", startedAt: new Date(capturedAt.getTime() - 60_000), endedAt: new Date(capturedAt.getTime() + 60_000),
    });
    db.seed("attendanceLogs/session-a", { siteCoords: { lat: 10, lng: 76 } });
    db.seed("sites/site-1", { siteName: "Test Site", latitude: 10, longitude: 76 });
    mockSharedDependencies(db);
    const { POST } = await import("./route");
    const response = await POST(createRequest({ samples: [{ siteId: "site-1", lat: 10, lng: 76, accuracy: 8, capturedAt: capturedAt.toISOString() }] }));
    expect(await response.json()).toMatchObject({ accepted: 1, rejected: 0 });
    expect(db.paths("guardLocations/employee-doc-1/locationHistory/")).toHaveLength(1);
    expect(db.get("guardLocations/employee-doc-1")).toBeUndefined();
  });

  it("infers historical session ownership for older samples without a session id", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    const capturedAt = new Date(Date.now() - 60 * 60_000);
    db.seed("attendanceSessions/session-a", {
      status: "closed", employeeDocId: "employee-doc-1", siteId: "site-1",
      sourceCollection: "sites", startedAt: new Date(capturedAt.getTime() - 60_000), endedAt: new Date(capturedAt.getTime() + 60_000),
    });
    db.seed("attendanceLogs/session-a", { siteCoords: { lat: 10, lng: 76 } });
    db.seed("attendanceSessions/session-1", { status: "open", employeeDocId: "employee-doc-1", siteId: "site-1", sourceCollection: "sites", startedAt: new Date(Date.now() - 30_000) });
    db.seed("guardLocations/employee-doc-1", { attendanceSessionId: "session-1", lat: 11, lng: 77, sampleCapturedAtMs: Date.now() });
    mockSharedDependencies(db);
    const { POST } = await import("./route");
    const response = await POST(createRequest({ samples: [{ siteId: "site-1", lat: 10, lng: 76, accuracy: 8, capturedAt: capturedAt.toISOString() }] }));
    expect(await response.json()).toMatchObject({ accepted: 1, rejected: 0 });
    expect(db.get("guardLocations/employee-doc-1")).toMatchObject({ attendanceSessionId: "session-1", lat: 11, lng: 77 });
    expect(db.paths("guardLocations/employee-doc-1/locationHistory/")).toHaveLength(1);
    expect(db.get(db.paths("guardLocations/employee-doc-1/locationHistory/")[0])).toMatchObject({ attendanceSessionId: "session-a", lat: 10 });
  });

  it("rejects another employee's historical session", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    const capturedAt = new Date(Date.now() - 60 * 60_000);
    db.seed("attendanceSessions/foreign", { status: "closed", employeeDocId: "someone-else", siteId: "site-1", startedAt: new Date(capturedAt.getTime() - 60_000), endedAt: new Date(capturedAt.getTime() + 60_000) });
    db.seed("attendanceLogs/foreign", { siteCoords: { lat: 10, lng: 76 } });
    mockSharedDependencies(db);
    const { POST } = await import("./route");
    const response = await POST(createRequest({ samples: [{ siteId: "site-1", attendanceSessionId: "foreign", lat: 10, lng: 76, accuracy: 8, capturedAt: capturedAt.toISOString() }] }));
    expect(await response.json()).toMatchObject({ accepted: 0, rejected: 1 });
    expect(db.paths("guardLocations/employee-doc-1/locationHistory/")).toHaveLength(0);
  });

  it("rejects a closed session ID when the sample has no capture timestamp", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    db.seed("attendanceSessions/session-a", { status: "closed", employeeDocId: "employee-doc-1", siteId: "site-1", startedAt: new Date(Date.now() - 2 * 60 * 60_000), endedAt: new Date(Date.now() - 60 * 60_000) });
    mockSharedDependencies(db);
    const { POST } = await import("./route");
    const response = await POST(createRequest({ samples: [{ siteId: "site-1", attendanceSessionId: "session-a", lat: 10, lng: 76, accuracy: 8 }] }));
    expect(await response.json()).toMatchObject({ accepted: 0, rejected: 1 });
    expect(db.paths("guardLocations/employee-doc-1/locationHistory/")).toHaveLength(0);
  });

  it("uses one bounded indexed candidate read for 200 legacy samples despite ancient session history", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    const capturedAt = new Date(Date.now() - 60 * 60_000);
    db.set("attendanceSessions/session-1", { startedAt: new Date(Date.now() - 30_000) }, { merge: true });
    db.seed("attendanceSessions/session-a", { status: "closed", employeeDocId: "employee-doc-1", siteId: "site-1", startedAt: new Date(capturedAt.getTime() - 60 * 60_000), endedAt: new Date(capturedAt.getTime() + 60_000), sourceCollection: "sites" });
    db.seed("attendanceLogs/session-a", { siteCoords: { lat: 10, lng: 76 } });
    for (let i = 0; i < 1_000; i += 1) {
      db.seed(`attendanceSessions/ancient-${i}`, { status: "closed", employeeDocId: "employee-doc-1", siteId: "site-1", startedAt: new Date(Date.now() - 40 * 24 * 60 * 60_000), endedAt: new Date(Date.now() - 39 * 24 * 60 * 60_000) });
    }
    mockSharedDependencies(db);
    const { POST } = await import("./route");
    const samples = Array.from({ length: 200 }, () => ({ siteId: "site-1", lat: 10, lng: 76, accuracy: 8, capturedAt: capturedAt.toISOString() }));
    const response = await POST(createRequest({ samples }));
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({ accepted: 200, rejected: 0 });
    expect(db.queryCount).toBe(1);
    expect(db.queryDocumentCount).toBe(1);
    expect(db.paths("guardLocations/employee-doc-1/locationHistory/")).toHaveLength(1);
    expect(db.get(db.paths("guardLocations/employee-doc-1/locationHistory/")[0])).toMatchObject({ attendanceSessionId: "session-a" });
  });

  it("paginates bounded candidates so a valid older session beyond the first page is still resolved", async () => {
    const db = new FakeFirestore();
    seedActiveSession(db);
    db.set("attendanceSessions/session-1", { startedAt: new Date(Date.now() - 30_000) }, { merge: true });
    const capturedAt = new Date(Date.now() - 6 * 24 * 60 * 60_000);
    db.seed("attendanceSessions/session-a", { status: "closed", employeeDocId: "employee-doc-1", siteId: "site-1", startedAt: new Date(capturedAt.getTime() - 60 * 60_000), endedAt: new Date(capturedAt.getTime() + 60_000), sourceCollection: "sites" });
    db.seed("attendanceLogs/session-a", { siteCoords: { lat: 10, lng: 76 } });
    for (let i = 0; i < 501; i += 1) {
      db.seed(`attendanceSessions/recent-${i}`, { status: "closed", employeeDocId: "employee-doc-1", siteId: "other-site", startedAt: new Date(Date.now() - 2 * 60_000), endedAt: new Date(Date.now() - 60_000) });
    }
    mockSharedDependencies(db);
    const { POST } = await import("./route");
    const response = await POST(createRequest({ samples: [{ siteId: "site-1", lat: 10, lng: 76, accuracy: 8, capturedAt: capturedAt.toISOString() }] }));
    expect(await response.json()).toMatchObject({ accepted: 1, rejected: 0 });
    expect(db.queryCount).toBe(2);
    expect(db.get(db.paths("guardLocations/employee-doc-1/locationHistory/")[0])).toMatchObject({ attendanceSessionId: "session-a" });
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
    expect(body).toMatchObject({ accepted: 2, rejected: 1 });

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
    expect(await response.json()).toMatchObject({ accepted: 0, rejected: 1 });
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
    expect(await response.json()).toMatchObject({ accepted: 1, rejected: 0 });

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

    expect(await response.json()).toMatchObject({ accepted: 0, rejected: 1 });
    expect(db.paths("guardLocations/")).toHaveLength(0);
  });

  it("reports each sample's outcome so the client can retire only permanent rejections", async () => {
    const db = new FakeFirestore();
    const now = Date.now();
    seedActiveSession(db);
    db.set("attendanceSessions/session-1", {
      startedAt: new Date(now - 60_000),
    }, { merge: true });
    mockSharedDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(createRequest({ samples: [
      {
        siteId: "site-1", lat: 10, lng: 76, accuracy: 8,
        capturedAt: new Date(now).toISOString(),
      },
      {
        siteId: "site-1", lat: 10, lng: 76, accuracy: 8,
        capturedAt: new Date(now - 60 * 60_000).toISOString(),
      },
    ] }));

    const body = await response.json();
    expect(body).toMatchObject({ accepted: 1, rejected: 1 });
    expect(body.results).toEqual([
      { index: 0, accepted: true, retryable: false },
      { index: 1, accepted: false, code: "rejected_by_rule", retryable: false },
    ]);
  });

  it("tolerates a device clock slightly behind a server-stamped session start", async () => {
    // The guard check-in flow now sends reportedAtClient, but older installs do
    // not, and a handset can still drift after checking in. Attendance
    // sessions remain server-validated, so a 30s gap between the clocks must
    // not lose the breadcrumbs captured just after checking in.
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

    expect(await response.json()).toMatchObject({ accepted: 1, rejected: 0 });
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
    expect(await response.json()).toMatchObject({ accepted: 1, rejected: 0 });
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
    expect(body).toMatchObject({ accepted: 200, rejected: 5 });
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
