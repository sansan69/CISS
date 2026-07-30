import { NextRequest } from "next/server";
import readXlsxFile from "read-excel-file/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const collections = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>();
  return {
    collections,
    verifyIdToken: vi.fn(() =>
      Promise.resolve({ uid: "admin-user", role: "admin" }),
    ),
  };
});

class FakeQuery {
  private filters: Array<{ field: string; operator: string; value: unknown }> = [];

  constructor(private readonly collectionName: string) {}

  where(field: string, operator: string, value: unknown) {
    this.filters.push({ field, operator, value });
    return this;
  }

  limit() {
    return this;
  }

  async get() {
    const rows = mocks.collections.get(this.collectionName) ?? [];
    const filtered = rows.filter((row) =>
      this.filters.every(({ field, operator, value }) => {
        const actual = field === "__name__" ? row.id : row.data[field];
        if (operator === "==") return actual === value;
        if (operator === "in") {
          return Array.isArray(value) && value.includes(actual);
        }
        return false;
      }),
    );
    return {
      empty: filtered.length === 0,
      docs: filtered.map((row) => ({
        id: row.id,
        data: () => row.data,
      })),
    };
  }
}

vi.mock("@/lib/firebaseAdmin", () => ({
  auth: { verifyIdToken: mocks.verifyIdToken },
  db: {
    collection: (name: string) => new FakeQuery(name),
  },
}));

describe("assigned guard workbook export", () => {
  beforeEach(() => {
    mocks.collections.clear();
    mocks.verifyIdToken.mockClear();
    mocks.collections.set("fieldOfficers", []);
    mocks.collections.set("sites", [
      {
        id: "site-doc",
        data: {
          siteId: "SITE-001",
          siteName: "Alpha Centre",
          state: "Kerala",
        },
      },
    ]);
    mocks.collections.set("employees", [
      {
        id: "guard-1",
        data: {
          firstName: "Asha",
          lastName: "Nair",
          gender: "Female",
          dateOfBirth: new Date("1995-05-12T00:00:00.000Z"),
          fatherName: "Ravi",
          motherName: "Meera",
          fullAddress: "Kochi, Kerala",
          phoneNumber: "9000000001",
          emailAddress: "ASHA@example.com",
          resourceIdNumber: "RES-1",
          identityProofType: "Aadhar Card",
          identityProofNumber: "123456789012",
        },
      },
    ]);
    mocks.collections.set("workOrders", [
      {
        id: "work-order-1",
        data: {
          siteId: "SITE-001",
          siteName: "Fallback Centre",
          clientName: "TCS",
          district: "Ernakulam",
          date: new Date("2026-08-01T06:30:00.000Z"),
          recordStatus: "active",
          examName: "TCS Exam",
          assignedGuards: [
            {
              uid: "guard-1",
              name: "Asha Nair",
              employeeId: "EMP-1",
              gender: "Female",
            },
          ],
        },
      },
    ]);
  });

  it("returns a valid workbook containing assigned guard details", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://example.com/api/admin/work-orders/assigned-guards-export?district=Ernakulam",
        { headers: { Authorization: "Bearer admin-token" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("x-export-row-count")).toBe("1");
    expect(response.headers.get("content-disposition")).toContain(
      "Assigned_Guards_Ernakulam.xlsx",
    );

    const workbook = await readXlsxFile(
      Buffer.from(await response.arrayBuffer()),
    );
    const rows = workbook[0]?.data ?? [];
    expect(rows[0]).toEqual(
      expect.arrayContaining(["Center Name", "Exam Name", "contact number"]),
    );
    expect(rows[1]).toEqual(
      expect.arrayContaining([
        "Alpha Centre",
        "TCS Exam",
        "Asha",
        "Nair",
        "9000000001",
      ]),
    );
  });

  it("returns a clear response when no assignments match the filters", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://example.com/api/admin/work-orders/assigned-guards-export?district=Kollam",
        { headers: { Authorization: "Bearer admin-token" } },
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "No assigned guards match the selected filters.",
    });
  });
});
