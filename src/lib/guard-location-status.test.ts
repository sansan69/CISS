import { describe, expect, it } from "vitest";

import {
  getGuardLocationHealth,
  guardLocationHealthLabel,
} from "@/lib/guard-location-status";
import type { GuardLocation } from "@/types/guard-location";

function location(
  updatedAt: Date | null,
  overrides: Partial<GuardLocation> = {},
): GuardLocation {
  return {
    employeeDocId: "employee-1",
    employeeId: "CISS/001",
    guardName: "Test Guard",
    siteId: "site-1",
    siteName: "Test Site",
    clientName: "Test Client",
    district: "Ernakulam",
    lat: 10,
    lng: 76,
    accuracy: 10,
    isOutOfZone: false,
    status: "In",
    updatedAt: updatedAt
      ? ({ toDate: () => updatedAt } as GuardLocation["updatedAt"])
      : null,
    ...overrides,
  };
}

describe("guard location display health", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");

  it("treats a missing timestamp as stale instead of fresh", () => {
    expect(getGuardLocationHealth(location(null), now)).toBe("stale");
  });

  it("prioritizes stale data over an old out-of-zone flag", () => {
    expect(
      getGuardLocationHealth(
        location(new Date("2026-07-27T11:40:00.000Z"), {
          isOutOfZone: true,
        }),
        now,
      ),
    ).toBe("stale");
  });

  it("distinguishes live, weak GPS, out-of-zone, and delayed updates", () => {
    const recent = new Date("2026-07-27T11:59:00.000Z");
    expect(getGuardLocationHealth(location(recent), now)).toBe("live");
    expect(
      getGuardLocationHealth(
        location(recent, { zoneStatus: "poor_accuracy", gpsReliable: false }),
        now,
      ),
    ).toBe("poor_accuracy");
    expect(
      getGuardLocationHealth(
        location(recent, { zoneStatus: "out_of_zone", isOutOfZone: true }),
        now,
      ),
    ).toBe("out_of_zone");
    expect(
      guardLocationHealthLabel(
        getGuardLocationHealth(
          location(new Date("2026-07-27T11:53:00.000Z")),
          now,
        ),
      ),
    ).toBe("Update delayed");
  });
});
