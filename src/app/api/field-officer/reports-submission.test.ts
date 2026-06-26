import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredDoc = { id: string; data: Record<string, unknown> };

class FakeSnapshot {
  constructor(public readonly docs: Array<{ id: string; data: () => Record<string, unknown> }>) {}

  get empty() {
    return this.docs.length === 0;
  }
}

class FakeDocRef {
  constructor(
    private readonly store: FakeFirestore,
    private readonly collectionName: string,
    private readonly id: string,
  ) {}

  async get() {
    const data = this.store.getDoc(this.collectionName, this.id);
    return {
      id: this.id,
      exists: Boolean(data),
      data: () => data ?? {},
    };
  }
}

class FakeQuery {
  constructor(
    protected readonly store: FakeFirestore,
    protected readonly collectionName: string,
    private readonly filters: Array<{ field: string; value: unknown }> = [],
    private readonly limitCount?: number,
  ) {}

  where(field: string, _op: "==", value: unknown) {
    return new FakeQuery(
      this.store,
      this.collectionName,
      [...this.filters, { field, value }],
      this.limitCount,
    );
  }

  limit(value: number) {
    return new FakeQuery(this.store, this.collectionName, this.filters, value);
  }

  orderBy() {
    return this;
  }

  async get() {
    const docs = this.store
      .listDocs(this.collectionName)
      .filter(({ data }) => this.filters.every((filter) => data[filter.field] === filter.value))
      .map(({ id, data }) => ({ id, data: () => data }));
    return new FakeSnapshot(typeof this.limitCount === "number" ? docs.slice(0, this.limitCount) : docs);
  }
}

class FakeCollectionRef extends FakeQuery {
  doc(id: string) {
    return new FakeDocRef(this.store, this.collectionName, id);
  }

  async add(data: Record<string, unknown>) {
    const id = `${this.collectionName}-${this.store.listDocs(this.collectionName).length + 1}`;
    this.store.seed(this.collectionName, id, data);
    return { id };
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
    return new FakeCollectionRef(this, name);
  }

  getDoc(collectionName: string, id: string) {
    return this.collections.get(collectionName)?.get(id);
  }

  listDocs(collectionName: string): StoredDoc[] {
    return Array.from(this.collections.get(collectionName)?.entries() ?? []).map(([id, data]) => ({
      id,
      data,
    }));
  }
}

const verifyRequestAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/auth")>("@/lib/server/auth");
  return {
    ...actual,
    verifyRequestAuth: verifyRequestAuthMock,
  };
});

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => new Date("2026-05-25T08:00:00.000Z"),
  },
}));

describe("field officer report submission", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("allows a visit report for a selected site when the field officer has no district restriction", async () => {
    const db = new FakeFirestore();
    db.seed("fieldOfficers", "fo-profile", {
      uid: "fo-1",
      name: "Field Officer",
      stateCode: "KL",
      assignedDistricts: [],
    });
    db.seed("sites", "site-1", {
      clientId: "client-1",
      clientName: "Client One",
      siteName: "Kochi Site",
      district: "Ernakulam",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({
      uid: "fo-1",
      email: "fo@example.com",
      role: "fieldOfficer",
      assignedDistricts: [],
    });

    const { POST } = await import("./visit-reports/route");
    const response = await POST(
      new Request("http://localhost/api/field-officer/visit-reports", {
        method: "POST",
        body: JSON.stringify({
          clientId: "client-1",
          siteId: "site-1",
          visitDate: "2026-05-25",
          summary: "Routine visit completed.",
          status: "submitted",
          photoUrls: ["https://example.com/report.jpg"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(db.listDocs("foVisitReports")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          fieldOfficerId: "fo-1",
          clientId: "client-1",
          siteId: "site-1",
          district: "Ernakulam",
          status: "submitted",
        }),
      }),
    ]);
  });

  it("still blocks visit reports for outside districts when the field officer is district restricted", async () => {
    const db = new FakeFirestore();
    db.seed("fieldOfficers", "fo-profile", {
      uid: "fo-1",
      name: "Field Officer",
      stateCode: "KL",
      assignedDistricts: ["Kollam"],
    });
    db.seed("sites", "site-1", {
      clientId: "client-1",
      clientName: "Client One",
      siteName: "Kochi Site",
      district: "Ernakulam",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({
      uid: "fo-1",
      email: "fo@example.com",
      role: "fieldOfficer",
      assignedDistricts: ["Kollam"],
    });

    const { POST } = await import("./visit-reports/route");
    const response = await POST(
      new Request("http://localhost/api/field-officer/visit-reports", {
        method: "POST",
        body: JSON.stringify({
          clientId: "client-1",
          siteId: "site-1",
          visitDate: "2026-05-25",
          summary: "Routine visit completed.",
          status: "submitted",
          photoUrls: ["https://example.com/report.jpg"],
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "This site is outside your assigned districts.",
    });
    expect(db.listDocs("foVisitReports")).toEqual([]);
  });

  it("allows a training report for a selected site when the field officer has no district restriction", async () => {
    const db = new FakeFirestore();
    db.seed("fieldOfficers", "fo-profile", {
      uid: "fo-1",
      name: "Field Officer",
      stateCode: "KL",
      assignedDistricts: [],
    });
    db.seed("sites", "site-1", {
      clientId: "client-1",
      clientName: "Client One",
      siteName: "Kochi Site",
      district: "Ernakulam",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({
      uid: "fo-1",
      email: "fo@example.com",
      role: "fieldOfficer",
      assignedDistricts: [],
    });

    const { POST } = await import("./training-reports/route");
    const response = await POST(
      new Request("http://localhost/api/field-officer/training-reports", {
        method: "POST",
        body: JSON.stringify({
          clientId: "client-1",
          siteId: "site-1",
          trainingDate: "2026-05-25",
          topic: "Safety briefing",
          durationMinutes: 60,
          attendeeCount: 12,
          photoUrls: ["https://example.com/training-1.jpg", "https://example.com/training-2.jpg", "https://example.com/training-3.jpg"],
          attachmentUrls: ["https://example.com/training-report.pdf"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(db.listDocs("foTrainingReports")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          fieldOfficerId: "fo-1",
          clientId: "client-1",
          siteId: "site-1",
          district: "Ernakulam",
          status: "submitted",
          attachmentUrls: ["https://example.com/training-report.pdf"],
        }),
      }),
    ]);
  });
});
