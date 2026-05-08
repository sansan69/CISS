import { afterEach, describe, expect, it, vi } from "vitest";

const serverTimestampSentinel = { __op: "serverTimestamp" } as const;

type Filter = { field: string; op: "=="; value: unknown };
type OrderBy = { field: string; direction: "asc" | "desc" };

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
}

class FakeQuerySnapshot {
  constructor(
    readonly docs: Array<{ id: string; data: () => Record<string, unknown> }>,
  ) {}
}

class FakeQuery {
  constructor(
    protected readonly store: FakeFirestore,
    protected readonly collectionName: string,
    protected readonly filters: Filter[] = [],
    protected readonly order?: OrderBy,
    protected readonly limitCount?: number,
  ) {}

  where(field: string, op: "==", value: unknown) {
    return new FakeQuery(
      this.store,
      this.collectionName,
      [...this.filters, { field, op, value }],
      this.order,
      this.limitCount,
    );
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc") {
    return new FakeQuery(
      this.store,
      this.collectionName,
      this.filters,
      { field, direction },
      this.limitCount,
    );
  }

  limit(value: number) {
    return new FakeQuery(
      this.store,
      this.collectionName,
      this.filters,
      this.order,
      value,
    );
  }

  async get() {
    let docs = this.store
      .listDocs(this.collectionName)
      .filter(({ data }) => this.filters.every((filter) => data[filter.field] === filter.value));

    if (this.order) {
      docs = [...docs].sort((left, right) => {
        const leftValue = this.store.sortableValue(left.data[this.order!.field]);
        const rightValue = this.store.sortableValue(right.data[this.order!.field]);
        return this.order!.direction === "desc" ? rightValue - leftValue : leftValue - rightValue;
      });
    }

    const limited = typeof this.limitCount === "number" ? docs.slice(0, this.limitCount) : docs;
    return new FakeQuerySnapshot(
      limited.map(({ id, data }) => ({
        id,
        data: () => data,
      })),
    );
  }
}

class FakeCollectionRef extends FakeQuery {
  doc(id: string) {
    return new FakeDocRef(this.store, this.collectionName, id);
  }
}

class FakeBatch {
  private readonly operations: Array<() => void> = [];

  constructor(private readonly store: FakeFirestore) {}

  update(ref: FakeDocRef, value: Record<string, unknown>) {
    this.operations.push(() => {
      this.store.updateDoc(ref.collectionName, ref.id, value);
    });
  }

  set(ref: FakeDocRef, value: Record<string, unknown>, options?: { merge?: boolean }) {
    this.operations.push(() => {
      this.store.setDoc(ref.collectionName, ref.id, value, options);
    });
  }

  async commit() {
    this.operations.forEach((operation) => operation());
  }
}

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();

  collection(name: string) {
    return new FakeCollectionRef(this, name);
  }

  batch() {
    return new FakeBatch(this);
  }

  seed(collectionName: string, id: string, value: Record<string, unknown>) {
    this.setDoc(collectionName, id, value);
  }

  setDoc(
    collectionName: string,
    id: string,
    value: Record<string, unknown>,
    options?: { merge?: boolean },
  ) {
    if (!this.collections.has(collectionName)) {
      this.collections.set(collectionName, new Map());
    }

    const existing = options?.merge ? this.collections.get(collectionName)?.get(id) ?? {} : {};
    this.collections.get(collectionName)!.set(id, {
      ...existing,
      ...this.normalizeData(value),
    });
  }

  updateDoc(collectionName: string, id: string, value: Record<string, unknown>) {
    const existing = this.getDoc(collectionName, id) ?? {};
    this.setDoc(collectionName, id, { ...existing, ...value });
  }

  getDoc(collectionName: string, id: string) {
    return this.collections.get(collectionName)?.get(id);
  }

  listDocs(collectionName: string) {
    return Array.from(this.collections.get(collectionName)?.entries() ?? []).map(([id, data]) => ({
      id,
      data,
    }));
  }

  sortableValue(value: unknown) {
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  private normalizeData(value: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        item === serverTimestampSentinel ? new Date("2026-05-08T00:00:00.000Z") : item,
      ]),
    );
  }
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/firebaseAdmin");
  vi.doUnmock("@/lib/server/auth");
  vi.doUnmock("@/lib/server/mobile-session");
  vi.doUnmock("firebase-admin/firestore");
});

