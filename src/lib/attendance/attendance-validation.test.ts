import { describe, expect, it } from "vitest";
import {
  canRecordNextDayCheckout,
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
});
