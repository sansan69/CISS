import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredDoc = { id: string; data: Record<string, unknown> };
type Filter = { field: string; op: string; value: unknown };

class FakeSnapshot {
  constructor(
    public readonly docs: Array<{
      id: string;
      data: () => Record<string, unknown>;
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
    private readonly filters: Filter[] = [],
    private readonly limitCount?: number,
  ) {}

  where(field: string, op: string, value: unknown) {
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

  orderBy(_field: string, direction: "asc" | "desc" = "asc") {
    if (this.collectionName === "attendanceLogs" && direction === "asc") {
      throw new Error(
        "FAILED_PRECONDITION: missing ascending attendance index",
      );
    }
    return this;
  }

  async get() {
    const docs = this.store
      .listDocs(this.collectionName)
      .filter(({ data }) =>
        this.filters.every(({ field, op, value }) => {
          const actual = data[field];
          if (op === "in") {
            return Array.isArray(value) && value.includes(actual);
          }
          if (op === ">=" || op === "<=") {
            const actualMillis =
              actual instanceof Date ? actual.getTime() : Number.NaN;
            const boundaryMillis =
              value instanceof Date ? value.getTime() : Number.NaN;
            return op === ">="
              ? actualMillis >= boundaryMillis
              : actualMillis <= boundaryMillis;
          }
          return actual === value;
        }),
      )
      .map(({ id, data }) => ({ id, data: () => data }));

    return new FakeSnapshot(
      typeof this.limitCount === "number"
        ? docs.slice(0, this.limitCount)
        : docs,
    );
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
    this.collections.get(collectionName)!.set(id, structuredClone(data));
  }

  collection(name: string) {
    return new FakeQuery(this, name);
  }

  listDocs(collectionName: string): StoredDoc[] {
    return Array.from(
      this.collections.get(collectionName)?.entries() ?? [],
    ).map(([id, data]) => ({ id, data }));
  }
}

const verifyRequestAuthMock = vi.hoisted(() => vi.fn());

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

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    fromDate: (value: Date) => value,
  },
}));

describe("field officer guard attendance route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("does not depend on the missing ascending attendance composite index", async () => {
    const db = new FakeFirestore();
    db.seed("fieldOfficers", "fo-1", {
      uid: "fo-1",
      assignedDistricts: ["Kollam"],
    });
    db.seed("attendanceLogs", "out-log", {
      employeeDocId: "guard-1",
      employeeId: "G-101",
      employeeName: "Guard One",
      district: "Kollam",
      siteName: "Samsung HQ",
      attendanceDate: "2026-07-31",
      attendanceSessionId: "session-1",
      status: "Out",
      reportedAt: new Date("2026-07-31T17:00:00.000Z"),
    });
    db.seed("attendanceLogs", "in-log", {
      employeeDocId: "guard-1",
      employeeId: "G-101",
      employeeName: "Guard One",
      district: "Kollam",
      siteName: "Samsung HQ",
      attendanceDate: "2026-07-31",
      attendanceSessionId: "session-1",
      status: "In",
      reportedAt: new Date("2026-07-31T08:00:00.000Z"),
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({
      uid: "fo-1",
      role: "fieldOfficer",
      assignedDistricts: ["Kollam"],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/field-officer/guard-attendance?date=2026-07-31",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      attendance: [
        expect.objectContaining({
          employeeId: "G-101",
          guardName: "Guard One",
          siteName: "Samsung HQ",
          checkIn: "13:30",
          checkOut: "22:30",
          status: "Checked out",
        }),
      ],
    });
  });
});
