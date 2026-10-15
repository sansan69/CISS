import { afterEach, describe, expect, it, vi } from "vitest";

function mockRoute(rows: Array<Record<string, unknown>>) {
  const query = {
    where: vi.fn(() => query),
    get: vi.fn(async () => ({
      empty: rows.length === 0,
      docs: rows.map((data, index) => ({
        id: `log-${index}`,
        data: () => data,
      })),
    })),
  };
  const db = { collection: vi.fn(() => query) };
  vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
  vi.doMock("@/lib/server/guard-auth", () => ({
    requireGuard: vi.fn(async () => ({
      employeeDocId: "guard-1",
      employeeId: "E1",
    })),
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("guard attendance DTO", () => {
  it("serializes actual punch chronology and persisted shift bounds alongside the business date", async () => {
    mockRoute([
      {
        attendanceDate: "2026-10-14",
        status: "Out",
        reportedAt: new Date("2026-10-15T00:40:00.000Z"),
        shiftStartsAt: new Date("2026-10-14T14:30:00.000Z"),
        shiftEndsAt: new Date("2026-10-15T02:30:00.000Z"),
      },
      {
        attendanceDate: "2026-10-14",
        status: "In",
        reportedAt: new Date("2026-10-14T14:35:00.000Z"),
        shiftStartsAt: new Date("2026-10-14T14:30:00.000Z"),
        shiftEndsAt: new Date("2026-10-15T02:30:00.000Z"),
      },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://example.test/api/guard/attendance?month=2026-10"),
    );
    const body = await response.json();
    expect(body.logs[0]).toMatchObject({
      date: "2026-10-14",
      status: "Out",
      reportedAt: "2026-10-15T00:40:00.000Z",
      shiftStartsAt: "2026-10-14T14:30:00.000Z",
      shiftEndsAt: "2026-10-15T02:30:00.000Z",
    });
    expect(body.logs[1].reportedAt).toBe("2026-10-14T14:35:00.000Z");
  });
});
