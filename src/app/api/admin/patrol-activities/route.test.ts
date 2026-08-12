import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredDoc = { id: string; data: Record<string, unknown> };

class FakeQuery {
  constructor(
    private readonly store: FakeFirestore,
    private readonly collectionName: string,
    private readonly filters: Array<{ field: string; value: unknown }> = [],
    private readonly limitCount?: number,
  ) {}

  where(field: string, _operator: "==", value: unknown) {
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

  async get() {
    const docs = this.store
      .listDocs(this.collectionName)
      .filter(({ data }) =>
        this.filters.every(({ field, value }) => data[field] === value),
      )
      .map(({ id, data }) => ({ id, data: () => data }));
    return {
      docs:
        typeof this.limitCount === "number"
          ? docs.slice(0, this.limitCount)
          : docs,
      empty: docs.length === 0,
    };
  }
}

class FakeFirestore {
  private readonly collections = new Map<
    string,
    Map<string, Record<string, unknown>>
  >();

  seed(collectionName: string, id: string, data: Record<string, unknown>) {
    if (!this.collections.has(collectionName)) {
      this.collections.set(collectionName, new Map());
    }
    this.collections.get(collectionName)!.set(id, data);
  }

  collection(name: string) {
    return new FakeQuery(this, name);
  }

  listDocs(collectionName: string): StoredDoc[] {
    return Array.from(this.collections.get(collectionName)?.entries() ?? [])
      .map(([id, data]) => ({ id, data }));
  }
}

const verifyRequestAuthMock = vi.hoisted(() => vi.fn());
const firestoreMock = vi.hoisted(() => ({ current: null as FakeFirestore | null }));

vi.mock("@/lib/server/auth", () => ({
  hasAdminAccess: (decoded: { role?: string }) => decoded.role === "admin",
  hasFieldOfficerAccess: (decoded: { role?: string }) =>
    decoded.role === "fieldOfficer",
  unauthorizedResponse: (message: string, status = 401) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    }),
  verifyRequestAuth: verifyRequestAuthMock,
}));

vi.mock("@/lib/firebaseAdmin", () => ({
  get db() {
    if (!firestoreMock.current) throw new Error("Firestore mock not configured");
    return firestoreMock.current;
  },
}));

describe("admin patrol activities route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("allows field officers to read only activities in assigned districts", async () => {
    const db = new FakeFirestore();
    db.seed("fieldOfficers", "fo-1", {
      uid: "fo-1",
      assignedDistricts: ["Ernakulam"],
    });
    db.seed("guardPatrolActivities", "activity-1", {
      type: "patrol",
      district: "Ernakulam",
      siteName: "Assigned Site",
      guardName: "Assigned Guard",
      activityAt: "2026-08-09T10:00:00.000Z",
    });
    db.seed("guardPatrolActivities", "activity-2", {
      type: "patrol",
      district: "Kollam",
      siteName: "Other Site",
      guardName: "Other Guard",
      activityAt: "2026-08-09T11:00:00.000Z",
    });
    firestoreMock.current = db;
    verifyRequestAuthMock.mockResolvedValue({
      uid: "fo-1",
      role: "fieldOfficer",
      assignedDistricts: [],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://example.test/api/admin/patrol-activities"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.activities).toHaveLength(1);
    expect(body.activities[0]).toMatchObject({
      id: "activity-1",
      district: "Ernakulam",
    });
  });
});
