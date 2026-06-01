import { describe, expect, it } from "vitest";

import { attendanceSubmissionSchema } from "./attendance";

describe("attendanceSubmissionSchema", () => {
  it("accepts null for mobile optional string fields by treating them as omitted", () => {
    const parsed = attendanceSubmissionSchema.parse({
      employeeId: "CISS/ACME/001",
      employeeName: "Test Guard",
      employeeDocId: "emp-1",
      reportedAtClient: null,
      employeePhoneNumber: null,
      employeeClientName: null,
      status: "Out",
      district: "Ernakulam",
      siteId: "site-1",
      siteName: "Main Site",
      dutyPointId: null,
      dutyPointName: null,
      clientName: null,
      shiftCode: null,
      shiftLabel: null,
      shiftStartTime: null,
      shiftEndTime: null,
      nextShiftCode: null,
      nextShiftStartsAt: null,
      siteCoords: { lat: 9.98, lng: 76.28 },
      locationText: "GPS 9.98000, 76.28000",
      locationCoords: { lat: 9.98, lon: 76.28, accuracyMeters: 8 },
      distanceMeters: 12,
      gpsAccuracyMeters: 8,
      locationAccuracyMeters: 8,
      geofenceRadiusAtTime: 150,
      sourceCollection: "sites",
      photoUrl: "https://example.com/photo.jpg",
      photoCapturedAt: null,
      deviceInfo: { userAgent: "flutter-mobile" },
      clientRequestId: null,
      overrideReason: null,
      qrToken: null,
    });

    expect(parsed).toMatchObject({
      employeeId: "CISS/ACME/001",
      status: "Out",
      siteId: "site-1",
    });
    expect(parsed.dutyPointId).toBeUndefined();
    expect(parsed.clientRequestId).toBeUndefined();
  });
});
