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

  async create(data: Record<string, unknown>) {
    if (this.store.getDoc(this.collectionName, this.id)) {
      throw new Error("already exists");
    }
    this.store.seed(this.collectionName, this.id, data);
  }

  async update(data: Record<string, unknown>) {
    const current = this.store.getDoc(this.collectionName, this.id);
    if (!current) throw new Error("not found");
    this.store.seed(this.collectionName, this.id, { ...current, ...data });
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
  doc(id?: string) {
    return new FakeDocRef(
      this.store,
      this.collectionName,
      id ?? `${this.collectionName}-${this.store.listDocs(this.collectionName).length + 1}`,
    );
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

  async runTransaction(
    callback: (transaction: {
      get(ref: FakeDocRef): ReturnType<FakeDocRef["get"]>;
      create(ref: FakeDocRef, data: Record<string, unknown>): void;
      update(ref: FakeDocRef, data: Record<string, unknown>): void;
    }) => Promise<void>,
  ) {
    const pending: Array<{
      operation: "create" | "update";
      ref: FakeDocRef;
      data: Record<string, unknown>;
    }> = [];
    await callback({
      get: (ref) => ref.get(),
      create: (ref, data) => {
        pending.push({ operation: "create", ref, data });
      },
      update: (ref, data) => {
        pending.push({ operation: "update", ref, data });
      },
    });
    for (const write of pending) {
      if (write.operation === "create") {
        await write.ref.create(write.data);
      } else {
        await write.ref.update(write.data);
      }
    }
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
          status: "submitted",
          photoUrls: ["https://example.com/training-1.jpg", "https://example.com/training-2.jpg", "https://example.com/training-3.jpg"],
          attachmentUrls: ["https://example.com/training-report.pdf"],
          clientReportUrl: "https://example.com/client-signed-training-report.pdf",
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

  it("keeps submitted visit reports immutable", async () => {
    const db = new FakeFirestore();
    db.seed("foVisitReports", "visit-1", {
      fieldOfficerId: "fo-1",
      clientId: "client-1",
      siteId: "site-1",
      stateCode: "KL",
      district: "Ernakulam",
      visitDate: new Date("2026-05-25"),
      summary: "Original submitted account.",
      photoUrls: ["https://example.com/visit.jpg"],
      status: "submitted",
      visibility: "client_visible",
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({ uid: "fo-1", role: "fieldOfficer" });

    const { PATCH } = await import("../admin/visit-reports/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/api/admin/visit-reports/visit-1", {
        method: "PATCH",
        body: JSON.stringify({ summary: "Changed after submission." }),
      }),
      { params: Promise.resolve({ id: "visit-1" }) },
    );

    expect(response.status).toBe(409);
    expect(db.getDoc("foVisitReports", "visit-1")?.summary).toBe(
      "Original submitted account.",
    );
  });

  it("revalidates required evidence when a visit draft is submitted", async () => {
    const db = new FakeFirestore();
    db.seed("foVisitReports", "visit-draft", {
      fieldOfficerId: "fo-1",
      clientId: "client-1",
      siteId: "site-1",
      stateCode: "KL",
      district: "Ernakulam",
      visitDate: new Date("2026-05-25"),
      summary: "Draft without evidence.",
      guardsPresentCount: 2,
      guardsAbsentCount: 0,
      photoUrls: [],
      attachmentUrls: [],
      status: "draft",
      visibility: "private_draft",
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({ uid: "fo-1", role: "fieldOfficer" });

    const { PATCH } = await import("../admin/visit-reports/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/api/admin/visit-reports/visit-draft", {
        method: "PATCH",
        body: JSON.stringify({
          status: "submitted",
          submissionIdempotencyKey: "submit-visit-draft-1",
        }),
      }),
      { params: Promise.resolve({ id: "visit-draft" }) },
    );

    expect(response.status).toBe(400);
    expect(db.getDoc("foVisitReports", "visit-draft")?.status).toBe("draft");
  });

  it("creates a private immutable revision draft from a submitted report", async () => {
    const db = new FakeFirestore();
    db.seed("foVisitReports", "visit-current", {
      fieldOfficerId: "fo-1",
      clientId: "client-1",
      siteId: "site-1",
      stateCode: "KL",
      district: "Ernakulam",
      visitDate: new Date("2026-05-25"),
      summary: "Submitted visit.",
      photoUrls: ["https://example.com/visit.jpg"],
      status: "submitted",
      visibility: "client_visible",
      reviewStatus: "revision_requested",
      revisionNumber: 1,
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({ uid: "fo-1", role: "fieldOfficer" });

    const { POST } = await import("../admin/visit-reports/[id]/revisions/route");
    const response = await POST(
      new Request("http://localhost/api/admin/visit-reports/visit-current/revisions", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "visit-current" }) },
    );

    expect(response.status).toBe(201);
    const revisions = db
      .listDocs("foVisitReports")
      .filter((row) => row.id !== "visit-current");
    expect(revisions).toHaveLength(1);
    expect(revisions[0].data).toEqual(
      expect.objectContaining({
        status: "draft",
        visibility: "private_draft",
        previousRevisionId: "visit-current",
        revisionNumber: 2,
      }),
    );
  });
});
