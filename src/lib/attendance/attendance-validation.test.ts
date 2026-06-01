import { describe, expect, it } from "vitest";
import {
  canRecordNextDayCheckout,
  resolveAttendanceSubmissionWindow,
  resolveOperationalAttendanceDate,
  canRecordIn,
  canRecordOut,
  isSessionStale,
  computeAutoCheckoutTime,
} from "./attendance-validation";

describe("canRecordNextDayCheckout", () => {
  it("allows next-day checkout for an overnight shift when site, duty point, and shift match", () => {
    expect(
      canRecordNextDayCheckout({
        attendanceDate: "2026-04-30",
        status: "Out",
        siteId: "site-1",
        dutyPointId: "duty-1",
        shift: { code: "night", crossesMidnight: true },
        lastState: {
          lastAttendanceDate: "2026-04-29",
          lastStatus: "In",
          lastSiteId: "site-1",
          lastDutyPointId: "duty-1",
          lastShiftCode: "night",
        },
      }),
    ).toBe(true);
  });

  it("rejects next-day checkout when the shift does not cross midnight", () => {
    expect(
      canRecordNextDayCheckout({
        attendanceDate: "2026-04-30",
        status: "Out",
        siteId: "site-1",
        dutyPointId: "duty-1",
        shift: { code: "day", crossesMidnight: false },
        lastState: {
          lastAttendanceDate: "2026-04-29",
          lastStatus: "In",
          lastSiteId: "site-1",
          lastDutyPointId: "duty-1",
          lastShiftCode: "day",
        },
      }),
    ).toBe(false);
  });

  it("allows next-morning checkout when the current time resolves to a day shift but the previous IN shift crossed midnight", () => {
    expect(
      canRecordNextDayCheckout({
        attendanceDate: "2026-05-17",
        status: "Out",
        siteId: "site-1",
        dutyPointId: "duty-1",
        shift: { code: "day", crossesMidnight: false },
        lastShift: { code: "night", crossesMidnight: true },
        lastState: {
          lastAttendanceDate: "2026-05-16",
          lastStatus: "In",
          lastSiteId: "site-1",
          lastDutyPointId: "duty-1",
          lastShiftCode: "night",
        },
      }),
    ).toBe(true);
  });
});

describe("resolveOperationalAttendanceDate", () => {
  it("keeps a fresh IN on the submitted date when no session is open", () => {
    expect(
      resolveOperationalAttendanceDate({
        attendanceDate: "2026-05-20",
        status: "In",
        siteId: "site-1",
        dutyPointId: "floor-2-day",
        shift: { code: "day", crossesMidnight: false },
        lastState: {
          lastAttendanceDate: "2026-05-19",
          lastStatus: "Out",
          lastSiteId: "site-1",
          lastDutyPointId: "floor-1-night",
          lastShiftCode: "night",
        },
      }),
    ).toBe("2026-05-20");
  });
});

describe("resolveAttendanceSubmissionWindow", () => {
  it("closes an open session using the original IN date when duty point and shift changed before checkout", () => {
    expect(
      resolveAttendanceSubmissionWindow({
        attendanceDate: "2026-05-20",
        status: "Out",
        siteId: "site-1",
        dutyPointId: "floor-2-day",
        shift: { code: "day", crossesMidnight: false },
        lastShift: { code: "night", crossesMidnight: true },
        lastState: {
          lastAttendanceDate: "2026-05-19",
          lastStatus: "In",
          lastSiteId: "site-1",
          lastDutyPointId: "floor-1-night",
          lastShiftCode: "night",
          openSessionId: "session-1",
          openSessionStartedAt: "2026-05-19T20:00:00.000+05:30",
        },
      }),
    ).toEqual({
      attendanceDate: "2026-05-19",
      openSessionId: "session-1",
      closingOpenSession: true,
      contextChanged: true,
      requiresAdminReview: true,
    });
  });

  it("does not rewrite a stale non-overnight checkout to the previous IN date", () => {
    expect(
      resolveAttendanceSubmissionWindow({
        attendanceDate: "2026-05-21",
        status: "Out",
        siteId: "site-1",
        dutyPointId: "main-day",
        shift: { code: "day", crossesMidnight: false },
        lastShift: { code: "day", crossesMidnight: false },
        lastState: {
          lastAttendanceDate: "2026-05-20",
          lastStatus: "In",
          lastSiteId: "site-1",
          lastDutyPointId: "main-day",
          lastShiftCode: "day",
          openSessionId: "session-1",
        },
      }),
    ).toEqual({
      attendanceDate: "2026-05-21",
      openSessionId: "session-1",
      closingOpenSession: true,
      contextChanged: false,
      requiresAdminReview: false,
    });
  });

  it("keeps a fresh IN on the submitted date when no session is open", () => {
    expect(
      resolveAttendanceSubmissionWindow({
        attendanceDate: "2026-05-20",
        status: "In",
        siteId: "site-1",
        dutyPointId: "floor-2-day",
        shift: { code: "day", crossesMidnight: false },
        lastState: {
          lastAttendanceDate: "2026-05-19",
          lastStatus: "Out",
          lastSiteId: "site-1",
          lastDutyPointId: "floor-1-night",
          lastShiftCode: "night",
        },
      }),
    ).toEqual({
      attendanceDate: "2026-05-20",
      openSessionId: null,
      closingOpenSession: false,
      contextChanged: false,
      requiresAdminReview: false,
    });
  });
});

