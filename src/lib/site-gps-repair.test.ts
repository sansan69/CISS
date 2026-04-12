import { describe, expect, it } from "vitest";

import {
  classifySiteGpsState,
  extractSiteCoordinates,
  normalizeIndianStateName,
} from "./site-gps-repair";

describe("extractSiteCoordinates", () => {
  it("reads Firestore GeoPoint-like coordinates", () => {
    expect(
      extractSiteCoordinates({
        geolocation: { _latitude: 10.12, _longitude: 76.34 },
      }),
    ).toEqual({ lat: 10.12, lng: 76.34 });
  });

  it("falls back to latString/lngString", () => {
    expect(
      extractSiteCoordinates({
        latString: "11.12345",
        lngString: "77.54321",
      }),
    ).toEqual({ lat: 11.12345, lng: 77.54321 });
  });
});

describe("normalizeIndianStateName", () => {
  it("fixes the common Tamill Nadu typo", () => {
    expect(normalizeIndianStateName("Tamill Nadu")).toBe("Tamil Nadu");
  });
});

describe("classifySiteGpsState", () => {
  it("marks sites with no coordinates as missing_coords", () => {
    expect(classifySiteGpsState({ coordinateStatus: "" })).toBe("missing_coords");
  });

  it("marks valid coordinates without status as missing_status", () => {
    expect(
      classifySiteGpsState({
        geolocation: { _latitude: 10.0098, _longitude: 76.3599 },
      }),
    ).toBe("missing_status");
  });

  it("marks out-of-india coordinates as invalid_coords", () => {
    expect(
      classifySiteGpsState({
        geolocation: { _latitude: 9.54362, _longitude: 138.16936 },
      }),
    ).toBe("invalid_coords");
  });

  it("keeps properly classified sites as ok", () => {
    expect(
      classifySiteGpsState({
        coordinateStatus: "geocoded",
        geolocation: { _latitude: 10.0098, _longitude: 76.3599 },
      }),
    ).toBe("ok");
  });
});
