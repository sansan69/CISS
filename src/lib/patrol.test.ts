import { describe, expect, it } from "vitest";

import {
  computeHourlyNightPatrolState,
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
