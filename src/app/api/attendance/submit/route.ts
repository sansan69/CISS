import { NextRequest, NextResponse } from "next/server";
import { haversineDistanceMeters } from "@/lib/geo";
import {
  getNextShift,
  resolveShiftByCode,
  resolveSiteDutyPoints,
  resolveSiteShift,
} from "@/lib/shift-utils";
import {
  DEFAULT_GEOFENCE_RADIUS_METERS,
  DEFAULT_GPS_ACCURACY_LIMIT_METERS,
  OFFLINE_ATTENDANCE_MAX_AGE_HOURS,
  OPERATIONAL_CLIENT_NAME,
} from "@/lib/constants";
import { districtMatches, normalizeDistrictName } from "@/lib/districts";
import {
  attendanceSubmissionSchema,
  type AttendanceSubmission,
  type AttendancePhotoCompliance,
} from "@/types/attendance";
import type { ShiftTemplate, SiteShiftMode } from "@/types/location";
import { buildServerAuditEvent } from "@/lib/server/audit";
import {
  SYSTEM_METRIC_NAMES,
  incrementSystemMetric,
} from "@/lib/server/monitoring";
import { canRecordNextDayCheckout } from "@/lib/attendance/attendance-validation";
import { isAssignedGuardMatch } from "../../../../lib/work-orders/assignment-match";

export const runtime = "nodejs";

/** Business-logic errors that should return HTTP 400 (not 500). */
class AttendanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceError";
  }
}

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
    throw new AttendanceError("Employee ID mismatch.");
  }

  if (employeeData.status && employeeData.status !== "Active") {
    throw new AttendanceError("Attendance can only be recorded for active employees.");
  }

  if (
    payload.employeeClientName &&
    employeeData.clientName &&
    payload.employeeClientName !== employeeData.clientName
  ) {
    throw new AttendanceError("Employee client mismatch.");
  }
}

function getAllowedRadiusMeters(siteData: Record<string, any>) {
  const siteRadius = Number(
    siteData.geofenceRadiusMeters ?? siteData.allowedRadiusMeters,
  );
  if (Number.isFinite(siteRadius) && siteRadius > 0) {
    return siteRadius;
  }

  const defaultRadius = Number(
    process.env.DEFAULT_GEOFENCE_RADIUS_METERS || DEFAULT_GEOFENCE_RADIUS_METERS,
  );
  return Number.isFinite(defaultRadius) && defaultRadius > 0
    ? defaultRadius
    : DEFAULT_GEOFENCE_RADIUS_METERS;
}

function getGpsAccuracyLimitMeters() {
  const limit = Number(
    process.env.DEFAULT_GPS_ACCURACY_LIMIT_METERS || DEFAULT_GPS_ACCURACY_LIMIT_METERS,
  );
  return Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_GPS_ACCURACY_LIMIT_METERS;
}

function mergePhotoCompliance(
  existing: AttendancePhotoCompliance | undefined,
  warning: string,
) {
  const warnings = existing?.warnings ?? [];
  return {
    overallStatus: "warning" as const,
    adminFlag: true,
    warnings: warnings.includes(warning) ? warnings : [...warnings, warning],
    summary:
      existing?.summary && existing.overallStatus !== "clear"
        ? existing.summary
        : warning,
    missingShoes: existing?.missingShoes ?? false,
    missingIdCard: existing?.missingIdCard ?? false,
    uniformIssue: existing?.uniformIssue ?? false,
    fullBodyVisible: existing?.fullBodyVisible ?? false,
    onePersonVisible: existing?.onePersonVisible ?? true,
  };
}

function isActiveWorkOrderRecord(workOrder: Record<string, any>) {
  return String(workOrder.recordStatus ?? "active").trim().toLowerCase() === "active";
}

