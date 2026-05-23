import { describe, expect, it } from "vitest";
import { buildShiftTemplates, normalizeDutyPoint, resolveSiteShift } from "./shift-utils";

describe("normalizeDutyPoint", () => {
  it("omits undefined optional fields so Firestore can store the duty point", () => {
    const point = normalizeDutyPoint({
      id: "main",
      name: "Main Gate",
      coverageMode: "roundClock",
      dutyHours: "12",
      shiftMode: "fixed",
      shiftTemplates: [],
    });

    expect(point).toEqual({
      id: "main",
      name: "Main Gate",
      active: true,
      coverageMode: "roundClock",
      dutyHours: "12",
      patrolPoints: [],
      shiftMode: "fixed",
      shiftTemplates: [
        {
          code: "day",
          label: "Day Shift",
          startTime: "08:00",
          endTime: "20:00",
          hours: 12,
          crossesMidnight: false,
        },
        {
          code: "night",
          label: "Night Shift",
          startTime: "20:00",
          endTime: "08:00",
          hours: 12,
          crossesMidnight: true,
        },
      ],
    });
    expect(Object.prototype.hasOwnProperty.call(point, "code")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(point, "geofenceRadiusMeters")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(point, "notes")).toBe(false);
  });
});

describe("resolveSiteShift", () => {
  it("resolves shift windows in the configured site timezone", () => {
    const shift = resolveSiteShift(
      "fixed",
      buildShiftTemplates("3x8"),
      new Date("2026-05-22T16:45:00.000Z"),
      "Asia/Kolkata",
    );

    expect(shift?.code).toBe("night");
  });
});
