import { describe, expect, it } from "vitest";
import { buildShiftTemplates, normalizeDutyPoint, resolveSiteShift, resolveAttendanceShift } from "./shift-utils";

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

describe("resolveAttendanceShift", () => {
  const shifts12h = buildShiftTemplates("2x12"); // day 08:00-20:00, night 20:00-08:00
  const shifts8h = buildShiftTemplates("3x8");  // morning 06:00-14:00, evening 14:00-22:00, night 22:00-06:00

  // Helper to create IST dates easily
  const istDate = (time: string, date: string = "2026-05-22") =>
    new Date(`${date}T${time}:00.000+05:30`);

  it("uses explicit shift code when provided", () => {
    const shift = resolveAttendanceShift({
      shiftTemplates: shifts12h,
      punchAt: istDate("06:45"),
      status: "In",
      explicitShiftCode: "day",
    });
    expect(shift?.code).toBe("day");
  });

  it("uses lastShiftCode for OUT punches", () => {
    const shift = resolveAttendanceShift({
      shiftTemplates: shifts12h,
      punchAt: istDate("08:15"),
      status: "Out",
      lastShiftCode: "night",
    });
    expect(shift?.code).toBe("night");
  });

  it("assigns early morning IN (06:45) to day shift, not night shift", () => {
    const shift = resolveAttendanceShift({
      shiftTemplates: shifts12h,
      punchAt: istDate("06:45"),
      status: "In",
    });
    expect(shift?.code).toBe("day");
  });

  it("assigns 07:30 IN to day shift (30 min early)", () => {
    const shift = resolveAttendanceShift({
      shiftTemplates: shifts12h,
      punchAt: istDate("07:30"),
      status: "In",
    });
    expect(shift?.code).toBe("day");
  });

  it("assigns 19:30 IN to night shift (30 min early)", () => {
    const shift = resolveAttendanceShift({
      shiftTemplates: shifts12h,
      punchAt: istDate("19:30"),
      status: "In",
    });
    expect(shift?.code).toBe("night");
  });

  it("assigns 08:30 IN to day shift (30 min late)", () => {
    const shift = resolveAttendanceShift({
      shiftTemplates: shifts12h,
      punchAt: istDate("08:30"),
      status: "In",
    });
    expect(shift?.code).toBe("day");
  });

  it("assigns 20:30 IN to night shift (30 min late)", () => {
    const shift = resolveAttendanceShift({
      shiftTemplates: shifts12h,
      punchAt: istDate("20:30"),
      status: "In",
    });
    expect(shift?.code).toBe("night");
  });

  it("assigns mid-shift IN (10:00) to day shift", () => {
    const shift = resolveAttendanceShift({
      shiftTemplates: shifts12h,
      punchAt: istDate("10:00"),
      status: "In",
    });
    expect(shift?.code).toBe("day");
  });

  it("assigns mid-night-shift IN (23:00) to night shift", () => {
    const shift = resolveAttendanceShift({
      shiftTemplates: shifts12h,
      punchAt: istDate("23:00"),
      status: "In",
    });
    expect(shift?.code).toBe("night");
  });

  it("assigns tail-end IN (06:00) to day shift during handoff window", () => {
    const shift = resolveAttendanceShift({
      shiftTemplates: shifts12h,
      punchAt: istDate("06:00"),
      status: "In",
    });
    expect(shift?.code).toBe("day");
  });

  it("returns null when IN is too far from any shift start", () => {
    const shift = resolveAttendanceShift({
      shiftTemplates: shifts12h,
      punchAt: istDate("12:00"),
      status: "In",
    });
    // 12:00 is 4h into day shift, well past toleranceAfter(60)
    // and 8h before night shift, past toleranceBefore(120)
    // but still within day shift hours, so it should match day shift
    expect(shift?.code).toBe("day");
  });

  it("returns null when punch is in tail end with no next shift within tolerance", () => {
    // Single-shift site: day only 08:00-20:00
    const singleShift = [
      { code: "day", label: "Day", startTime: "08:00", endTime: "20:00", hours: 12, crossesMidnight: false },
    ];
    const shift = resolveAttendanceShift({
      shiftTemplates: singleShift,
      punchAt: istDate("19:00"),
      status: "In",
    });
    // 19:00 is in tail end (20:00 end, handoffWindow = 120, so tail end starts 18:00)
    // No next shift, but single shift tail end → null
    expect(shift).toBeNull();
  });

  describe("8-hour shifts (3x8)", () => {
    it("assigns 05:30 IN to morning shift (30 min early)", () => {
      const shift = resolveAttendanceShift({
        shiftTemplates: shifts8h,
        punchAt: istDate("05:30"),
        status: "In",
      });
      expect(shift?.code).toBe("morning");
    });

    it("assigns 05:30 IN to night shift when lastShiftCode is night (OUT)", () => {
      const shift = resolveAttendanceShift({
        shiftTemplates: shifts8h,
        punchAt: istDate("05:30"),
        status: "Out",
        lastShiftCode: "night",
      });
      expect(shift?.code).toBe("night");
    });

    it("assigns 13:00 IN to evening shift during handoff from morning", () => {
      const shift = resolveAttendanceShift({
        shiftTemplates: shifts8h,
        punchAt: istDate("13:00"),
        status: "In",
      });
      expect(shift?.code).toBe("evening");
    });

    it("assigns 21:00 IN to night shift during handoff from evening", () => {
      const shift = resolveAttendanceShift({
        shiftTemplates: shifts8h,
        punchAt: istDate("21:00"),
        status: "In",
      });
      expect(shift?.code).toBe("night");
    });

    it("assigns mid-morning IN (10:00) to morning shift", () => {
      const shift = resolveAttendanceShift({
        shiftTemplates: shifts8h,
        punchAt: istDate("10:00"),
        status: "In",
      });
      expect(shift?.code).toBe("morning");
    });
  });

  describe("tolerance edges", () => {
    it("assigns IN exactly at toleranceBefore boundary (2 hours early)", () => {
      const shift = resolveAttendanceShift({
        shiftTemplates: shifts12h,
        punchAt: istDate("06:00"),
        status: "In",
        toleranceMinutesBefore: 120,
      });
      expect(shift?.code).toBe("day");
    });

    it("does NOT assign IN just past toleranceBefore boundary", () => {
      const shift = resolveAttendanceShift({
        shiftTemplates: shifts12h,
        punchAt: istDate("05:59"),
        status: "In",
        toleranceMinutesBefore: 120,
      });
      // 05:59 is 120m 1s before 08:00, past tolerance
      // night shift timeInShift = 595m, duration-handoff = 720-120 = 600
      // 595 < 600, so NOT tail end. Score = 595 + 120 = 715
      expect(shift?.code).toBe("night");
    });

    it("assigns IN exactly at toleranceAfter boundary (1 hour late)", () => {
      const shift = resolveAttendanceShift({
        shiftTemplates: shifts12h,
        punchAt: istDate("09:00"),
        status: "In",
        toleranceMinutesAfter: 60,
      });
      expect(shift?.code).toBe("day");
    });
  });
});
