import { afterEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

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
    // Note: intentionally not structuredClone'd — it strips the Firestore
    // Timestamp prototype, which `toMillis` relies on.
    this.docs.set(path, value);
  }

  get(path: string) {
    return this.docs.get(path);
  }

  set(path: string, value: DocValue, options?: { merge?: boolean }) {
    const existing = options?.merge ? this.docs.get(path) ?? {} : {};
    this.docs.set(path, { ...existing, ...value });
  }
}

function seedOpenSession(
  db: FakeFirestore,
  session: DocValue = {},
) {
  db.seed("attendanceState/employee-doc-1", {
    lastStatus: "In",
    lastSiteId: "site-1",
    openSessionId: "session-1",
  });
  db.seed("attendanceSessions/session-1", {
    status: "open",
    employeeDocId: "employee-doc-1",
    siteId: "site-1",
    breakSeconds: 0,
    ...session,
  });
}

function createRequest(body: unknown) {
  return new Request("https://example.test/api/mobile/attendance/break", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockDependencies(db: FakeFirestore) {
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

describe("POST /api/mobile/attendance/break", () => {
  it("starts a break on the open session", async () => {
    const db = new FakeFirestore();
    seedOpenSession(db);
    mockDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(createRequest({ action: "start" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      onBreak: true,
      breakSeconds: 0,
      canCheckOut: false,
    });
    expect(Number.isNaN(Date.parse(body.breakStartedAt))).toBe(false);

    const session = db.get("attendanceSessions/session-1");
    expect(session).toMatchObject({ onBreak: true, breakSeconds: 0 });
    expect(session?.breakStartedAt).toBeInstanceOf(Timestamp);
  });

  it("keeps the original start time when start is repeated", async () => {
    const startedAt = new Date(Date.now() - 60_000);
    const db = new FakeFirestore();
    seedOpenSession(db, {
      onBreak: true,
      breakSeconds: 0,
      breakStartedAt: Timestamp.fromDate(startedAt),
    });
    mockDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(createRequest({ action: "start" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.onBreak).toBe(true);
    expect(Date.parse(body.breakStartedAt)).toBe(startedAt.getTime());
  });

  it("stops a break and accumulates the elapsed seconds", async () => {
    const db = new FakeFirestore();
    seedOpenSession(db, {
      onBreak: true,
      breakSeconds: 900,
      breakStartedAt: Timestamp.fromDate(new Date(Date.now() - 60_000)),
    });
    mockDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(
      createRequest({ action: "stop", lat: 10, lng: 76, accuracy: 8 }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.onBreak).toBe(false);
    expect(body.canCheckOut).toBe(true);
    expect(body.breakSeconds).toBeGreaterThanOrEqual(959);
    expect(body.breakSeconds).toBeLessThan(975);

    const session = db.get("attendanceSessions/session-1");
    expect(session).toMatchObject({ onBreak: false });
    expect(session?.breakSeconds).toBe(body.breakSeconds);
    expect(session?.breakStartedAt).toBeNull();
  });

  it("treats stop without an active break as a no-op", async () => {
    const db = new FakeFirestore();
    seedOpenSession(db, { breakSeconds: 300 });
    mockDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(createRequest({ action: "stop" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      onBreak: false,
      breakSeconds: 300,
      canCheckOut: true,
    });
    expect(db.get("attendanceSessions/session-1")?.breakSeconds).toBe(300);
  });

  it("requires an open IN session", async () => {
    const db = new FakeFirestore();
    db.seed("attendanceState/employee-doc-1", { lastStatus: "Out" });
    mockDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(createRequest({ action: "start" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("open IN session"),
    });
  });

  it("rejects an unknown action", async () => {
    const db = new FakeFirestore();
    seedOpenSession(db);
    mockDependencies(db);

    const { POST } = await import("./route");
    const response = await POST(createRequest({ action: "pause" }));

    expect(response.status).toBe(400);
  });

  it("does not start a break after checkout closes the session", async () => {
    const db = new FakeFirestore();
    seedOpenSession(db);
    mockDependencies(db);

    const originalRunTransaction = db.runTransaction.bind(db);
    let releaseValidation!: () => void;
    let announceTransaction!: () => void;
    const transactionWaiting = new Promise<void>((resolve) => { announceTransaction = resolve; });
    const gate = new Promise<void>((resolve) => { releaseValidation = resolve; });
    vi.spyOn(db, "runTransaction").mockImplementation((callback: any) => {
      announceTransaction();
      return gate.then(() => originalRunTransaction(callback));
    });

    const { POST } = await import("./route");
    const responsePromise = POST(createRequest({ action: "start" }));
    await transactionWaiting;
    db.set("attendanceState/employee-doc-1", {
      lastStatus: "Out", openSessionId: null, onBreak: false,
    }, { merge: true });
    db.set("attendanceSessions/session-1", { status: "closed", onBreak: false }, { merge: true });
    releaseValidation();
    const response = await responsePromise;

    expect(response.status).toBe(409);
    expect(db.get("attendanceSessions/session-1")?.onBreak).toBe(false);
    expect(db.get("attendanceState/employee-doc-1")?.onBreak).toBe(false);
  });
});
