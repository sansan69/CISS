import { describe, expect, it } from "vitest";
import { buildSiteLocationSyncPatch } from "./location-utils";

describe("buildSiteLocationSyncPatch", () => {
  it("copies office location details into a site form payload", () => {
    const patch = buildSiteLocationSyncPatch({
      address: "Office Road",
      district: "Ernakulam",
      geolocation: { latitude: 10.123, longitude: 76.456 },
      latString: "10.123000",
      lngString: "76.456000",
      coordinateStatus: "verified",
      coordinateSource: "manual",
      placeAccuracy: "GPS accuracy ±10m",
    });

    expect(patch).toEqual({
      siteAddress: "Office Road",
      district: "Ernakulam",
      geolocation: { latitude: 10.123, longitude: 76.456 },
      latString: "10.123000",
      lngString: "76.456000",
      coordinateStatus: "verified",
      coordinateSource: "manual",
      placeAccuracy: "GPS accuracy ±10m",
    });
  });
});
