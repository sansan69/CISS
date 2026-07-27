import { describe, expect, it } from "vitest";

import {
  buildLocationHistoryBucketId,
  buildLocationHistoryExpiry,
  isValidLatitude,
  isValidLongitude,
  resolveLiveLocation,
} from "@/lib/guard-tracking";

describe("guard live tracking", () => {
  it("validates geographical coordinate ranges", () => {
    expect(isValidLatitude(10.5)).toBe(true);
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLongitude(76.5)).toBe(true);
    expect(isValidLongitude(-181)).toBe(false);
  });

  it("computes distance on the server and identifies an out-of-zone guard", () => {
    const result = resolveLiveLocation({
      guardLat: 10.01,
      guardLng: 76,
      accuracyMeters: 12,
      siteLat: 10,
      siteLng: 76,
      geofenceRadiusMeters: 150,
    });

    expect(result.distanceFromSite).toBeGreaterThan(1_000);
    expect(result.zoneStatus).toBe("out_of_zone");
    expect(result.isOutOfZone).toBe(true);
  });

  it("does not make a geofence accusation from an unreliable GPS fix", () => {
    const result = resolveLiveLocation({
      guardLat: 10.01,
      guardLng: 76,
      accuracyMeters: 400,
      siteLat: 10,
      siteLng: 76,
      geofenceRadiusMeters: 150,
    });

    expect(result.zoneStatus).toBe("poor_accuracy");
    expect(result.isOutOfZone).toBe(false);
  });

  it("deduplicates history within a five-minute bucket and expires it", () => {
    const first = new Date("2026-07-27T10:01:00.000Z");
    const second = new Date("2026-07-27T10:04:59.000Z");

    expect(buildLocationHistoryBucketId("session-1", first)).toBe(
      buildLocationHistoryBucketId("session-1", second),
    );
    expect(buildLocationHistoryExpiry(first).toISOString()).toBe(
      "2026-08-26T10:01:00.000Z",
    );
  });
});
