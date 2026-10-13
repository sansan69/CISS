import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { parseGuardPhoneInput } from "../lib/guard/identity-utils";
import { buildFailedPinAttemptUpdate } from "../lib/guard/login-attempt-utils";
import {
  hashPin,
  verifyPin,
  verifyPinWithMetadata,
} from "../lib/guard/pin-utils";

type Filter = { field: string; op: "==" | ">=" | "<="; value: unknown };

const deleteSentinel = { __op: "delete" } as const;
const serverTimestampSentinel = { __op: "serverTimestamp" } as const;

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

class FakeDocSnapshot {
  constructor(
    readonly id: string,
    private readonly value: Record<string, unknown> | undefined,
  ) {}

  get exists() {
    return Boolean(this.value);
  }

  data() {
    return this.value;
  }
}

class FakeDocRef {
  constructor(
    private readonly store: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  async get() {
    return new FakeDocSnapshot(
      this.id,
      this.store.getDoc(this.collectionName, this.id),
    );
  }

  async set(value: Record<string, unknown>, options?: { merge?: boolean }) {
    this.store.setDoc(this.collectionName, this.id, value, options);
  }

  async update(value: Record<string, unknown>) {
    this.store.updateDoc(this.collectionName, this.id, value);
  }

  async delete() {
    this.store.deleteDoc(this.collectionName, this.id);
  }
}

class FakeQuerySnapshot {
  constructor(
    readonly docs: Array<{
      id: string;
      data: () => Record<string, unknown>;
      ref: FakeDocRef;
    }>,
  ) {}

  get empty() {
    return this.docs.length === 0;
  }
}

class FakeQuery {
  constructor(
    protected readonly store: FakeFirestore,
    protected readonly collectionName: string,
    protected readonly filters: Filter[] = [],
    protected readonly limitCount?: number,
  ) {}

  where(field: string, op: Filter["op"], value: unknown) {
    return new FakeQuery(
      this.store,
      this.collectionName,
      [...this.filters, { field, op, value }],
      this.limitCount,
    );
  }

  limit(value: number) {
    return new FakeQuery(this.store, this.collectionName, this.filters, value);
  }

  async get() {
    this.store.queryCount += 1;
    const docs = this.store
      .listDocs(this.collectionName)
      .filter(({ data }) =>
        this.filters.every((filter) => matchFilter(data, filter)),
      );
    const limited =
      typeof this.limitCount === "number"
        ? docs.slice(0, this.limitCount)
        : docs;

    return new FakeQuerySnapshot(
      limited.map(({ id, data }) => ({
        id,
        data: () => data,
        ref: new FakeDocRef(this.store, this.collectionName, id),
      })),
    );
  }
}

class FakeCollectionRef extends FakeQuery {
  doc(id?: string) {
    return new FakeDocRef(
      this.store,
      this.collectionName,
      id ?? `${this.collectionName}-auto`,
    );
  }

  async add(value: Record<string, unknown>) {
    const id = `${this.collectionName}-${this.store.listDocs(this.collectionName).length + 1}`;
    this.store.seed(this.collectionName, id, value);
    return new FakeDocRef(this.store, this.collectionName, id);
  }
}

class FakeFirestore {
  queryCount = 0;
  private transactionTail: Promise<void> = Promise.resolve();
  private readonly collections = new Map<
    string,
    Map<string, Record<string, unknown>>
  >();

  collection(name: string) {
    return new FakeCollectionRef(this, name);
  }

  async runTransaction<T>(
    callback: (transaction: {
      get(ref: FakeDocRef): Promise<FakeDocSnapshot>;
      set(
        ref: FakeDocRef,
        value: Record<string, unknown>,
        options?: { merge?: boolean },
      ): void;
      update(ref: FakeDocRef, value: Record<string, unknown>): void;
    }) => Promise<T>,
  ) {
    let release: (() => void) | undefined;
    const previousTransaction = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previousTransaction;

    try {
      return await callback({
        get: (ref) => ref.get(),
        set: (ref, value, options) => {
          void ref.set(value, options);
        },
        update: (ref, value) => {
          void ref.update(value);
        },
      });
    } finally {
      release?.();
    }
  }

  doc(path: string) {
    const [collectionName, id] = path.split("/");
    if (!collectionName || !id) {
      throw new Error(`Unsupported document path: ${path}`);
    }

    return new FakeDocRef(this, collectionName, id);
  }

  seed(collectionName: string, id: string, value: Record<string, unknown>) {
    this.ensureCollection(collectionName).set(id, cloneValue(value));
  }

  listDocs(collectionName: string) {
    return Array.from(this.ensureCollection(collectionName).entries()).map(
      ([id, data]) => ({ id, data }),
    );
  }

  getDoc(collectionName: string, id: string) {
    return this.ensureCollection(collectionName).get(id);
  }

  setDoc(
    collectionName: string,
    id: string,
    value: Record<string, unknown>,
    options?: { merge?: boolean },
  ) {
    const current = this.getDoc(collectionName, id);
    const next = options?.merge && current ? { ...current, ...value } : value;
    this.ensureCollection(collectionName).set(
      id,
      this.applyTransforms(current ?? {}, next),
    );
  }

  updateDoc(
    collectionName: string,
    id: string,
    value: Record<string, unknown>,
  ) {
    const current = this.getDoc(collectionName, id);
    if (!current) {
      throw new Error(`Document ${collectionName}/${id} does not exist.`);
    }

    this.ensureCollection(collectionName).set(
      id,
      this.applyTransforms(current, value),
    );
  }

  deleteDoc(collectionName: string, id: string) {
    this.ensureCollection(collectionName).delete(id);
  }

