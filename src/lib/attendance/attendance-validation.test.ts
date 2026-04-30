import { describe, expect, it } from "vitest";
import { canRecordNextDayCheckout } from "./attendance-validation";

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
});