describe("mobile notifications route", () => {
  it("returns direct and alias-matched legacy notifications with isolated read state", async () => {
    const firestore = new FakeFirestore();
    firestore.seed("notifications", "direct-1", {
      type: "broadcast",
      title: "Direct",
      body: "For this guard",
      recipientUid: "guard-1",
      recipientRole: "guard",
      read: false,
      createdAt: new Date("2026-05-07T10:00:00.000Z"),
    });
    firestore.seed("notifications", "legacy-1", {
      type: "broadcast",
      title: "Legacy district",
      body: "For Ernakulam guards",
      recipientRole: "guard",
      recipientDistrict: "Ernakulam",
      read: false,
      createdAt: new Date("2026-05-08T10:00:00.000Z"),
    });
    firestore.seed("notifications", "legacy-2", {
      type: "broadcast",
      title: "Other district",
      body: "Ignore me",
      recipientRole: "guard",
      recipientDistrict: "Thrissur",
      read: false,
      createdAt: new Date("2026-05-09T10:00:00.000Z"),
    });
    firestore.seed("notificationReadStates", "guard-1__legacy-1", {
      uid: "guard-1",
      notificationId: "legacy-1",
      read: true,
      readAt: new Date("2026-05-08T11:00:00.000Z"),
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: firestore,
    }));
    vi.doMock("@/lib/server/auth", () => ({
      verifyRequestAuth: vi.fn().mockResolvedValue({ uid: "guard-1" }),
      unauthorizedResponse: (message: string, status = 401) =>
        Response.json({ error: message }, { status }),
    }));
    vi.doMock("@/lib/server/mobile-session", () => ({
      resolveMobileSession: vi.fn().mockResolvedValue({
        uid: "guard-1",
        role: "guard",
        district: "Cochin",
        assignedDistricts: [],
      }),
    }));

    const { GET } = await import("./route");
    const response = await GET(new Request("https://cisskerala.site/api/mobile/notifications"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.unreadCount).toBe(1);
    expect(json.notifications).toHaveLength(2);
    expect(json.notifications[0]).toMatchObject({
      id: "legacy-1",
      read: true,
    });
    expect(json.notifications[1]).toMatchObject({
      id: "direct-1",
      read: false,
    });
  });

  it("marks legacy broadcasts through per-user read state instead of mutating the shared notification", async () => {
    const firestore = new FakeFirestore();
    firestore.seed("notifications", "legacy-1", {
      type: "broadcast",
      title: "Legacy district",
      body: "For Ernakulam guards",
      recipientRole: "guard",
      recipientDistrict: "Ernakulam",
      read: false,
      createdAt: new Date("2026-05-08T10:00:00.000Z"),
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: firestore,
    }));
    vi.doMock("@/lib/server/auth", () => ({
      verifyRequestAuth: vi.fn().mockResolvedValue({ uid: "guard-1" }),
      unauthorizedResponse: (message: string, status = 401) =>
        Response.json({ error: message }, { status }),
    }));
    vi.doMock("@/lib/server/mobile-session", () => ({
      resolveMobileSession: vi.fn().mockResolvedValue({
        uid: "guard-1",
        role: "guard",
        district: "Ernakulam",
        assignedDistricts: [],
      }),
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
      },
    }));

    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://cisskerala.site/api/mobile/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "markRead", notifId: "legacy-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(firestore.getDoc("notifications", "legacy-1")).toMatchObject({
      read: false,
    });
    expect(firestore.getDoc("notificationReadStates", "guard-1__legacy-1")).toMatchObject({
      uid: "guard-1",
      notificationId: "legacy-1",
      read: true,
    });
  });

  it("rejects guard-created system notifications", async () => {
    const firestore = new FakeFirestore();

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: firestore,
    }));
    vi.doMock("@/lib/server/auth", () => ({
      verifyRequestAuth: vi.fn().mockResolvedValue({ uid: "guard-1" }),
      unauthorizedResponse: (message: string, status = 401) =>
        Response.json({ error: message }, { status }),
    }));
    vi.doMock("@/lib/server/mobile-session", () => ({
      resolveMobileSession: vi.fn().mockResolvedValue({
        uid: "guard-1",
        role: "guard",
        district: "Ernakulam",
        assignedDistricts: [],
      }),
    }));

    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://cisskerala.site/api/mobile/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "createSystem", title: "Alert", body: "Hello" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Guard-created system notifications are disabled.",
    });
  });
});