  private applyTransforms(
    current: Record<string, unknown>,
    update: Record<string, unknown>,
  ) {
    const next = { ...cloneValue(current) };

    for (const [key, value] of Object.entries(update)) {
      if (value && typeof value === "object" && "__op" in value) {
        if (value === deleteSentinel) {
          delete next[key];
          continue;
        }

        if (value === serverTimestampSentinel) {
          next[key] = "SERVER_TIMESTAMP";
          continue;
        }
      }

      next[key] = cloneValue(value);
    }

    return next;
  }

  private ensureCollection(name: string) {
    const existing = this.collections.get(name);
    if (existing) {
      return existing;
    }

    const created = new Map<string, Record<string, unknown>>();
    this.collections.set(name, created);
    return created;
  }
}

function matchFilter(data: Record<string, unknown>, filter: Filter) {
  const actual = data[filter.field];
  switch (filter.op) {
    case "==":
      return actual === filter.value;
    default:
      return false;
  }
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/firebaseAdmin");
  vi.doUnmock("firebase-admin/firestore");
  vi.doUnmock("@/lib/guard/identity-utils");
  vi.doUnmock("@/lib/guard/pin-utils");
  vi.doUnmock("@/lib/runtime-config");
  vi.doUnmock("@/lib/qr/employee-qr");
  vi.doUnmock("@/lib/server/auth");
  vi.doUnmock("@/lib/server/rate-limit");
  vi.doUnmock("@/lib/districts");
});

