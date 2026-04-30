import { afterEach, describe, expect, it, vi } from "vitest";

type Filter = { field: string; op: "=="; value: unknown };

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
}

class FakeQuerySnapshot {
  constructor(
    readonly docs: Array<{ id: string; data: () => Record<string, unknown> }>,
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

  where(field: string, op: "==", value: unknown) {
    return new FakeQuery(this.store, this.collectionName, [...this.filters, { field, op, value }], this.limitCount);
  }

  limit(value: number) {
    return new FakeQuery(this.store, this.collectionName, this.filters, value);
  }

  async get() {
    const docs = this.store
      .listDocs(this.collectionName)
      .filter(({ data }) => this.filters.every((filter) => data[filter.field] === filter.value));
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

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();

  collection(name: string) {
    return new FakeCollectionRef(this, name);
  }

  seed(collectionName: string, id: string, value: Record<string, unknown>) {
    if (!this.collections.has(collectionName)) {
      this.collections.set(collectionName, new Map());
    }
    this.collections.get(collectionName)!.set(id, structuredClone(value));
  }

  listDocs(collectionName: string) {
    return Array.from(this.collections.get(collectionName)?.entries() ?? []).map(([id, data]) => ({
      id,
      data,
    }));
  }

  getDoc(collectionName: string, id: string) {
    return this.collections.get(collectionName)?.get(id);
  }
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/firebaseAdmin");
  vi.doUnmock("@/lib/server/auth");
});

describe("GET /api/mobile/session", () => {
  it("resolves a field officer from Firestore and repairs missing claims", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("fieldOfficers", "fo-1", {
      uid: "fo-uid-1",
      name: "Officer One",
      stateCode: "KL",
      assignedDistricts: ["Ernakulam", "Thrissur"],
    });

    const getUser = vi.fn().mockResolvedValue({
      customClaims: {},
    });
    const setCustomUserClaims = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/server/auth", () => ({
      verifyRequestAuth: vi.fn().mockResolvedValue({
        uid: "fo-uid-1",
        email: "officer@example.com",
      }),
      unauthorizedResponse: (message: string, status = 401) =>
        Response.json({ error: message }, { status }),
    }));
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
      auth: {
        getUser,
        setCustomUserClaims,
      },
    }));

    const { GET } = await import("./route");
    const response = await GET(new Request("https://cisskerala.site/api/mobile/session"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      role: "fieldOfficer",
      displayName: "Officer One",
      primaryId: "fo-uid-1",
      uid: "fo-uid-1",
      assignedDistricts: ["Ernakulam", "Thrissur"],
      stateCode: "KL",
      claimsRepaired: true,
    });
    expect(setCustomUserClaims).toHaveBeenCalledWith("fo-uid-1", {
      role: "fieldOfficer",
      stateCode: "KL",
      assignedDistricts: ["Ernakulam", "Thrissur"],
    });
  });

  it("resolves a guard from employee linkage when claims are missing", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("employees", "emp-99", {
      guardAuthUid: "guard-uid-99",
      employeeId: "EMP099",
      name: "Guard One",
      clientName: "Client A",
    });

    const getUser = vi.fn().mockResolvedValue({
      customClaims: {},
    });
    const setCustomUserClaims = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/server/auth", () => ({
      verifyRequestAuth: vi.fn().mockResolvedValue({
        uid: "guard-uid-99",
        email: "guard@example.com",
      }),
      unauthorizedResponse: (message: string, status = 401) =>
        Response.json({ error: message }, { status }),
    }));
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
      auth: {
        getUser,
        setCustomUserClaims,
      },
    }));

    const { GET } = await import("./route");
    const response = await GET(new Request("https://cisskerala.site/api/mobile/session"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      role: "guard",
      displayName: "Guard One",
      primaryId: "EMP099",
      uid: "guard-uid-99",
      employeeDocId: "emp-99",
      clientName: "Client A",
      claimsRepaired: true,
    });
    expect(setCustomUserClaims).toHaveBeenCalledWith("guard-uid-99", {
      role: "guard",
      employeeId: "EMP099",
      employeeDocId: "emp-99",
    });
  });
});
