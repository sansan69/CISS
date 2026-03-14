import { NextRequest, NextResponse } from "next/server";
import { haversineDistanceMeters } from "@/lib/geo";
import {
  attendanceSubmissionSchema,
  type AttendanceSubmission,
} from "@/types/attendance";

export const runtime = "nodejs";

const INDIA_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
});

type FirestoreGeoPointLike = {
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
};

function parseSiteCoordinates(siteData: Record<string, any>) {
  const geolocation = siteData.geolocation as FirestoreGeoPointLike | undefined;
  const lat =
    typeof geolocation?.latitude === "number"
      ? geolocation.latitude
      : typeof geolocation?.lat === "number"
        ? geolocation.lat
        : Number(siteData.latString);
  const lng =
    typeof geolocation?.longitude === "number"
      ? geolocation.longitude
      : typeof geolocation?.lng === "number"
        ? geolocation.lng
        : Number(siteData.lngString);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function validateEmployee(
  payload: AttendanceSubmission,
  employeeData: Record<string, any>,
) {
  if (employeeData.employeeId !== payload.employeeId) {
    throw new Error("Employee ID mismatch.");
  }

  if (employeeData.status && employeeData.status !== "Active") {
    throw new Error("Attendance can only be recorded for active employees.");
  }

  if (
    payload.employeeClientName &&
    employeeData.clientName &&
    payload.employeeClientName !== employeeData.clientName
  ) {
    throw new Error("Employee client mismatch.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = attendanceSubmissionSchema.parse(await request.json());
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { Timestamp } = await import("firebase-admin/firestore");
    const now = Timestamp.now();
    const attendanceDate = INDIA_DATE_FORMATTER.format(new Date());
    const employeeRef = adminDb.collection("employees").doc(payload.employeeDocId);
    const siteRef = adminDb.collection("sites").doc(payload.siteId);
    const attendanceStateRef = adminDb
      .collection("attendanceState")
      .doc(payload.employeeDocId);
    const attendanceLogRef = adminDb.collection("attendanceLogs").doc();

    await adminDb.runTransaction(async (transaction) => {
      const [employeeSnap, siteSnap, stateSnap] = await Promise.all([
        transaction.get(employeeRef),
        transaction.get(siteRef),
        transaction.get(attendanceStateRef),
      ]);

      if (!employeeSnap.exists) {
        throw new Error("Employee not found.");
      }

      if (!siteSnap.exists) {
        throw new Error("Selected site not found.");
      }

      const employeeData = employeeSnap.data() as Record<string, any>;
      const siteData = siteSnap.data() as Record<string, any>;
      validateEmployee(payload, employeeData);

      if (siteData.district !== payload.district) {
        throw new Error("District mismatch for selected site.");
      }

      if (
        employeeData.clientName &&
        siteData.clientName &&
        employeeData.clientName !== siteData.clientName
      ) {
        throw new Error("Selected site does not belong to this employee's client.");
      }

      const siteCoords = parseSiteCoordinates(siteData);
      if (!siteCoords) {
        throw new Error("Selected site does not have valid coordinates configured.");
      }

      const actualDistance = haversineDistanceMeters(
        payload.locationCoords.lat,
        payload.locationCoords.lon,
        siteCoords.lat,
        siteCoords.lng,
      );

      if (actualDistance > 150) {
        throw new Error(
          `Attendance can only be recorded within 150 meters of the site. Current distance: ${Math.round(actualDistance)} meters.`,
        );
      }

      if (stateSnap.exists) {
        const lastState = stateSnap.data() as Record<string, any>;
        if (
          lastState.lastAttendanceDate === attendanceDate &&
          lastState.lastStatus === payload.status
        ) {
          throw new Error(
            `Duplicate ${payload.status.toLowerCase()} attendance is not allowed on the same day.`,
          );
        }
      }

      transaction.set(attendanceLogRef, {
        employeeId: payload.employeeId,
        employeeDocId: payload.employeeDocId,
        employeeName: payload.employeeName,
        status: payload.status,
        district: payload.district,
        siteId: payload.siteId,
        siteName: payload.siteName,
        clientName: siteData.clientName || payload.clientName || null,
        siteCoords,
        locationText: payload.locationText,
        locationCoords: payload.locationCoords,
        distanceMeters: Math.round(actualDistance),
        locationAccuracyMeters: payload.locationAccuracyMeters ?? null,
        photoUrl: payload.photoUrl,
        deviceInfo: payload.deviceInfo,
        attendanceDate,
        createdAt: now,
      });

      transaction.set(
        attendanceStateRef,
        {
          employeeDocId: payload.employeeDocId,
          employeeName: payload.employeeName,
          lastStatus: payload.status,
          lastSiteId: payload.siteId,
          lastAttendanceDate: attendanceDate,
          lastLoggedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
    });

    return NextResponse.json({
      success: true,
      id: attendanceLogRef.id,
    });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        {
          error: "Invalid attendance submission.",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }

    const status =
      typeof error?.message === "string" &&
      /not found|mismatch|invalid|Duplicate|within 150 meters|active employees/i.test(
        error.message,
      )
        ? 400
        : 500;

    console.error("Attendance submit failed:", error);
    return NextResponse.json(
      { error: error?.message || "Could not submit attendance." },
      { status },
    );
  }
}
