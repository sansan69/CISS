import { NextRequest, NextResponse } from "next/server";
import { haversineDistanceMeters } from "@/lib/geo";
import {
  attendanceSubmissionSchema,
  type AttendanceSubmission,
} from "@/types/attendance";
import { buildServerAuditEvent } from "@/lib/server/audit";
import {
  SYSTEM_METRIC_NAMES,
  incrementSystemMetric,
} from "@/lib/server/monitoring";

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

function getAllowedRadiusMeters(siteData: Record<string, any>) {
  const siteRadius = Number(
    siteData.geofenceRadiusMeters ?? siteData.allowedRadiusMeters,
  );
  if (Number.isFinite(siteRadius) && siteRadius > 0) {
    return siteRadius;
  }

  const defaultRadius = Number(process.env.DEFAULT_GEOFENCE_RADIUS_METERS || 150);
  return Number.isFinite(defaultRadius) && defaultRadius > 0 ? defaultRadius : 150;
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

      const startOfDay = new Date(`${attendanceDate}T00:00:00+05:30`);
      const endOfDay = new Date(`${attendanceDate}T23:59:59.999+05:30`);
      const workOrdersSnapshot = await adminDb
        .collection("workOrders")
        .where("siteId", "==", payload.siteId)
        .where("date", ">=", startOfDay)
        .where("date", "<=", endOfDay)
        .limit(5)
        .get();

      if (workOrdersSnapshot.empty) {
        throw new Error("No active work order exists for the selected site today.");
      }

      const matchingWorkOrder = workOrdersSnapshot.docs
        .map((doc) => doc.data() as Record<string, any>)
        .find((workOrder) => {
          const assignedGuards = Array.isArray(workOrder.assignedGuards)
            ? workOrder.assignedGuards
            : [];
          return (
            assignedGuards.length === 0 ||
            assignedGuards.some((guard) => guard?.uid === payload.employeeDocId)
          );
        });

      if (!matchingWorkOrder) {
        throw new Error(
          "This employee is not assigned to the selected site for today's work order.",
        );
      }

      const actualDistance = haversineDistanceMeters(
        payload.locationCoords.lat,
        payload.locationCoords.lon,
        siteCoords.lat,
        siteCoords.lng,
      );

      const allowedRadiusMeters = getAllowedRadiusMeters(siteData);
      if (actualDistance > allowedRadiusMeters) {
        throw new Error(
          `Attendance can only be recorded within ${allowedRadiusMeters} meters of the site. Current distance: ${Math.round(actualDistance)} meters.`,
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

        if (
          lastState.lastAttendanceDate === attendanceDate &&
          lastState.lastStatus === "Out" &&
          payload.status === "In"
        ) {
          throw new Error(
            "Attendance IN is already closed for today. Please contact admin if this is incorrect.",
          );
        }

        if (
          lastState.lastAttendanceDate !== attendanceDate &&
          payload.status === "Out"
        ) {
          throw new Error(
            "Attendance OUT is only allowed after a valid IN mark on the same day.",
          );
        }

        if (
          lastState.lastAttendanceDate === attendanceDate &&
          lastState.lastStatus !== "In" &&
          payload.status === "Out"
        ) {
          throw new Error(
            "Attendance OUT is only allowed after a valid IN mark on the same day.",
          );
        }
      }

      transaction.set(attendanceLogRef, {
        employeeId: payload.employeeId,
        employeeDocId: payload.employeeDocId,
        employeeName: payload.employeeName,
        reportedAtClient: payload.reportedAtClient ?? null,
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
        photoCapturedAt: payload.photoCapturedAt ?? null,
        photoCompliance: payload.photoCompliance ?? null,
        deviceInfo: payload.deviceInfo,
        attendanceDate,
        createdAt: now,
        auditTrail: [
          buildServerAuditEvent("attendance_submitted", undefined, {
            employeeDocId: payload.employeeDocId,
            siteId: payload.siteId,
            status: payload.status,
          }),
        ],
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

    await incrementSystemMetric(SYSTEM_METRIC_NAMES.attendanceSubmitSuccess);

    return NextResponse.json({
      success: true,
      id: attendanceLogRef.id,
    });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      await incrementSystemMetric(SYSTEM_METRIC_NAMES.attendanceSubmitFailure);
      return NextResponse.json(
        {
          error: "Invalid attendance submission.",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }

    await incrementSystemMetric(SYSTEM_METRIC_NAMES.attendanceSubmitFailure);
    const status =
      typeof error?.message === "string" &&
      /not found|mismatch|invalid|Duplicate|within .* meters|active employees|assigned|work order|OUT is only allowed|closed for today/i.test(
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

export async function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}
