import { describe, expect, it } from "vitest";

import { aggregateAttendance } from "./attendance-aggregator";

type Row = { id: string; data: Record<string, unknown> };

function createDb({
  employeeId = "EMP-1",
  modern = [],
  legacy = [],
}: {
  employeeId?: string;
  modern?: Row[];
  legacy?: Row[];
}) {
  return {
    collection(name: string) {
      if (name === "employees") {
        return {
          doc() {
            return {
              get: async () => ({
                data: () => ({ employeeId }),
              }),
            };
          },
        };
      }

      let identifierField = "";
      return {
        where(field: string) {
          if (field === "employeeDocId" || field === "employeeId") {
            identifierField = field;
          }
          return this;
        },
        get: async () => ({
          docs: (identifierField === "employeeDocId" ? modern : legacy).map(
            (row) => ({
              id: row.id,
              data: () => row.data,
            }),
          ),
        }),
      };
    },
  };
}

describe("aggregateAttendance", () => {
  it("merges modern and legacy check-ins without double counting", async () => {
    const db = createDb({
      modern: [
        {
          id: "same",
          data: { attendanceDate: "2026-07-01", status: "In" },
        },
      ],
      legacy: [
        {
          id: "same",
          data: { attendanceDate: "2026-07-01", status: "In" },
        },
        {
          id: "legacy-only",
          data: { attendanceDate: "2026-07-02", status: "In" },
        },
      ],
    });

    const summary = await aggregateAttendance(
      "employee-doc-1",
      "2026-07",
      db as never,
    );

    expect(summary.presentDays).toBe(2);
  });

  it("does not count isolated OUT or rejected check-ins", async () => {
    const db = createDb({
      modern: [
        {
          id: "out-only",
          data: { attendanceDate: "2026-07-03", status: "Out" },
        },
        {
          id: "rejected",
          data: {
            attendanceDate: "2026-07-04",
            status: "In",
            reviewStatus: "rejected",
          },
        },
        {
          id: "valid",
          data: { attendanceDate: "2026-07-05", status: "In" },
        },
      ],
    });

    const summary = await aggregateAttendance(
      "employee-doc-1",
      "2026-07",
      db as never,
    );

    expect(summary.presentDays).toBe(1);
  });

  it("uses roster dates when they are supplied", async () => {
    const db = createDb({
      modern: [
        {
          id: "valid",
          data: { attendanceDate: "2026-07-05", status: "In" },
        },
      ],
    });

    const summary = await aggregateAttendance(
      "employee-doc-1",
      "2026-07",
      db as never,
      {
        scheduledDates: ["2026-07-05", "2026-07-06", "2026-07-06"],
      },
    );

    expect(summary).toEqual({ presentDays: 1, workingDays: 2 });
  });
});
