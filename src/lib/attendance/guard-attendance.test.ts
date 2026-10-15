import { describe, expect, it } from "vitest";
import { aggregateGuardAttendance } from "./guard-attendance";

function fakeDb(rows: Array<{ id: string; data: Record<string, unknown> }>) {
  const filters: Array<[string, string, unknown]> = [];
  const query = {
    where(field: string, op: string, value: unknown) {
      filters.push([field, op, value]);
      return query;
    },
    limit() {
      return query;
    },
    async get() {
      return {
        docs: rows
          .filter(({ data }) =>
            filters.every(([field, op, value]) =>
              op === "=="
                ? data[field] === value
                : op === "in"
                  ? (value as unknown[]).includes(data[field])
                  : true,
            ),
          )
          .map(({ id, data }) => ({ id, data: () => data })),
      };
    },
  };
  const db = {
    collection(name: string) {
      if (name === "workOrders")
        throw new Error("work orders must not be queried");
      return query;
    },
  };
  return db as never;
}

const base = {
  employeeDocId: "g1",
  employeeId: "G-1",
  employeeName: "Guard One",
  district: "Kollam",
  attendanceDate: "2026-07-31",
  attendanceSessionId: "s1",
  siteName: "Site",
  reportedAt: new Date("2026-07-31T08:00:00Z"),
};
const input = (db: never, date = "2026-07-31") => ({
  adminDb: db,
  isAdmin: false,
  assignedDistricts: ["Kollam"],
  requestedDistrict: null,
  startDate: date,
  endDate: date,
});

describe("aggregateGuardAttendance recorded events", () => {
  it("returns no absent placeholder for assigned guards without punches", async () => {
    expect(await aggregateGuardAttendance(input(fakeDb([])))).toEqual([]);
  });
  it("keeps actual IN and OUT records without reading work orders", async () => {
    const db = fakeDb([
      { id: "in", data: { ...base, status: "In" } },
      {
        id: "out",
        data: {
          ...base,
          status: "Out",
          reportedAt: new Date("2026-07-31T17:00:00Z"),
        },
      },
      {
        id: "noise",
        data: { ...base, attendanceSessionId: "s2", status: "Unknown" },
      },
      {
        id: "missing-time",
        data: {
          ...base,
          attendanceSessionId: "s3",
          status: "In",
          reportedAt: null,
          createdAt: null,
        },
      },
    ]);
    const result = await aggregateGuardAttendance(input(db));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      checkIn: "13:30",
      checkOut: "22:30",
      status: "Checked out",
    });
  });
  it("returns exact punch timestamps and persisted shift bounds", async () => {
    const result = await aggregateGuardAttendance(
      input(
        fakeDb([
          {
            id: "in",
            data: {
              ...base,
              status: "In",
              shiftStartsAt: new Date("2026-07-31T07:30:00Z"),
              shiftEndsAt: new Date("2026-07-31T15:30:00Z"),
            },
          },
          {
            id: "out",
            data: {
              ...base,
              status: "Out",
              reportedAt: new Date("2026-07-31T17:00:00Z"),
              shiftStartsAt: new Date("2026-07-31T07:30:00Z"),
              shiftEndsAt: new Date("2026-07-31T15:30:00Z"),
            },
          },
        ]),
      ),
    );
    expect(result[0]).toMatchObject({
      checkInAt: "2026-07-31T08:00:00.000Z",
      checkOutAt: "2026-07-31T17:00:00.000Z",
      shiftStartsAt: "2026-07-31T07:30:00.000Z",
      shiftEndsAt: "2026-07-31T15:30:00.000Z",
    });
  });
  it("retains an out-only recorded session", async () => {
    const result = await aggregateGuardAttendance(
      input(fakeDb([{ id: "out", data: { ...base, status: "Out" } }])),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      checkIn: null,
      checkOut: "13:30",
      status: "Checked out",
    });
  });
  it("uses the same recorded-only behavior for range queries", async () => {
    const db = fakeDb([]);
    const result = await aggregateGuardAttendance({
      ...input(db),
      endDate: "2026-08-01",
    });
    expect(result).toEqual([]);
  });
});
