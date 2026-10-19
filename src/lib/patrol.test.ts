import { describe, expect, it } from "vitest";

import {
  buildPatrolActivityPayload,
  computeHourlyNightPatrolState,
  isWithinNightWindow,
  normalizePatrolPoints,
  resolvePatrolSettings,
} from "@/lib/patrol";

describe("patrol helpers", () => {
  it("returns safe default patrol settings", () => {
    expect(resolvePatrolSettings(null)).toEqual({
      enabled: false,
      hourlyNightPhotoEnabled: false,
      hourlyIntervalMinutes: 60,
      nightWindowStart: "20:00",
      nightWindowEnd: "06:00",
      photoRequiredForPatrol: true,
    });
  });

  it("calculates hourly night proof due state for overnight duty", () => {
    const settings = resolvePatrolSettings({
      enabled: true,
      hourlyNightPhotoEnabled: true,
    });

    const state = computeHourlyNightPatrolState({
      settings,
      checkedInAt: new Date("2026-05-07T14:30:00.000Z"), // 20:00 IST
      lastHourlyActivityAt: null,
      shift: {
        code: "night",
        label: "Night Shift",
        startTime: "20:00",
        endTime: "08:00",
        crossesMidnight: true,
      },
      now: new Date("2026-05-07T15:31:00.000Z"), // 21:01 IST
    });

    expect(state.enabled).toBe(true);
    expect(state.dueNow).toBe(true);
    expect(state.overdueMinutes).toBe(1);
  });

  it("uses inclusive night-window start and exclusive end in IST", () => {
    const settings = resolvePatrolSettings({
      nightWindowStart: "20:00",
      nightWindowEnd: "06:00",
    });

    expect(isWithinNightWindow(new Date("2026-05-07T14:30:00.000Z"), settings)).toBe(true); // 20:00 IST
    expect(isWithinNightWindow(new Date("2026-05-07T14:29:00.000Z"), settings)).toBe(false); // 19:59 IST
    expect(isWithinNightWindow(new Date("2026-05-08T00:29:00.000Z"), settings)).toBe(true); // 05:59 IST
    expect(isWithinNightWindow(new Date("2026-05-08T00:30:00.000Z"), settings)).toBe(false); // 06:00 IST
  });

  it("uses the IST date and hour for activity hour buckets across midnight", () => {
    const payload = buildPatrolActivityPayload({
      type: "hourly_photo",
      clientId: "client",
      clientName: "Client",
      siteId: "site",
      siteName: "Site",
      district: "District",
      employeeId: "employee",
      employeeDocId: "employee-doc",
      guardName: "Guard",
      source: "test",
      activityAt: new Date("2026-05-07T18:45:00.000Z"), // 00:15 IST on May 8
    });

    expect(payload.activityDate).toBe("2026-05-08");
    expect(payload.hourBucketKey).toBe("2026-05-08-00");
  });

  it("normalizes only active patrol points", () => {
    expect(
      normalizePatrolPoints([
        { id: "a", name: "Main Gate", order: 2 },
        { id: "b", name: "Lobby", active: false, order: 1 },
      ]),
    ).toEqual([
      {
        id: "a",
        name: "Main Gate",
        description: undefined,
        active: true,
        requiresPhoto: true,
        order: 2,
      },
    ]);
  });
});
