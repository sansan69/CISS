import { describe, expect, it, vi, beforeEach } from "vitest";

type Doc = { id: string; data: () => Record<string, unknown> };

class FakeSnapshot {
  constructor(public readonly docs: Doc[]) {}
  get empty() {
    return this.docs.length === 0;
  }
}

class FakeQuery {
  constructor(
    private readonly store: FakeFirestore,
    private readonly collectionName: string,
    private readonly filters: Array<{ field: string; value: unknown }> = [],
    private readonly limitCount?: number,
  ) {}

  where(field: string, _op: "==", value: unknown) {
    return new FakeQuery(this.store, this.collectionName, [...this.filters, { field, value }], this.limitCount);
  }

  limit(value: number) {
    return new FakeQuery(this.store, this.collectionName, this.filters, value);
  }

  async get() {
    const docs = this.store
      .listDocs(this.collectionName)
      .filter(({ data }) => this.filters.every((filter) => data[filter.field] === filter.value))
      .map(({ id, data }) => ({ id, data: () => data }));
    return new FakeSnapshot(typeof this.limitCount === "number" ? docs.slice(0, this.limitCount) : docs);
  }
}

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();

  seed(collectionName: string, id: string, data: Record<string, unknown>) {
    if (!this.collections.has(collectionName)) {
      this.collections.set(collectionName, new Map());
    }
    this.collections.get(collectionName)!.set(id, structuredClone(data));
  }

  collection(name: string) {
    return new FakeQuery(this, name);
  }

  listDocs(collectionName: string) {
    return Array.from(this.collections.get(collectionName)?.entries() ?? []).map(([id, data]) => ({ id, data }));
  }
}

const verifyRequestAuthMock = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  hasAdminAccess: (decoded: { role?: string; admin?: boolean }) => decoded.admin === true || decoded.role === "admin" || decoded.role === "superAdmin",
  hasFieldOfficerAccess: (decoded: { role?: string }) => decoded.role === "fieldOfficer",
  unauthorizedResponse: (message: string, status = 401) => new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  }),
  verifyRequestAuth: verifyRequestAuthMock,
}));

describe("field officer guards route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns guards for the requested Marian district even when the site spelling varies", async () => {
    const db = new FakeFirestore();
    db.seed("fieldOfficers", "fo-1", {
      uid: "fo-1",
      assignedDistricts: ["Thiruvananthapuram"],
    });
    db.seed("employees", "guard-tvm", {
      fullName: "Marian Guard One",
      employeeId: "G-101",
      clientName: "CISS",
      district: "Trivandrum",
      gender: "Male",
      phoneNumber: "9999999999",
      status: "Active",
      profilePictureUrl: "https://example.com/g1.jpg",
    });
    db.seed("employees", "guard-kollam", {
      fullName: "Other Guard",
      employeeId: "G-202",
      clientName: "CISS",
      district: "Kollam",
      gender: "Female",
      phoneNumber: "8888888888",
      status: "Active",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({
      uid: "fo-1",
      role: "fieldOfficer",
      assignedDistricts: ["Thiruvananthapuram"],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/field-officer/guards?district=Thiruvananthapuram"),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.guards).toEqual([
      expect.objectContaining({
        fullName: "Marian Guard One",
        district: "Trivandrum",
        status: "Active",
      }),
    ]);
  });

  it("keeps guard lists separate for Marian Engineering College sites in different districts", async () => {
    const db = new FakeFirestore();
    db.seed("employees", "guard-tvm", {
      fullName: "Marian TVM Guard",
      employeeId: "G-TVM",
      clientName: "CISS",
      district: "Trivandrum",
      gender: "Male",
      phoneNumber: "9999999999",
      status: "active",
    });
    db.seed("employees", "guard-ernakulam", {
      fullName: "Marian Ernakulam Guard",
      employeeId: "G-EKM",
      clientName: "CISS",
      district: "Ernakulam",
      gender: "Female",
      phoneNumber: "8888888888",
      status: "Active",
    });
    db.seed("employees", "guard-kollam", {
      fullName: "Kollam Guard",
      employeeId: "G-KLM",
      clientName: "CISS",
      district: "Kollam",
      gender: "Male",
      phoneNumber: "7777777777",
      status: "Active",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({
      uid: "admin-1",
      role: "admin",
    });

    const { GET } = await import("./route");
    const trivandrumResponse = await GET(
      new Request("http://localhost/api/field-officer/guards?district=Thiruvananthapuram"),
    );
    const ernakulamResponse = await GET(
      new Request("http://localhost/api/field-officer/guards?district=Ernakulam"),
    );

    expect(trivandrumResponse.status).toBe(200);
    expect(ernakulamResponse.status).toBe(200);

    const trivandrumPayload = await trivandrumResponse.json();
    const ernakulamPayload = await ernakulamResponse.json();

    expect(trivandrumPayload.guards.map((guard: { employeeId: string }) => guard.employeeId)).toEqual([
      "G-TVM",
    ]);
    expect(ernakulamPayload.guards.map((guard: { employeeId: string }) => guard.employeeId)).toEqual([
      "G-EKM",
    ]);
  });
});
