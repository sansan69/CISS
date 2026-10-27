import { afterEach, describe, expect, it, vi } from "vitest";

const GUARD = {
  uid: "guard-uid-1",
  employeeId: "CISS/TCS/2025-26/871",
  employeeDocId: "emp-doc-1",
};

type Harness = {
  queriedEmployeeDocIds: unknown[];
};

function mockModules(
  options: {
    docs?: Array<Record<string, any>>;
    guardDenied?: boolean;
  } = {},
): Harness {
  const queriedEmployeeDocIds: unknown[] = [];

  const makeQuery = (
    collectionName: string,
    filters: Array<[string, unknown]> = [],
    limitCount?: number,
  ) => ({
    where(field: string, op: string, value: unknown) {
      if (field === "employeeDocId") queriedEmployeeDocIds.push(value);
      return makeQuery(collectionName, [...filters, [field, value]], limitCount);
    },
    limit(count: number) {
      return makeQuery(collectionName, filters, count);
    },
    async get() {
      const sourceDocs =
        collectionName === "payrollEntries" ? [] : (options.docs ?? []);
      const rows = sourceDocs.filter((doc) =>
        filters.every(([field, value]) => doc.data()[field] === value),
      );
      const sliced = typeof limitCount === "number" ? rows.slice(0, limitCount) : rows;
      return {
        docs: sliced.map((doc) => ({ id: doc.id, data: () => doc.data() })),
        size: sliced.length,
      };
    },
  });

  const db = {
    collection: vi.fn((name: string) => makeQuery(name)),
  };

  vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
  vi.doMock("@/lib/server/guard-auth", () => ({
    requireGuard: vi.fn(async () => {
      if (options.guardDenied) throw new Error("Guard access required.");
      return GUARD;
    }),
  }));

  return { queriedEmployeeDocIds };
}

async function getPayslips() {
  const { GET } = await import("./route");
  const response = await GET(
    new Request("https://example.test/api/guard/payslips", { method: "GET" }),
  );
  const text = await response.text();
  return { response, text, body: text ? JSON.parse(text) : null };
}

const DOCS = [
  {
    id: "slip-1",
    data: () => ({
      employeeDocId: GUARD.employeeDocId,
      employeeId: GUARD.employeeId,
      period: "2025-12",
      fileName: "december.pdf",
      sizeBytes: 1200,
      createdAt: { seconds: 1_700_000_000 },
    }),
  },
  {
    id: "slip-2",
    data: () => ({
      employeeDocId: GUARD.employeeDocId,
      employeeId: GUARD.employeeId,
      period: "2026-01",
      fileName: "january.pdf",
      sizeBytes: 1500,
      createdAt: { seconds: 1_700_100_000 },
    }),
  },
  {
    id: "slip-3",
    data: () => ({
      employeeDocId: "emp-doc-OTHER",
      employeeId: "CISS/TCS/2025-26/999",
      period: "2026-01",
      fileName: "someone-else.pdf",
      sizeBytes: 999,
    }),
  },
];

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("GET /api/guard/payslips", () => {
  it("returns only the caller's payslips, newest period first", async () => {
    const harness = mockModules({ docs: DOCS });

    const { response, body } = await getPayslips();

    expect(response.status).toBe(200);
    expect(body.payslips.map((slip: { id: string }) => slip.id)).toEqual(["slip-2", "slip-1"]);
    expect(body.payslips[0]).toMatchObject({
      id: "slip-2",
      period: "2026-01",
      fileName: "january.pdf",
      sizeBytes: 1500,
      employeeId: GUARD.employeeId,
      createdAt: "2023-11-16T02:00:00.000Z",
    });

    // Ownership is enforced in the query, not by filtering client-side.
    expect(harness.queriedEmployeeDocIds).toContain(GUARD.employeeDocId);
    // No pay amounts or storage paths leak to the guard.
    expect(JSON.stringify(body)).not.toContain("storagePath");
    expect(JSON.stringify(body)).not.toContain("netPay");
    expect(JSON.stringify(body.payslips)).not.toContain("someone-else.pdf");
  });

  it("returns an empty list when the guard has no payslips", async () => {
    mockModules({ docs: [] });

    const { response, body } = await getPayslips();

    expect(response.status).toBe(200);
    expect(body.payslips).toEqual([]);
  });

  it("denies a caller without guard access", async () => {
    mockModules({ guardDenied: true });

    const { response, body } = await getPayslips();

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/Guard access required/);
  });
});