describe("computeAutoCheckoutTime", () => {
  it("computes auto-checkout for day shift ending at 20:00 with 2h buffer", () => {
    const time = computeAutoCheckoutTime({
      sessionStartDate: "2026-05-20",
      shift: { code: "day", crossesMidnight: false, startTime: "08:00", endTime: "20:00", hours: 12 },
      bufferMinutes: 120,
    });
    expect(time).toBe("2026-05-20T22:00:00.000Z");
  });

  it("computes auto-checkout for night shift ending at 08:00 next day with 2h buffer", () => {
    const time = computeAutoCheckoutTime({
      sessionStartDate: "2026-05-20",
      shift: { code: "night", crossesMidnight: true, startTime: "20:00", endTime: "08:00", hours: 12 },
      bufferMinutes: 120,
    });
    expect(time).toBe("2026-05-21T10:00:00.000Z");
  });

  it("returns null when shift info is missing", () => {
    const time = computeAutoCheckoutTime({
      sessionStartDate: "2026-05-20",
      shift: null,
    });
    expect(time).toBeNull();
  });
});

describe("isSessionStale", () => {
  it("marks session stale when past auto-checkout time", () => {
    const result = isSessionStale({
      lastState: {
        lastStatus: "In",
        lastAttendanceDate: "2026-05-20",
        autoCheckoutAt: "2026-05-20T10:00:00.000Z",
      },
      now: new Date("2026-05-20T12:00:00.000Z"),
    });
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("exceeded auto-checkout");
  });

  it("marks session stale when older than max hours", () => {
    const result = isSessionStale({
      lastState: {
        lastStatus: "In",
        lastAttendanceDate: "2026-05-18",
      },
      now: new Date("2026-05-20T12:00:00.000Z"),
      maxSessionHours: 24,
    });
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("hours");
  });

  it("does not mark session stale when within auto-checkout time", () => {
    const result = isSessionStale({
      lastState: {
        lastStatus: "In",
        lastAttendanceDate: "2026-05-20",
        autoCheckoutAt: "2026-05-20T22:00:00.000Z",
      },
      now: new Date("2026-05-20T12:00:00.000Z"),
    });
    expect(result.stale).toBe(false);
  });

  it("returns not stale when no open session", () => {
    const result = isSessionStale({
      lastState: { lastStatus: "Out", lastAttendanceDate: "2026-05-20" },
    });
    expect(result.stale).toBe(false);
  });
});