describe("guard auth routes", () => {
  it.each([
    ["incorrect legacy SHA-256", createHash("sha256").update("9999").digest("hex")],
    ["empty stored hash", ""],
    ["malformed stored hash", "not-a-pin-hash"],
    ["unknown scrypt version", "scrypt-v2$16384$8$1$salt$hash"],
  ])(
    "marks %s as needing dummy memory-hard work when verification fails",
    async (_name, storedHash) => {
      await expect(verifyPinWithMetadata("1234", storedHash)).resolves.toEqual({
        valid: false,
        needsMigration: false,
        performedMemoryHardWork: false,
      });
    },
  );

  function mockPinStatusDependencies(
    adminDb: FakeFirestore,
    checkRateLimit = vi.fn().mockResolvedValue({ allowed: true }),
  ) {
    const buildRateLimitKey = vi.fn(
      (endpoint: string, identifier: string) => `${endpoint}:${identifier}`,
    );
    vi.doMock("@/lib/firebaseAdmin", () => ({ db: adminDb }));
    vi.doMock("@/lib/server/rate-limit", () => ({
      buildRateLimitKey,
      checkRateLimit,
      getClientIp: vi.fn(() => "203.0.113.10"),
    }));
    return { buildRateLimitKey, checkRateLimit };
  }

  function pinStatusRequest(body: Record<string, unknown>) {
    return new Request("https://cisskerala.app/api/guard/auth/pin-status", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.10",
      },
      body: JSON.stringify(body),
    });
  }

  it("returns the same state-free response for unknown, setup-eligible, and PIN-configured guards", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("employees", "emp-awaiting-setup", {
      employeeId: "EMP-AWAITING-SETUP",
      phoneNumber: "9999999999",
      name: "Do not expose",
    });
    adminDb.seed("employees", "emp-with-pin", {
      employeeId: "EMP-WITH-PIN",
      phoneNumber: "7777777777",
      name: "Do not expose",
      guardPin: "hash",
      guardAuthUid: "guard-uid",
    });
    mockPinStatusDependencies(adminDb);

    const { POST } = await import("./api/guard/auth/pin-status/route");
    const unknown = await POST(
      pinStatusRequest({ phoneNumber: "8888888888" }) as never,
    );
    const awaitingSetup = await POST(
      pinStatusRequest({ phoneNumber: "999 999-9999" }) as never,
    );
    const configured = await POST(
      pinStatusRequest({ phoneNumber: "7777777777" }) as never,
    );

    const expected = {
      message: "Continue to sign in or set up your PIN.",
    };
    await expect(unknown.json()).resolves.toEqual(expected);
    await expect(awaitingSetup.json()).resolves.toEqual(expected);
    await expect(configured.json()).resolves.toEqual(expected);
    expect(adminDb.queryCount).toBe(0);
  });

  it("rejects malformed phone input after applying the IP limit and before any employee lookup", async () => {
    const adminDb = new FakeFirestore();
    const { checkRateLimit } = mockPinStatusDependencies(adminDb);

    const { POST } = await import("./api/guard/auth/pin-status/route");
    const response = await POST(
      pinStatusRequest({ phoneNumber: "999abc9999" }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A valid 8 to 15 digit phone number is required.",
    });
    expect(checkRateLimit).toHaveBeenCalledOnce();
    expect(checkRateLimit).toHaveBeenCalledWith(
      "guard-pin-status-ip:203.0.113.10",
      { maxRequests: 15, windowMs: 60_000, failClosed: true },
    );
    expect(adminDb.queryCount).toBe(0);
  });

  it.each([
    ["disallowed characters", "CISS;LNG;2026", "A valid employee ID is required."],
    ["oversized input", "A".repeat(129), "A valid employee ID is required."],
  ])(
    "rejects PIN-status employee IDs with %s before identifier fingerprinting",
    async (_name, employeeId, error) => {
      const adminDb = new FakeFirestore();
      const { buildRateLimitKey, checkRateLimit } =
        mockPinStatusDependencies(adminDb);
      const { POST } = await import("./api/guard/auth/pin-status/route");

      const response = await POST(pinStatusRequest({ employeeId }) as never);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error });
      expect(checkRateLimit).toHaveBeenCalledOnce();
      expect(buildRateLimitKey).toHaveBeenCalledWith(
        "guard-pin-status-ip",
        "203.0.113.10",
      );
      expect(
        buildRateLimitKey.mock.calls.some(
          ([endpoint]) => endpoint === "guard-pin-status-identifier",
        ),
      ).toBe(false);
      expect(adminDb.queryCount).toBe(0);
    },
  );

  it.each([
    ["number", 9999999999],
    ["null", null],
    ["array", ["9999999999"]],
    ["object", { value: "9999999999" }],
  ])(
    "rejects a present non-string PIN-status phone number (%s) before employee lookup",
    async (_name, phoneNumber) => {
      const adminDb = new FakeFirestore();
      const { buildRateLimitKey, checkRateLimit } =
        mockPinStatusDependencies(adminDb);
      const { POST } = await import("./api/guard/auth/pin-status/route");

      const response = await POST(
        pinStatusRequest({ employeeId: "EMP001", phoneNumber }) as never,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "A valid 8 to 15 digit phone number is required.",
      });
      expect(adminDb.queryCount).toBe(0);
      expect(checkRateLimit).toHaveBeenCalledOnce();
      expect(
        buildRateLimitKey.mock.calls.some(
          ([endpoint]) => endpoint === "guard-pin-status-identifier",
        ),
      ).toBe(false);
    },
  );

  it("uses fail-closed distributed IP and identifier limits before the lookup", async () => {
    const adminDb = new FakeFirestore();
    const checkRateLimit = vi
      .fn()
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false });
    const { buildRateLimitKey } = mockPinStatusDependencies(
      adminDb,
      checkRateLimit,
    );

    const { POST } = await import("./api/guard/auth/pin-status/route");
    const response = await POST(
      pinStatusRequest({ phoneNumber: "9999999999" }) as never,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Too many requests. Please wait a moment and try again.",
    });
    expect(checkRateLimit).toHaveBeenCalledTimes(2);
    expect(checkRateLimit).toHaveBeenNthCalledWith(
      1,
      "guard-pin-status-ip:203.0.113.10",
      { maxRequests: 15, windowMs: 60_000, failClosed: true },
    );
    expect(buildRateLimitKey).toHaveBeenNthCalledWith(
      2,
      "guard-pin-status-identifier",
      expect.stringMatching(/^[a-f0-9]{24}$/),
    );
    expect(checkRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("guard-pin-status-identifier:"),
      { maxRequests: 5, windowMs: 60_000, failClosed: true },
    );
  });

  it("denies PIN-status checks when the fail-closed IP limiter denies the request", async () => {
    const adminDb = new FakeFirestore();
    const checkRateLimit = vi.fn().mockResolvedValue({ allowed: false });
    mockPinStatusDependencies(adminDb, checkRateLimit);

    const { POST } = await import("./api/guard/auth/pin-status/route");
    const response = await POST(
      pinStatusRequest({ employeeId: "EMP001" }) as never,
    );

    expect(response.status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledOnce();
    expect(checkRateLimit).toHaveBeenCalledWith(
      "guard-pin-status-ip:203.0.113.10",
      { maxRequests: 15, windowMs: 60_000, failClosed: true },
    );
  });

  it("charges both supplied identifiers before performing a dual-identifier lookup", async () => {
    const adminDb = new FakeFirestore();
    const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true });
    const { buildRateLimitKey } = mockPinStatusDependencies(
      adminDb,
      checkRateLimit,
    );

    const { POST } = await import("./api/guard/auth/pin-status/route");
    await POST(
      pinStatusRequest({
        employeeId: "EMP001",
        phoneNumber: "9999999999",
      }) as never,
    );

    expect(checkRateLimit).toHaveBeenCalledTimes(3);
    const identifierKeys = buildRateLimitKey.mock.calls
      .filter(([endpoint]) => endpoint === "guard-pin-status-identifier")
      .map(([, identifier]) => identifier);
    expect(identifierKeys).toHaveLength(2);
    expect(new Set(identifierKeys).size).toBe(2);
  });

  it("limits invalid JSON by IP and returns a client error", async () => {
    const adminDb = new FakeFirestore();
    const { checkRateLimit } = mockPinStatusDependencies(adminDb);
    const { POST } = await import("./api/guard/auth/pin-status/route");

    const response = await POST(
      new Request("https://cisskerala.app/api/guard/auth/pin-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request body.",
    });
    expect(checkRateLimit).toHaveBeenCalledOnce();
  });

  it("rejects a JSON null body after applying the IP limit", async () => {
    const adminDb = new FakeFirestore();
    const { checkRateLimit } = mockPinStatusDependencies(adminDb);
    const { POST } = await import("./api/guard/auth/pin-status/route");

    const response = await POST(pinStatusRequest({}) as never);

    // A literal null is valid JSON but not a valid request object.
    const nullResponse = await POST(
      new Request("https://cisskerala.app/api/guard/auth/pin-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(nullResponse.status).toBe(400);
    await expect(nullResponse.json()).resolves.toEqual({
      error: "Invalid request body.",
    });
    expect(checkRateLimit).toHaveBeenCalledTimes(2);
  });

  it("canonicalizes Indian country-code formatting and rejects malformed phone characters", () => {
    expect(parseGuardPhoneInput("+91 (99999) 99999")).toBe("9999999999");
    expect(parseGuardPhoneInput("0091-99999-99999")).toBe("9999999999");
    expect(parseGuardPhoneInput("99999-99999")).toBe("9999999999");
    expect(parseGuardPhoneInput("999abc9999")).toBeNull();
    expect(parseGuardPhoneInput("9999999")).toBeNull();
    expect(parseGuardPhoneInput("9999999999999999")).toBeNull();
  });

  it("accepts generated employee-ID characters before PIN-status fingerprinting", async () => {
    const adminDb = new FakeFirestore();
    const { buildRateLimitKey, checkRateLimit } =
      mockPinStatusDependencies(adminDb);
    const { POST } = await import("./api/guard/auth/pin-status/route");

    const response = await POST(
      pinStatusRequest({ employeeId: "CISS/LNG/2026-27/001" }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Continue to sign in or set up your PIN.",
    });
    expect(checkRateLimit).toHaveBeenCalledTimes(2);
    expect(buildRateLimitKey).toHaveBeenNthCalledWith(
      2,
      "guard-pin-status-identifier",
      expect.stringMatching(/^[a-f0-9]{24}$/),
    );
  });

  it("uses the same public failure for every login and setup credential state", async () => {
    const adminDb = new FakeFirestore();
    const configuredPin = await hashPin("1234");
    const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true });
    const buildRateLimitKey = vi.fn(
      (endpoint: string, identifier: string) => `${endpoint}:${identifier}`,
    );

    adminDb.seed("employees", "inactive", {
      employeeId: "CISS/INACTIVE/001",
      phoneNumber: "9000000001",
      status: "Inactive",
      guardPin: configuredPin,
      guardAuthUid: "inactive-uid",
    });
    adminDb.seed("employees", "unconfigured", {
      employeeId: "CISS/SETUP/001",
      phoneNumber: "9000000002",
    });
    adminDb.seed("employees", "wrong-pin", {
      employeeId: "CISS/PIN/001",
      phoneNumber: "9000000003",
      guardPin: configuredPin,
      guardAuthUid: "wrong-pin-uid",
    });
    adminDb.seed("employees", "locked", {
      employeeId: "CISS/LOCKED/001",
      phoneNumber: "9000000004",
      guardPin: configuredPin,
      guardAuthUid: "locked-uid",
      guardLockoutUntil: new Date(Date.now() + 15 * 60 * 1000),
    });
    adminDb.seed("employees", "wrong-dob", {
      employeeId: "CISS/DOB/001",
      phoneNumber: "9000000005",
      dateOfBirth: "1990-01-01",
    });
    adminDb.seed("employees", "configured-setup", {
      employeeId: "CISS/CONFIGURED/001",
      phoneNumber: "9000000006",
      dateOfBirth: "1990-01-01",
      guardPin: configuredPin,
      guardAuthUid: "configured-uid",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
      auth: {
        createCustomToken: vi.fn(),
        createUser: vi.fn(),
        getUserByEmail: vi.fn(),
        setCustomUserClaims: vi.fn(),
      },
      customTokenAuth: null,
    }));
    vi.doMock("@/lib/server/rate-limit", () => ({
      buildRateLimitKey,
      checkRateLimit,
      getClientIp: vi.fn(() => "203.0.113.10"),
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
        delete: () => deleteSentinel,
      },
    }));

    const { POST: login } = await import("./api/guard/auth/login/route");
    const { POST: setup } = await import("./api/guard/auth/setup-pin/route");
    const request = (path: string, body: Record<string, unknown>) =>
      new Request(`https://cisskerala.app${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const cases = [
      {
        name: "unknown login",
        call: () =>
          login(
            request("/api/guard/auth/login", {
              phoneNumber: "9000000000",
              pin: "1234",
            }),
          ),
      },
      {
        name: "inactive login",
        call: () =>
          login(
            request("/api/guard/auth/login", {
              phoneNumber: "9000000001",
              pin: "1234",
            }),
          ),
      },
      {
        name: "PIN-unconfigured login",
        call: () =>
          login(
            request("/api/guard/auth/login", {
              phoneNumber: "9000000002",
              pin: "1234",
            }),
          ),
      },
      {
        name: "incorrect PIN",
        call: () =>
          login(
            request("/api/guard/auth/login", {
              phoneNumber: "9000000003",
              pin: "9999",
            }),
          ),
      },
      {
        name: "locked login",
        call: () =>
          login(
            request("/api/guard/auth/login", {
              phoneNumber: "9000000004",
              pin: "1234",
            }),
          ),
      },
      {
        name: "wrong date of birth",
        call: () =>
          setup(
            request("/api/guard/auth/setup-pin", {
              phoneNumber: "9000000005",
              dateOfBirth: "1991-01-01",
              pin: "1234",
            }),
          ),
      },
      {
        name: "wrong employee identity",
        call: () =>
          setup(
            request("/api/guard/auth/setup-pin", {
              employeeId: "CISS/DOB/001",
              phoneNumber: "9000000007",
              dateOfBirth: "1990-01-01",
              pin: "1234",
            }),
          ),
      },
      {
        name: "already-configured setup",
        call: () =>
          setup(
            request("/api/guard/auth/setup-pin", {
              phoneNumber: "9000000006",
              dateOfBirth: "1990-01-01",
              pin: "1234",
            }),
          ),
      },
    ];

    const responses = [];
    for (const testCase of cases) {
      const response = await testCase.call();
      responses.push({
        name: testCase.name,
        status: response.status,
        body: await response.json(),
      });
    }

    expect(responses).toEqual(
      cases.map(({ name }) => ({
        name,
        status: 401,
        body: { error: "Invalid sign-in details. Please try again." },
      })),
    );
    expect(responses.find(({ name }) => name === "locked login")?.body).not.toHaveProperty(
      "lockedUntil",
    );
  });

  it("applies the same fail-closed identifier limiter before unknown and known login failures", async () => {
    const adminDb = new FakeFirestore();
    const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true });
    const buildRateLimitKey = vi.fn(
      (endpoint: string, identifier: string) => `${endpoint}:${identifier}`,
    );

    adminDb.seed("employees", "known", {
      phoneNumber: "9010000000",
      guardPin: await hashPin("1234"),
      guardAuthUid: "known-uid",
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({ db: adminDb }));
    vi.doMock("@/lib/server/rate-limit", () => ({
      buildRateLimitKey,
      checkRateLimit,
      getClientIp: vi.fn(() => "203.0.113.10"),
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
        delete: () => deleteSentinel,
      },
    }));

    const { POST } = await import("./api/guard/auth/login/route");
    const request = (phoneNumber: string, pin: string) =>
      new Request("https://cisskerala.app/api/guard/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber, pin }),
      });

    await POST(request("9010000001", "1234"));
    await POST(request("9010000000", "9999"));

    expect(checkRateLimit).toHaveBeenCalledTimes(4);
    const identifierCalls = buildRateLimitKey.mock.calls.filter(
      ([endpoint]) => endpoint === "guard-login-identifier",
    );
    expect(identifierCalls).toHaveLength(2);
    expect(identifierCalls.every(([, fingerprint]) => /^[a-f0-9]{24}$/.test(fingerprint))).toBe(
      true,
    );
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.stringMatching(/^guard-login-identifier:/),
      {
        maxRequests: 10,
        windowMs: 15 * 60 * 1000,
        failClosed: true,
      },
    );
  });

  it("runs dummy scrypt work for failed legacy, empty, malformed, and unknown-version PIN hashes", async () => {
    const adminDb = new FakeFirestore();
    const verifyDummyPin = vi.fn().mockResolvedValue(undefined);
    const verifyPinWithMetadata = vi.fn().mockResolvedValue({
      valid: false,
      needsMigration: false,
      performedMemoryHardWork: false,
    });
    const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true });

    [
      ["legacy", createHash("sha256").update("9999").digest("hex")],
      ["empty", ""],
      ["malformed", "not-a-pin-hash"],
      ["unknown-version", "scrypt-v2$16384$8$1$salt$hash"],
    ].forEach(([id, guardPin], index) => {
      adminDb.seed("employees", id, {
        phoneNumber: `977777777${index}`,
        guardPin,
        guardAuthUid: `guard-${id}`,
      });
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
      auth: { createCustomToken: vi.fn() },
      customTokenAuth: null,
    }));
    vi.doMock("@/lib/guard/pin-utils", () => ({
      hashPin: vi.fn(),
      validatePinFormat: () => true,
      verifyDummyPin,
      verifyPinWithMetadata,
    }));
    vi.doMock("@/lib/server/rate-limit", () => ({
      buildRateLimitKey: (endpoint: string, identifier: string) =>
        `${endpoint}:${identifier}`,
      checkRateLimit,
      getClientIp: vi.fn(() => "203.0.113.10"),
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
        delete: () => deleteSentinel,
      },
    }));

    const { POST } = await import("./api/guard/auth/login/route");
    for (let index = 0; index < 4; index += 1) {
      const response = await POST(
        new Request("https://cisskerala.app/api/guard/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            phoneNumber: `977777777${index}`,
            pin: "1234",
          }),
        }),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Invalid sign-in details. Please try again.",
      });
    }

    expect(verifyPinWithMetadata).toHaveBeenCalledTimes(4);
    expect(verifyDummyPin).toHaveBeenCalledTimes(4);
    expect(verifyDummyPin).toHaveBeenCalledWith("1234");
  });

  it("accepts +91 and 0091 logins even if an old login rate-limit document exists", async () => {
    const adminDb = new FakeFirestore();
    const guardPin = await hashPin("1234");

    adminDb.seed("employees", "emp-1", {
      employeeId: "EMP001",
      phoneNumber: "9999999999",
      name: "Guard One",
      guardPin,
      guardAuthUid: "guard-uid-1",
      guardFailedAttempts: 4,
    });
    adminDb.seed("rateLimits", "login_9999999999", {
      windowStart: Date.now(),
      attempts: 99,
    });

    const createCustomToken = vi.fn().mockResolvedValue("guard-token");

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
      auth: {
        createCustomToken,
      },
      customTokenAuth: null,
    }));
    vi.doMock(
      "@/lib/guard/identity-utils",
      async () => await import("../lib/guard/identity-utils"),
    );
    vi.doMock(
      "@/lib/guard/pin-utils",
      async () => await import("../lib/guard/pin-utils"),
    );
    vi.doMock("firebase-admin/firestore", () => ({
      Timestamp: {
        now: () => ({ toDate: () => new Date() }),
        fromDate: (date: Date) => ({ toDate: () => date }),
      },
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
        delete: () => deleteSentinel,
      },
    }));

    const { POST } = await import("./api/guard/auth/login/route");
    for (const phoneNumber of ["+91 9999999999", "0091 9999999999"]) {
      const response = await POST(
        new Request("https://cisskerala.app/api/guard/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
          body: JSON.stringify({ phoneNumber, pin: "1234" }),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        token: "guard-token",
        employeeName: "Guard One",
      });
    }
    expect(createCustomToken).toHaveBeenCalledWith("guard-uid-1", {
      role: "guard",
      employeeId: "EMP001",
      employeeDocId: "emp-1",
    });
    expect(adminDb.getDoc("employees", "emp-1")).toEqual(
      expect.objectContaining({
        guardFailedAttempts: 0,
        guardLastLogin: "SERVER_TIMESTAMP",
      }),
    );
  });

  it("accepts DOB verification when enrollment stored a timezone-shifted timestamp", async () => {
    const adminDb = new FakeFirestore();

    adminDb.seed("employees", "emp-2", {
      employeeId: "EMP002",
      phoneNumber: "8888888888",
      name: "Guard Two",
    });
    adminDb.updateDoc("employees", "emp-2", {
      dateOfBirth: {
        toDate() {
          return new Date("1998-12-03T18:30:00.000Z");
        },
      },
    });

    const createUser = vi.fn().mockResolvedValue({ uid: "guard-uid-2" });
    const setCustomUserClaims = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
      auth: {
        createUser,
        setCustomUserClaims,
      },
    }));
    vi.doMock(
      "@/lib/guard/identity-utils",
      async () => await import("../lib/guard/identity-utils"),
    );
    vi.doMock(
      "@/lib/guard/pin-utils",
      async () => await import("../lib/guard/pin-utils"),
    );
    vi.doMock("@/lib/runtime-config", () => ({
      GUARD_AUTH_EMAIL_DOMAIN: "guard.cisskerala.app",
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      Timestamp: {
        now: () => ({ toDate: () => new Date() }),
        fromDate: (date: Date) => ({ toDate: () => date }),
      },
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
        delete: () => deleteSentinel,
      },
    }));

    const { POST } = await import("./api/guard/auth/setup-pin/route");
    const response = await POST(
      new Request("https://cisskerala.app/api/guard/auth/setup-pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phoneNumber: "8888888888",
          dateOfBirth: "1998-12-04",
          pin: "1234",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "PIN set successfully. You can now log in.",
    });
    expect(createUser).toHaveBeenCalledOnce();
    expect(setCustomUserClaims).toHaveBeenCalledWith("guard-uid-2", {
      role: "guard",
      employeeId: "EMP002",
      employeeDocId: "emp-2",
    });
    expect(adminDb.getDoc("employees", "emp-2")).toEqual(
      expect.objectContaining({
        guardAuthUid: "guard-uid-2",
        guardPinSetAt: "SERVER_TIMESTAMP",
        guardFailedAttempts: 0,
      }),
    );
  });

  it("denies setup PIN by IP before parsing the body or looking up an employee", async () => {
    const adminDb = new FakeFirestore();
    const checkRateLimit = vi.fn().mockResolvedValue({ allowed: false });
    const buildRateLimitKey = vi.fn(
      (endpoint: string, identifier: string) => `${endpoint}:${identifier}`,
    );
    vi.doMock("@/lib/firebaseAdmin", () => ({ db: adminDb }));
    vi.doMock("@/lib/server/rate-limit", () => ({
      buildRateLimitKey,
      checkRateLimit,
      getClientIp: vi.fn(() => "203.0.113.10"),
    }));

    const { POST } = await import("./api/guard/auth/setup-pin/route");
    const response = await POST(
      new Request("https://cisskerala.app/api/guard/auth/setup-pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Too many login attempts. Please wait and try again.",
    });
    expect(checkRateLimit).toHaveBeenCalledOnce();
    expect(checkRateLimit).toHaveBeenCalledWith(
      "guard-setup-pin-ip:203.0.113.10",
      { maxRequests: 15, windowMs: 60_000, failClosed: true },
    );
    expect(adminDb.queryCount).toBe(0);
  });

  it("rejects a setup PIN identifier limit before every employee lookup", async () => {
    const adminDb = new FakeFirestore();
    const checkRateLimit = vi
      .fn()
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false });
    const buildRateLimitKey = vi.fn(
      (endpoint: string, identifier: string) => `${endpoint}:${identifier}`,
    );
    vi.doMock("@/lib/firebaseAdmin", () => ({ db: adminDb }));
    vi.doMock("@/lib/server/rate-limit", () => ({
      buildRateLimitKey,
      checkRateLimit,
      getClientIp: vi.fn(() => "203.0.113.10"),
    }));

    const { POST } = await import("./api/guard/auth/setup-pin/route");
    const response = await POST(
      new Request("https://cisskerala.app/api/guard/auth/setup-pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phoneNumber: "9999999999",
          dateOfBirth: "1990-01-01",
          pin: "1234",
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledTimes(2);
    expect(buildRateLimitKey).toHaveBeenNthCalledWith(
      2,
      "guard-setup-pin-identifier",
      expect.stringMatching(/^[a-f0-9]{24}$/),
    );
    expect(adminDb.queryCount).toBe(0);
  });

  it("keeps a valid phone neutral when its supplied employee ID is unknown", async () => {
    const adminDb = new FakeFirestore();
    const createUser = vi.fn();
    const setCustomUserClaims = vi.fn();
    adminDb.seed("employees", "known-employee", {
      employeeId: "EMP-KNOWN",
      phoneNumber: "9000000000",
      dateOfBirth: "1990-01-01",
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
      auth: { createUser, setCustomUserClaims },
    }));
    vi.doMock("@/lib/server/rate-limit", () => ({
      buildRateLimitKey: (endpoint: string, identifier: string) => `${endpoint}:${identifier}`,
      checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
      getClientIp: vi.fn(() => "203.0.113.10"),
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
        delete: () => deleteSentinel,
      },
    }));

    const { POST } = await import("./api/guard/auth/setup-pin/route");
    const response = await POST(new Request("https://cisskerala.app/api/guard/auth/setup-pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        employeeId: "EMP-UNKNOWN",
        phoneNumber: "9000000000",
        dateOfBirth: "1990-01-01",
        pin: "1234",
      }),
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid sign-in details. Please try again." });
    expect(createUser).not.toHaveBeenCalled();
    expect(setCustomUserClaims).not.toHaveBeenCalled();
    expect(adminDb.getDoc("employees", "known-employee")).toEqual({
      employeeId: "EMP-KNOWN",
      phoneNumber: "9000000000",
      dateOfBirth: "1990-01-01",
    });
  });

  it.each([
    ["+91 81111 11111", "0091 81111 11111"],
    ["0091 82222 22222", "+91 82222 22222"],
  ])(
    "supports first-time setup with %s and subsequent login with %s",
    async (setupPhone, loginPhone) => {
      const adminDb = new FakeFirestore();
      const phoneNumber = parseGuardPhoneInput(setupPhone)!;
      const createUser = vi.fn().mockResolvedValue({ uid: "format-guard-uid" });
      const createCustomToken = vi.fn().mockResolvedValue("format-token");
      const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true });
      const buildRateLimitKey = vi.fn(
        (endpoint: string, identifier: string) => `${endpoint}:${identifier}`,
      );
      adminDb.seed("employees", "format-guard", {
        employeeId: "EMP-FORMAT",
        phoneNumber,
        dateOfBirth: "1990-01-01",
        name: "Format Guard",
      });
      vi.doMock("@/lib/firebaseAdmin", () => ({
        db: adminDb,
        auth: {
          createUser,
          createCustomToken,
          getUserByEmail: vi.fn().mockRejectedValue(new Error("not found")),
          setCustomUserClaims: vi.fn(),
        },
        customTokenAuth: null,
      }));
      vi.doMock("@/lib/server/rate-limit", () => ({
        buildRateLimitKey,
        checkRateLimit,
        getClientIp: vi.fn(() => "203.0.113.10"),
      }));
      vi.doMock("@/lib/runtime-config", () => ({
        GUARD_AUTH_EMAIL_DOMAIN: "guard.cisskerala.app",
      }));
      vi.doMock("firebase-admin/firestore", () => ({
        FieldValue: {
          serverTimestamp: () => serverTimestampSentinel,
          delete: () => deleteSentinel,
        },
      }));

      const { POST: setup } = await import("./api/guard/auth/setup-pin/route");
      const { POST: login } = await import("./api/guard/auth/login/route");
      const setupResponse = await setup(
        new Request("https://cisskerala.app/api/guard/auth/setup-pin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            employeeId: "EMP-FORMAT",
            phoneNumber: setupPhone,
            dateOfBirth: "1990-01-01",
            pin: "1234",
          }),
        }),
      );

      expect(setupResponse.status).toBe(200);
      const storedPin = adminDb.getDoc("employees", "format-guard")?.guardPin;
      expect(typeof storedPin).toBe("string");
      expect(storedPin).toMatch(/^scrypt-v1\$/);
      expect(await verifyPin("1234", storedPin as string)).toBe(true);
      expect(
        buildRateLimitKey.mock.calls.filter(
          ([endpoint]) => endpoint === "guard-setup-pin-identifier",
        ),
      ).toHaveLength(2);

      const loginResponse = await login(
        new Request("https://cisskerala.app/api/guard/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phoneNumber: loginPhone, pin: "1234" }),
        }),
      );
      expect(loginResponse.status).toBe(200);
      await expect(loginResponse.json()).resolves.toEqual({
        token: "format-token",
        employeeName: "Format Guard",
      });
    },
  );

  it("requires supplied login identifiers to resolve to the same employee", async () => {
    const adminDb = new FakeFirestore();
    const createCustomToken = vi.fn();
    const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true });
    adminDb.seed("employees", "employee-a", {
      employeeId: "EMP-A",
      phoneNumber: "8333333333",
      guardPin: await hashPin("1234"),
      guardAuthUid: "guard-a",
    });
    adminDb.seed("employees", "employee-b", {
      employeeId: "EMP-B",
      phoneNumber: "8444444444",
      guardPin: await hashPin("1234"),
      guardAuthUid: "guard-b",
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
      auth: { createCustomToken },
      customTokenAuth: null,
    }));
    vi.doMock("@/lib/server/rate-limit", () => ({
      buildRateLimitKey: (endpoint: string, identifier: string) =>
        `${endpoint}:${identifier}`,
      checkRateLimit,
      getClientIp: vi.fn(() => "203.0.113.10"),
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
        delete: () => deleteSentinel,
      },
    }));

    const { POST } = await import("./api/guard/auth/login/route");
    const response = await POST(
      new Request("https://cisskerala.app/api/guard/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeId: "EMP-A",
          phoneNumber: "8444444444",
          pin: "1234",
        }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid sign-in details. Please try again.",
    });
    expect(createCustomToken).not.toHaveBeenCalled();
  });

  it("migrates a verified legacy SHA-256 PIN and locks at the failure threshold", async () => {
    const adminDb = new FakeFirestore();
    const createCustomToken = vi.fn().mockResolvedValue("migrated-token");
    const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true });
    const legacyHash = createHash("sha256").update("1234").digest("hex");
    adminDb.seed("employees", "legacy", {
      employeeId: "EMP-LEGACY",
      phoneNumber: "8555555555",
      guardPin: legacyHash,
      guardAuthUid: "legacy-uid",
    });
    adminDb.seed("employees", "concurrent", {
      employeeId: "EMP-CONCURRENT",
      phoneNumber: "8666666666",
      guardPin: await hashPin("1234"),
      guardAuthUid: "concurrent-uid",
      guardFailedAttempts: 8,
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
      auth: { createCustomToken },
      customTokenAuth: null,
    }));
    vi.doMock("@/lib/server/rate-limit", () => ({
      buildRateLimitKey: (endpoint: string, identifier: string) =>
        `${endpoint}:${identifier}`,
      checkRateLimit,
      getClientIp: vi.fn(() => "203.0.113.10"),
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
        delete: () => deleteSentinel,
      },
    }));

    const { POST } = await import("./api/guard/auth/login/route");
    const request = (phoneNumber: string, pin: string) =>
      new Request("https://cisskerala.app/api/guard/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber, pin }),
      });

    expect((await POST(request("8555555555", "1234"))).status).toBe(200);
    const migratedPin = adminDb.getDoc("employees", "legacy")?.guardPin;
    expect(migratedPin).toMatch(/^scrypt-v1\$/);
    expect(await verifyPin("1234", migratedPin as string)).toBe(true);

    expect((await POST(request("8666666666", "9999"))).status).toBe(401);
    expect((await POST(request("8666666666", "9999"))).status).toBe(401);
    expect(adminDb.getDoc("employees", "concurrent")).toEqual(
      expect.objectContaining({
        guardFailedAttempts: 10,
        guardLockoutUntil: expect.any(Date),
      }),
    );
    expect((await POST(request("8666666666", "1234"))).status).toBe(401);
    expect(createCustomToken).toHaveBeenCalledTimes(1);
  });

  it("preserves every concurrent failed attempt in the transactional lockout update", async () => {
    const adminDb = new FakeFirestore();
    const employeeRef = adminDb.collection("employees").doc("concurrent");
    adminDb.seed("employees", "concurrent", { guardFailedAttempts: 8 });

    await Promise.all(
      Array.from({ length: 2 }, () =>
        adminDb.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(employeeRef);
          transaction.update(
            employeeRef,
            buildFailedPinAttemptUpdate(
              snapshot.data()?.guardFailedAttempts,
              1_700_000_000_000,
            ),
          );
        }),
      ),
    );

    expect(adminDb.getDoc("employees", "concurrent")).toEqual(
      expect.objectContaining({
        guardFailedAttempts: 10,
        guardLockoutUntil: expect.any(Date),
      }),
    );
  });

  it("allows an administrator to reset a guard PIN and writes an audit event", async () => {
    const adminDb = new FakeFirestore();
    const guardPin = await hashPin("1234");

    adminDb.seed("employees", "emp-3", {
      employeeId: "EMP003",
      phoneNumber: "7777777777",
      fullName: "Guard Three",
      dateOfBirth: "1999-04-30",
      district: "Ernakulam",
      guardPin,
      guardAuthUid: "guard-uid-3",
    });

    const createUser = vi.fn().mockResolvedValue({ uid: "guard-uid-3-new" });
    const getUserByEmail = vi.fn().mockRejectedValue(new Error("not found"));
    const setCustomUserClaims = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
      auth: {
        createUser,
        getUserByEmail,
        setCustomUserClaims,
      },
    }));
    vi.doMock(
      "@/lib/guard/identity-utils",
      async () => await import("../lib/guard/identity-utils"),
    );
    vi.doMock(
      "@/lib/guard/pin-utils",
      async () => await import("../lib/guard/pin-utils"),
    );
    vi.doMock(
      "@/lib/qr/employee-qr",
      async () => await import("../lib/qr/employee-qr"),
    );
    vi.doMock("@/lib/server/auth", () => ({
      requireAdmin: vi.fn().mockResolvedValue({
        uid: "admin-uid-1",
        email: "admin@example.com",
        role: "admin",
      }),
      unauthorizedResponse: (message: string, status = 401) =>
        new Response(JSON.stringify({ error: message }), {
          status,
          headers: { "content-type": "application/json" },
        }),
    }));
    vi.doMock("@/lib/districts", () => ({
      districtMatches: (left: string, right: string) =>
        String(left).trim().toLowerCase() ===
        String(right).trim().toLowerCase(),
    }));
    vi.doMock("@/lib/runtime-config", () => ({
      GUARD_AUTH_EMAIL_DOMAIN: "guard.cisskerala.app",
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      Timestamp: {
        now: () => ({ toDate: () => new Date() }),
        fromDate: (date: Date) => ({ toDate: () => date }),
      },
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
        delete: () => deleteSentinel,
      },
    }));

    const { POST } = await import("./api/guard/auth/reset-pin/route");
    const response = await POST(
      new Request("https://cisskerala.app/api/guard/auth/reset-pin", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-token",
        },
        body: JSON.stringify({
          employeeDocId: "emp-3",
          newPin: "4321",
          reason: "Guard forgot PIN",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message:
        "PIN reset successfully. The action was recorded in the audit log.",
    });
    expect(setCustomUserClaims).toHaveBeenCalledWith("guard-uid-3", {
      role: "guard",
      employeeId: "EMP003",
      employeeDocId: "emp-3",
    });
    expect(adminDb.getDoc("employees", "emp-3")).toEqual(
      expect.objectContaining({
        guardFailedAttempts: 0,
        guardPinSetAt: "SERVER_TIMESTAMP",
      }),
    );
    expect(adminDb.listDocs("guardPinResetEvents")).toHaveLength(1);
  });

  it("blocks field officers from resetting guard PINs", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("employees", "emp-4", {
      employeeId: "EMP004",
      phoneNumber: "6666666666",
      fullName: "Guard Four",
      dateOfBirth: "1999-04-30",
      district: "Ernakulam",
      guardPin: await hashPin("1234"),
      guardAuthUid: "guard-uid-4",
    });
    adminDb.seed("fieldOfficers", "fo-1", {
      uid: "fo-uid-1",
      assignedDistricts: ["Kollam"],
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
      auth: {
        verifyIdToken: vi.fn().mockResolvedValue({
          uid: "fo-uid-1",
          role: "fieldOfficer",
        }),
      },
    }));
    vi.doMock(
      "@/lib/guard/identity-utils",
      async () => await import("../lib/guard/identity-utils"),
    );
    vi.doMock(
      "@/lib/guard/pin-utils",
      async () => await import("../lib/guard/pin-utils"),
    );
    vi.doMock(
      "@/lib/qr/employee-qr",
      async () => await import("../lib/qr/employee-qr"),
    );
    vi.doMock("@/lib/server/auth", () => ({
      requireAdmin: vi
        .fn()
        .mockRejectedValue(new Error("Admin access required.")),
      unauthorizedResponse: (message: string, status = 401) =>
        new Response(JSON.stringify({ error: message }), {
          status,
          headers: { "content-type": "application/json" },
        }),
    }));
    vi.doMock("@/lib/districts", () => ({
      districtMatches: (left: string, right: string) =>
        String(left).trim().toLowerCase() ===
        String(right).trim().toLowerCase(),
    }));
    vi.doMock("@/lib/runtime-config", () => ({
      GUARD_AUTH_EMAIL_DOMAIN: "guard.cisskerala.app",
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      Timestamp: {
        now: () => ({ toDate: () => new Date() }),
        fromDate: (date: Date) => ({ toDate: () => date }),
      },
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
        delete: () => deleteSentinel,
      },
    }));

    const { POST } = await import("./api/guard/auth/reset-pin/route");
    const response = await POST(
      new Request("https://cisskerala.app/api/guard/auth/reset-pin", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer fo-token",
        },
        body: JSON.stringify({
          employeeDocId: "emp-4",
          newPin: "4321",
          reason: "Forgot PIN",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Admin access required.",
    });
  });
});
