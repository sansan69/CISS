import { describe, expect, it } from "vitest";
import {
  canRecordNextDayCheckout,
  resolveAttendanceSubmissionWindow,
  resolveOperationalAttendanceDate,
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

  it("keeps next-morning checkout attached to the previous shift day even if the current time resolves to a day shift", () => {
    expect(
      resolveOperationalAttendanceDate({
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
    ).toBe("2026-05-16");
  });

  it("keeps an overnight next-day checkout attached to the previous shift day", () => {
    expect(
      resolveOperationalAttendanceDate({
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
    ).toBe("2026-04-29");
  });

  it("keeps a new attendance cycle on the current day", () => {
    expect(
      resolveOperationalAttendanceDate({
        attendanceDate: "2026-04-30",
        status: "In",
        siteId: "site-1",
        dutyPointId: "duty-1",
        shift: { code: "night", crossesMidnight: true },
        lastState: {
          lastAttendanceDate: "2026-04-29",
          lastStatus: "Out",
          lastSiteId: "site-1",
          lastDutyPointId: "duty-1",
          lastShiftCode: "night",
        },
      }),
    ).toBe("2026-04-30");
  });

  it("keeps a same-day fresh IN on the current operational day after checkout", () => {
    expect(
      resolveOperationalAttendanceDate({
        attendanceDate: "2026-05-20",
        status: "In",
        siteId: "site-1",
        dutyPointId: "duty-1",
        shift: { code: "night", crossesMidnight: true },
        lastState: {
          lastAttendanceDate: "2026-05-20",
          lastStatus: "Out",
          lastSiteId: "site-1",
          lastDutyPointId: "duty-1",
          lastShiftCode: "night",
        },
      }),
    ).toBe("2026-05-20");
  });

  it("rejects next-day checkout for a non-overnight shift even when an IN session is still open", () => {
    expect(
      canRecordNextDayCheckout({
        attendanceDate: "2026-05-21",
        status: "Out",
        siteId: "site-1",
        dutyPointId: "duty-1",
        shift: { code: "day", crossesMidnight: false },
        lastShift: { code: "day", crossesMidnight: false },
        lastState: {
          lastAttendanceDate: "2026-05-20",
          lastStatus: "In",
          lastSiteId: "site-1",
          lastDutyPointId: "duty-1",
          lastShiftCode: "day",
          openSessionId: "session-1",
        },
      }),
    ).toBe(false);
  });

  it("rejects stale checkout after the immediate next date for an overnight shift", () => {
    expect(
      canRecordNextDayCheckout({
        attendanceDate: "2026-05-22",
        status: "Out",
        siteId: "site-1",
        dutyPointId: "duty-1",
        shift: { code: "night", crossesMidnight: true },
        lastShift: { code: "night", crossesMidnight: true },
        lastState: {
          lastAttendanceDate: "2026-05-20",
          lastStatus: "In",
          lastSiteId: "site-1",
          lastDutyPointId: "duty-1",
          lastShiftCode: "night",
          openSessionId: "session-1",
        },
      }),
    ).toBe(false);
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
