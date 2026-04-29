import { describe, expect, it } from "vitest";
import { normalizeDutyPoint } from "./shift-utils";

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
