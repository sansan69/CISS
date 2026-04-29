import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPin } from "../lib/guard/pin-utils";

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
    return new FakeDocSnapshot(this.id, this.store.getDoc(this.collectionName, this.id));
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
    readonly docs: Array<{ id: string; data: () => Record<string, unknown>; ref: FakeDocRef }>,
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
    return new FakeQuery(this.store, this.collectionName, [...this.filters, { field, op, value }], this.limitCount);
  }

  limit(value: number) {
    return new FakeQuery(this.store, this.collectionName, this.filters, value);
  }

  async get() {
    const docs = this.store
      .listDocs(this.collectionName)
      .filter(({ data }) => this.filters.every((filter) => matchFilter(data, filter)));
    const limited = typeof this.limitCount === "number" ? docs.slice(0, this.limitCount) : docs;

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
    return new FakeDocRef(this.store, this.collectionName, id ?? `${this.collectionName}-auto`);
  }
}

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();

  collection(name: string) {
    return new FakeCollectionRef(this, name);
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
    return Array.from(this.ensureCollection(collectionName).entries()).map(([id, data]) => ({ id, data }));
  }

  getDoc(collectionName: string, id: string) {
    return this.ensureCollection(collectionName).get(id);
  }

  setDoc(collectionName: string, id: string, value: Record<string, unknown>, options?: { merge?: boolean }) {
    const current = this.getDoc(collectionName, id);
    const next = options?.merge && current ? { ...current, ...value } : value;
    this.ensureCollection(collectionName).set(id, this.applyTransforms(current ?? {}, next));
  }

  updateDoc(collectionName: string, id: string, value: Record<string, unknown>) {
    const current = this.getDoc(collectionName, id);
    if (!current) {
      throw new Error(`Document ${collectionName}/${id} does not exist.`);
    }

    this.ensureCollection(collectionName).set(id, this.applyTransforms(current, value));
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
});

describe("guard auth routes", () => {
  it("lets a correct login succeed even if an old login rate-limit document exists", async () => {
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
    vi.doMock("@/lib/guard/identity-utils", async () => await import("../lib/guard/identity-utils"));
    vi.doMock("@/lib/guard/pin-utils", async () => await import("../lib/guard/pin-utils"));
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
        body: JSON.stringify({ phoneNumber: "9999999999", pin: "1234" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: "guard-token",
      employeeName: "Guard One",
    });
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
    vi.doMock("@/lib/guard/identity-utils", async () => await import("../lib/guard/identity-utils"));
    vi.doMock("@/lib/guard/pin-utils", async () => await import("../lib/guard/pin-utils"));
    vi.doMock("@/lib/runtime-config", () => ({
      GUARD_AUTH_EMAIL_DOMAIN: "guard.cisskerala.app",
    }));
    vi.doMock("firebase-admin/firestore", () => ({
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
});
