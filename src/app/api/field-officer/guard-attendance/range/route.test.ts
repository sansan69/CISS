import { beforeEach, describe, expect, it, vi } from "vitest";

type Filter = { field: string; op: string; value: unknown };

class FakeSnapshot {
  constructor(
    public readonly docs: Array<{
      id: string;
      data: () => Record<string, unknown>;
    }>,
  ) {}
}

class FakeQuery {
  constructor(
    protected readonly store: FakeFirestore,
    protected readonly collectionName: string,
    private readonly filters: Filter[] = [],
    private readonly limitCount?: number,
  ) {}

  where(field: string, op: string, value: unknown) {
    return new FakeQuery(this.store, this.collectionName, [
      ...this.filters,
      { field, op, value },
    ]);
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
      .filter(({ data }) =>
        this.filters.every(({ field, op, value }) => {
          const actual = data[field];
          if (op === "in") {
            return Array.isArray(value) && value.includes(actual);
          }
          if (op === ">=" || op === "<=") {
            let cmp: number;
            if (typeof actual === "string" && typeof value === "string") {
              cmp = actual.localeCompare(value);
            } else {
              const am =
                actual instanceof Date ? actual.getTime() : Number.NaN;
              const bm = value instanceof Date ? value.getTime() : Number.NaN;
              cmp = am < bm ? -1 : am > bm ? 1 : 0;
            }
            return op === ">=" ? cmp >= 0 : cmp <= 0;
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

  listDocs(collectionName: string) {
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

describe("field officer guard attendance range route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function seedDb() {
    const db = new FakeFirestore();
    db.seed("fieldOfficers", "fo-1", {
      uid: "fo-1",
      assignedDistricts: ["Kollam"],
    });
    // Day 1: guard present (in/out).
    db.seed("attendanceLogs", "day1-in", {
      employeeDocId: "guard-1",
      employeeId: "G-101",
      employeeName: "Guard One",
      district: "Kollam",
      siteName: "Samsung HQ",
      attendanceDate: "2026-07-30",
      attendanceSessionId: "session-1",
      status: "In",
      reportedAt: new Date("2026-07-30T08:00:00.000Z"),
    });
    db.seed("attendanceLogs", "day1-out", {
      employeeDocId: "guard-1",
      employeeId: "G-101",
      employeeName: "Guard One",
      district: "Kollam",
      siteName: "Samsung HQ",
      attendanceDate: "2026-07-30",
      attendanceSessionId: "session-1",
      status: "Out",
      reportedAt: new Date("2026-07-30T17:00:00.000Z"),
    });
    // Day 2: different guard attended.
    db.seed("attendanceLogs", "day2-in", {
      employeeDocId: "guard-2",
      employeeId: "G-202",
      employeeName: "Guard Two",
      district: "Kollam",
      siteName: "TCS",
      attendanceDate: "2026-07-31",
      attendanceSessionId: "session-2",
      status: "In",
      reportedAt: new Date("2026-07-31T08:00:00.000Z"),
    });

    verifyRequestAuthMock.mockResolvedValue({
      uid: "fo-1",
      role: "fieldOfficer",
      assignedDistricts: ["Kollam"],
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    return db;
  }

  it("groups attendance per day across the requested range", async () => {
    await seedDb();
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/field-officer/guard-attendance/range?start=2026-07-30&end=2026-07-31",
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.attendance).toHaveLength(2);
    expect(body.attendance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeId: "G-101",
          date: "2026-07-30",
          checkIn: "13:30",
          checkOut: "22:30",
          status: "Checked out",
        }),
        expect.objectContaining({
          employeeId: "G-202",
          date: "2026-07-31",
          checkIn: "13:30",
          status: "Present",
        }),
      ]),
    );
  });

  it("rejects a range longer than the 62-day cap", async () => {
    await seedDb();
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/field-officer/guard-attendance/range?start=2026-01-01&end=2026-05-01",
      ),
    );
    expect(response.status).toBe(400);
  });

  it("rejects invalid date format", async () => {
    await seedDb();
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/field-officer/guard-attendance/range?start=not-a-date&end=2026-07-31",
      ),
    );
    expect(response.status).toBe(400);
  });
});