export async function POST(request: NextRequest) {
  try {
    const payload = attendanceSubmissionSchema.parse(await request.json());
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { Timestamp } = await import("firebase-admin/firestore");
    const now = Timestamp.now();
    const serverNow = now.toDate();
    const reportedAt = payload.reportedAtClient
      ? Timestamp.fromDate(new Date(payload.reportedAtClient))
      : now;
    const reportedAtDate = reportedAt.toDate();
    const oldestAllowedMs =
      OFFLINE_ATTENDANCE_MAX_AGE_HOURS * 60 * 60 * 1000;
    if (Date.now() - reportedAtDate.getTime() > oldestAllowedMs) {
      throw new AttendanceError(
        `Queued attendance older than ${OFFLINE_ATTENDANCE_MAX_AGE_HOURS} hours cannot be submitted. Please record attendance again.`,
      );
    }
    const attendanceDate = INDIA_DATE_FORMATTER.format(serverNow);
    const clockDriftMs = Math.abs(serverNow.getTime() - reportedAtDate.getTime());
    const clockDriftMinutes = Math.round(clockDriftMs / 60000);
    const clockDriftWarning =
      clockDriftMinutes > 120
        ? `Device clock appears off by ${clockDriftMinutes} minutes compared to server time. Attendance was recorded using server time.`
        : null;
    const employeeRef = adminDb.collection("employees").doc(payload.employeeDocId);
    const sourceCol = payload.sourceCollection === 'clientLocations' ? 'clientLocations' : 'sites';
    const siteRef = adminDb.collection(sourceCol).doc(payload.siteId);
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
        throw new AttendanceError("Employee not found.");
      }

      if (!siteSnap.exists) {
        throw new AttendanceError("Selected site not found.");
      }

      const employeeData = employeeSnap.data() as Record<string, any>;
      const siteData = siteSnap.data() as Record<string, any>;
      validateEmployee(payload, employeeData);

      if (!districtMatches(siteData.district, payload.district)) {
        throw new AttendanceError("District mismatch for selected site.");
      }

      if (
        employeeData.clientName &&
        siteData.clientName &&
        employeeData.clientName !== siteData.clientName
      ) {
        throw new AttendanceError("Selected site does not belong to this employee's client.");
      }

      const siteCoords = parseSiteCoordinates(siteData);
      if (!siteCoords) {
        throw new AttendanceError("Selected site does not have valid coordinates configured.");
      }

      const isTcsSite =
        String(siteData.clientName || "").trim().toLowerCase() ===
        OPERATIONAL_CLIENT_NAME.toLowerCase();
      const configuredDutyPoints =
        sourceCol === "sites" ? resolveSiteDutyPoints(siteData as any) : [];
      const selectedDutyPoint =
        configuredDutyPoints.find((point) => point.id === payload.dutyPointId) ??
        configuredDutyPoints.find((point) => point.name === payload.dutyPointName) ??
        (configuredDutyPoints.length === 1 ? configuredDutyPoints[0] : null);

      if (!isTcsSite && configuredDutyPoints.length > 0 && !selectedDutyPoint) {
        throw new AttendanceError("Select a valid duty point for this site.");
      }

      const activeShiftSource: {
        shiftMode: SiteShiftMode;
        shiftTemplates: ShiftTemplate[];
      } = selectedDutyPoint
        ? {
            shiftMode: selectedDutyPoint.shiftMode,
            shiftTemplates: selectedDutyPoint.shiftTemplates,
          }
        : {
            shiftMode: siteData.shiftMode === "fixed" ? "fixed" : "none",
            shiftTemplates: Array.isArray(siteData.shiftTemplates)
              ? (siteData.shiftTemplates as ShiftTemplate[])
              : [],
          };
      const resolvedShift = resolveSiteShift(
        activeShiftSource.shiftMode,
        activeShiftSource.shiftTemplates,
        reportedAtDate,
      );
      const selectedShift = resolveShiftByCode(
        activeShiftSource.shiftMode,
        activeShiftSource.shiftTemplates,
        payload.shiftCode,
      );
      const effectiveShift = selectedShift ?? resolvedShift;
      const nextShift = getNextShift(
        activeShiftSource.shiftMode,
        activeShiftSource.shiftTemplates,
        effectiveShift?.code,
      );

      if (isTcsSite) {
        const startOfDay = new Date(`${attendanceDate}T00:00:00+05:30`);
        const endOfDay = new Date(`${attendanceDate}T23:59:59.999+05:30`);
        const workOrdersSnapshot = await adminDb
          .collection("workOrders")
          .where("siteId", "==", payload.siteId)
          .where("date", ">=", startOfDay)
          .where("date", "<=", endOfDay)
          .get();

        const activeWorkOrders = workOrdersSnapshot.docs
          .map((doc) => doc.data() as Record<string, any>)
          .filter(isActiveWorkOrderRecord);

        if (activeWorkOrders.length === 0) {
          throw new AttendanceError("No active work order exists for the selected site today.");
        }

        const matchingWorkOrder = activeWorkOrders
          .find((workOrder) => {
            const assignedGuards = Array.isArray(workOrder.assignedGuards)
              ? workOrder.assignedGuards
              : [];
            return (
              assignedGuards.length === 0 ||
              isAssignedGuardMatch(
                assignedGuards,
                payload.employeeDocId,
                payload.employeeId,
              )
            );
          });

        if (!matchingWorkOrder) {
          throw new AttendanceError(
            "This employee is not assigned to the selected site for today's work order.",
          );
        }
      } else {
        if (activeShiftSource.shiftMode === "fixed" && !effectiveShift) {
          throw new AttendanceError(
            selectedDutyPoint
              ? `Select a valid shift configured for duty point "${selectedDutyPoint.name}".`
              : "Select a valid shift configured for this site before submitting attendance.",
          );
        }
      }

      const actualDistance = haversineDistanceMeters(
        payload.locationCoords.lat,
        payload.locationCoords.lon,
        siteCoords.lat,
        siteCoords.lng,
      );

      const allowedRadiusMeters = getAllowedRadiusMeters(siteData);
      const effectiveRadiusMeters =
        selectedDutyPoint?.geofenceRadiusMeters ?? allowedRadiusMeters;
      const siteIsStrictGeofence = siteData.strictGeofence !== false;
      const gpsAccuracyMeters =
        payload.gpsAccuracyMeters ??
        payload.locationAccuracyMeters ??
        payload.locationCoords.accuracyMeters ??
        null;
      const gpsAccuracyLimitMeters = getGpsAccuracyLimitMeters();

      if (
        typeof gpsAccuracyMeters === "number" &&
        Number.isFinite(gpsAccuracyMeters) &&
        gpsAccuracyMeters > gpsAccuracyLimitMeters
      ) {
        throw new AttendanceError(
          `GPS accuracy is too weak (±${Math.round(gpsAccuracyMeters)}m). Please move outdoors or wait for a better fix before submitting attendance.`,
        );
      }

      if (actualDistance > effectiveRadiusMeters && siteIsStrictGeofence) {
        throw new AttendanceError(
          `Attendance can only be recorded within ${effectiveRadiusMeters} meters of the site. Current distance: ${Math.round(actualDistance)} meters.`,
        );
      }

      if (stateSnap.exists) {
        const lastState = stateSnap.data() as Record<string, any>;
        if (
          lastState.lastAttendanceDate === attendanceDate &&
          lastState.lastStatus === payload.status
        ) {
          throw new AttendanceError(
            `Duplicate ${payload.status.toLowerCase()} attendance is not allowed on the same day.`,
          );
        }

        if (
          lastState.lastAttendanceDate === attendanceDate &&
          lastState.lastStatus === "Out" &&
          payload.status === "In"
        ) {
          throw new AttendanceError(
            "Attendance IN is already closed for today. Please contact admin if this is incorrect.",
          );
        }

        if (
          lastState.lastAttendanceDate !== attendanceDate &&
          payload.status === "Out"
        ) {
          const overnightCheckoutAllowed = canRecordNextDayCheckout({
            attendanceDate,
            status: payload.status,
            siteId: payload.siteId,
            dutyPointId: selectedDutyPoint?.id ?? payload.dutyPointId ?? null,
            shift: effectiveShift,
            lastState,
          });

          if (!overnightCheckoutAllowed) {
            throw new AttendanceError(
              "Attendance OUT is only allowed after a valid IN mark on the same day, unless the guard is closing an overnight shift the next morning.",
            );
          }
        }

        if (
          lastState.lastAttendanceDate === attendanceDate &&
          lastState.lastStatus !== "In" &&
          payload.status === "Out"
        ) {
          throw new AttendanceError(
            "Attendance OUT is only allowed after a valid IN mark on the same day.",
          );
        }
      }

      const isMockLocationSuspected =
        payload.isMockLocationSuspected === true ||
        (typeof payload.mockLocationReason === "string" &&
          payload.mockLocationReason.trim().length > 0);
      const locationReviewWarning =
        actualDistance > effectiveRadiusMeters && !siteIsStrictGeofence
          ? `Location is ${Math.round(actualDistance)}m away from the configured site radius of ${effectiveRadiusMeters}m.`
          : isMockLocationSuspected
            ? payload.mockLocationReason?.trim() ||
              "Location looks suspicious and requires admin review."
            : null;

      transaction.set(attendanceLogRef, {
        employeeId: payload.employeeId,
        employeeDocId: payload.employeeDocId,
        employeeName: payload.employeeName,
        employeePhoneNumber: payload.employeePhoneNumber ?? null,
        reportedAtClient: payload.reportedAtClient ?? null,
        reportedAt,
        serverProcessedAt: now,
        clockDriftMinutes,
        clockDriftWarning,
        status: payload.status,
        district: normalizeDistrictName(payload.district),
        siteId: payload.siteId,
        siteName: payload.siteName,
        dutyPointId: selectedDutyPoint?.id ?? payload.dutyPointId ?? null,
        dutyPointName: selectedDutyPoint?.name ?? payload.dutyPointName ?? null,
        clientName: siteData.clientName || payload.clientName || null,
        sourceCollection: sourceCol,
        shiftCode: effectiveShift?.code ?? payload.shiftCode ?? null,
        shiftLabel: effectiveShift?.label ?? payload.shiftLabel ?? null,
        shiftStartTime: effectiveShift?.startTime ?? payload.shiftStartTime ?? null,
        shiftEndTime: effectiveShift?.endTime ?? payload.shiftEndTime ?? null,
        nextShiftCode: payload.nextShiftCode ?? nextShift?.code ?? null,
        nextShiftStartsAt: payload.nextShiftStartsAt ?? nextShift?.startTime ?? null,
        siteCoords,
        locationText: payload.locationText,
        locationCoords: payload.locationCoords,
        distanceMeters: Math.round(actualDistance),
        gpsAccuracyMeters:
          typeof gpsAccuracyMeters === "number" ? Math.round(gpsAccuracyMeters) : null,
        locationAccuracyMeters: payload.locationAccuracyMeters ?? null,
        geofenceRadiusAtTime: effectiveRadiusMeters,
        strictGeofence: siteIsStrictGeofence,
        isMockLocationSuspected,
        mockLocationReason: payload.mockLocationReason ?? null,
        requiresLocationReview: Boolean(locationReviewWarning),
        requiresAdminReview:
          Boolean(locationReviewWarning) ||
          Boolean(clockDriftWarning) ||
          isMockLocationSuspected ||
          (typeof payload.photoCompliance?.adminFlag === "boolean" && payload.photoCompliance.adminFlag),
        photoUrl: payload.photoUrl,
        photoCapturedAt: payload.photoCapturedAt ?? null,
        photoCompliance: locationReviewWarning
          ? mergePhotoCompliance(payload.photoCompliance, locationReviewWarning)
          : payload.photoCompliance ?? null,
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
          lastDutyPointId: selectedDutyPoint?.id ?? payload.dutyPointId ?? null,
          lastShiftCode: effectiveShift?.code ?? payload.shiftCode ?? null,
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
    const status = error instanceof AttendanceError ? 400 : 500;

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
