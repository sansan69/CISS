import { describe, expect, it } from "vitest";
import {
  buildPublicAttendanceEmployee,
  buildPublicAttendanceSiteOption,
  parsePublicAttendanceCoordinates,
} from "./public-attendance";

describe("parsePublicAttendanceCoordinates", () => {
  it("reads Firestore geopoint-style coordinates", () => {
    expect(
      parsePublicAttendanceCoordinates({
        geolocation: { latitude: 9.9312, longitude: 76.2673 },
      }),
    ).toEqual({ lat: 9.9312, lng: 76.2673 });
  });

  it("falls back to string coordinate fields", () => {
    expect(
      parsePublicAttendanceCoordinates({
        latString: "10.12",
        lngString: "76.55",
      }),
    ).toEqual({ lat: 10.12, lng: 76.55 });
  });

  it("returns undefined when coordinates are missing", () => {
    expect(parsePublicAttendanceCoordinates({ siteName: "Test" })).toBeUndefined();
  });
});

describe("buildPublicAttendanceSiteOption", () => {
  it("includes coordinates required for nearest-site detection", () => {
    expect(
      buildPublicAttendanceSiteOption(
        "site-1",
        {
          siteName: "Logiware",
          clientName: "Logiware",
          district: "Ernakulam",
          latString: "9.98",
          lngString: "76.28",
          geofenceRadiusMeters: 180,
          strictGeofence: true,
        },
        "sites",
      ),
    ).toMatchObject({
      id: "site-1",
      siteName: "Logiware",
      clientName: "Logiware",
      district: "Ernakulam",
      lat: 9.98,
      lng: 76.28,
      geofenceRadiusMeters: 180,
      strictGeofence: true,
      sourceCollection: "sites",
    });
  });
});

describe("buildPublicAttendanceEmployee", () => {
  it("maps employee lookup payload for manual and QR resolution", () => {
    expect(
      buildPublicAttendanceEmployee("doc-1", {
        employeeId: "CISS/TCS/2025-26/871",
        fullName: "GEETHU K",
        phoneNumber: "9048255377",
        clientName: "TCS",
      }),
    ).toEqual({
      id: "doc-1",
      employeeCode: "CISS/TCS/2025-26/871",
      fullName: "GEETHU K",
      phoneNumber: "9048255377",
      clientName: "TCS",
    });
  });
});