describe("canRecordIn", () => {
  it("allows IN when no previous state", () => {
    const result = canRecordIn({
      lastState: null,
      attendanceDate: "2026-05-20",
      siteId: "site-1",
      shift: { code: "day" },
      employeeDocId: "emp-1",
    });
    expect(result.ok).toBe(true);
    expect(result.action).toBe("allow");
  });

  it("allows IN when previous was OUT", () => {
    const result = canRecordIn({
      lastState: { lastStatus: "Out", lastAttendanceDate: "2026-05-20" },
      attendanceDate: "2026-05-20",
      siteId: "site-1",
      shift: { code: "night" },
      employeeDocId: "emp-1",
    });
    expect(result.ok).toBe(true);
    expect(result.action).toBe("allow");
  });

  it("blocks duplicate IN on same date at same duty point", () => {
    const result = canRecordIn({
      lastState: {
        lastStatus: "In",
        lastAttendanceDate: "2026-05-20",
        lastSiteId: "site-1",
        lastDutyPointId: "dp-1",
      },
      attendanceDate: "2026-05-20",
      siteId: "site-1",
      dutyPointId: "dp-1",
      shift: { code: "day" },
      employeeDocId: "emp-1",
    });
    expect(result.ok).toBe(false);
    expect(result.action).toBe("block");
  });

  it("allows IN at different site even with open session", () => {
    const result = canRecordIn({
      lastState: {
        lastStatus: "In",
        lastAttendanceDate: "2026-05-20",
        lastSiteId: "site-1",
        lastDutyPointId: "dp-1",
      },
      attendanceDate: "2026-05-20",
      siteId: "site-2",
      shift: { code: "day" },
      employeeDocId: "emp-1",
    });
    expect(result.ok).toBe(true);
    expect(result.action).toBe("allow");
  });

  it("auto-closes stale session from previous date", () => {
    const result = canRecordIn({
      lastState: {
        lastStatus: "In",
        lastAttendanceDate: "2026-05-18",
        lastSiteId: "site-1",
        lastDutyPointId: "dp-1",
      },
      attendanceDate: "2026-05-20",
      siteId: "site-1",
      shift: { code: "day" },
      employeeDocId: "emp-1",
    });
    expect(result.ok).toBe(true);
    expect(result.action).toBe("autoClosePrevious");
  });
});

describe("canRecordOut", () => {
  it("blocks OUT when no open session", () => {
    const result = canRecordOut({
      lastState: null,
      attendanceDate: "2026-05-20",
      siteId: "site-1",
      shift: { code: "day" },
    });
    expect(result.ok).toBe(false);
    expect(result.action).toBe("block");
  });

  it("blocks OUT when last status was OUT", () => {
    const result = canRecordOut({
      lastState: { lastStatus: "Out", lastAttendanceDate: "2026-05-20" },
      attendanceDate: "2026-05-20",
      siteId: "site-1",
      shift: { code: "day" },
    });
    expect(result.ok).toBe(false);
    expect(result.action).toBe("block");
  });

  it("allows same-day OUT", () => {
    const result = canRecordOut({
      lastState: {
        lastStatus: "In",
        lastAttendanceDate: "2026-05-20",
        lastSiteId: "site-1",
        lastDutyPointId: "dp-1",
      },
      attendanceDate: "2026-05-20",
      siteId: "site-1",
      dutyPointId: "dp-1",
      shift: { code: "day", crossesMidnight: false },
    });
    expect(result.ok).toBe(true);
    expect(result.action).toBe("allow");
  });

  it("allows next-day OUT for overnight shift", () => {
    const result = canRecordOut({
      lastState: {
        lastStatus: "In",
        lastAttendanceDate: "2026-05-19",
        lastSiteId: "site-1",
        lastDutyPointId: "dp-1",
        lastShiftCode: "night",
        autoCheckoutAt: "2026-05-20T10:00:00.000Z",
      },
      attendanceDate: "2026-05-20",
      siteId: "site-1",
      dutyPointId: "dp-1",
      shift: { code: "day", crossesMidnight: false },
    });
    expect(result.ok).toBe(true);
    expect(result.action).toBe("allow");
  });

  it("auto-closes stale session on late OUT attempt", () => {
    const result = canRecordOut({
      lastState: {
        lastStatus: "In",
        lastAttendanceDate: "2026-05-18",
        lastSiteId: "site-1",
        lastDutyPointId: "dp-1",
      },
      attendanceDate: "2026-05-20",
      siteId: "site-1",
      dutyPointId: "dp-1",
      shift: { code: "day" },
    });
    expect(result.ok).toBe(true);
    expect(result.action).toBe("autoCloseStale");
  });
});
