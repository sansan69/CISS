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
  normalizeClientNameKey,
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
import {
  canRecordNextDayCheckout,
  resolveAttendanceSubmissionWindow,
} from "@/lib/attendance/attendance-validation";
import { isAssignedGuardMatch } from "../../../../lib/work-orders/assignment-match";
import type { AppDecodedToken } from "@/lib/server/auth";
import {
  checkRateLimit,
  buildRateLimitKey,
  getClientIp,
} from "@/lib/server/rate-limit";
import { verifyQrToken } from "@/lib/qr/qr-token";

export const runtime = "nodejs";

// Firestore-based distributed rate limiting config
const RATE_LIMIT_CONFIG = {
  authenticated: { maxRequests: 30, windowMs: 60_000 },
  anonymous: { maxRequests: 5, windowMs: 60_000 },
  upload: { maxRequests: 10, windowMs: 60_000 },
};

/**
 * Verify the caller's identity when a Bearer token is present.
 * Returns the decoded token if authenticated, or null if no token.
 * Throws if the token is present but invalid.
 */
async function tryVerifyAuth(
  request: NextRequest,
): Promise<AppDecodedToken | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  const { verifyRequestAuth } = await import("@/lib/server/auth");
  return verifyRequestAuth(request);
}

/**
 * Verify that the authenticated caller owns the employeeDocId they are
 * submitting attendance for. Prevents one guard from submitting for another.
 */
async function verifyCallerOwnership(
  decoded: AppDecodedToken,
  employeeDocId: string,
): Promise<void> {
  if (decoded.employeeDocId && decoded.employeeDocId === employeeDocId) {
    return;
  }

  const { db: adminDb } = await import("@/lib/firebaseAdmin");
  const employeeSnap = await adminDb
    .collection("employees")
    .doc(employeeDocId)
    .get();

  if (!employeeSnap.exists) {
    throw new AttendanceError("Employee not found.");
  }

  const employeeData = employeeSnap.data() as Record<string, any>;
  if (employeeData.guardAuthUid === decoded.uid) {
    return;
  }

  throw new AttendanceError(
    "You can only submit attendance for your own account.",
  );
}

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

type GuardLocationWrite = {
  employeeId: string;
  guardName: string;
  siteId: string;
  siteName: string;
  clientName: string;
  employeeClientName: string | null;
  siteClientName: string | null;
  crossClientRelief: boolean;
  district: string;
  lat: number;
  lng: number;
  accuracy: number;
  isOutOfZone: boolean;
  status: "In" | "Out";
  siteLat: number | null;
  siteLng: number | null;
  geofenceRadius: number;
  attendanceId: string;
};

function parseSiteCoordinates(siteData: Record<string, any>) {
  const geolocation = siteData.geolocation as FirestoreGeoPointLike | undefined;
  const lat =
    typeof geolocation?.latitude === "number"
      ? geolocation.latitude
      : typeof geolocation?.lat === "number"
        ? geolocation.lat
        : typeof siteData.lat === "number"
          ? siteData.lat
          : Number(siteData.latString);
  const lng =
    typeof geolocation?.longitude === "number"
      ? geolocation.longitude
      : typeof geolocation?.lng === "number"
        ? geolocation.lng
        : typeof siteData.lng === "number"
          ? siteData.lng
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
    throw new AttendanceError("Employee verification failed. Please contact your supervisor.");
  }

  if (employeeData.status && employeeData.status !== "Active") {
    throw new AttendanceError("Your account is currently inactive. Please contact your supervisor.");
  }

  if (
    payload.employeeClientName &&
    employeeData.clientName &&
    normalizeClientNameKey(payload.employeeClientName) !==
      normalizeClientNameKey(employeeData.clientName)
  ) {
    throw new AttendanceError("Employee verification failed. Please contact your supervisor.");
  }
}

function normalizeNullableText(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

function isCrossClientRelief(
  employeeClientName: string | null,
  siteClientName: string | null,
) {
  return Boolean(
    employeeClientName &&
      siteClientName &&
      normalizeClientNameKey(employeeClientName) !== normalizeClientNameKey(siteClientName),
  );
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

function buildGuardName(employeeData: Record<string, any>, fallbackEmployeeId: string) {
  return String(
    employeeData.fullName ||
      employeeData.name ||
      [employeeData.firstName, employeeData.lastName].filter(Boolean).join(" ") ||
      fallbackEmployeeId,
  ).trim();
}

/**
 * Check for duplicate submission using clientRequestId.
 * Returns the existing log if found, null otherwise.
 */
async function findDuplicateSubmission(
  adminDb: FirebaseFirestore.Firestore,
  clientRequestId: string,
  employeeDocId: string,
): Promise<{ id: string; attendanceDate: string; status: string } | null> {
  if (!clientRequestId) return null;

  const snap = await adminDb
    .collection("attendanceLogs")
    .where("employeeDocId", "==", employeeDocId)
    .where("processedClientRequestId", "==", clientRequestId)
    .limit(1)
    .get();

  if (snap.empty) return null;

  const doc = snap.docs[0];
  const data = doc.data() as Record<string, any>;
  return {
    id: doc.id,
    attendanceDate: data.attendanceDate ?? "",
    status: data.status ?? "In",
  };
}

export async function POST(request: NextRequest) {
  try {
    // ── 1. Rate limiting (Firestore-based, distributed) ─────────────────
    const ip = getClientIp(request);
    const decoded = await tryVerifyAuth(request);
    const isAuthenticated = decoded !== null;
    const rateLimitConfig = isAuthenticated
      ? RATE_LIMIT_CONFIG.authenticated
      : RATE_LIMIT_CONFIG.anonymous;
    const rateLimitKey = buildRateLimitKey(
      "attendance-submit",
      isAuthenticated ? decoded.uid : ip,
    );
    const rateLimit = await checkRateLimit(rateLimitKey, rateLimitConfig);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitConfig.windowMs / 1000)) } },
      );
    }

    const payload = attendanceSubmissionSchema.parse(await request.json());

    // ── 2. Ownership check ────────────────────────────────────────────────
    if (isAuthenticated) {
      await verifyCallerOwnership(decoded, payload.employeeDocId);
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue, Timestamp } = await import("firebase-admin/firestore");
    const now = Timestamp.now();
    const serverNow = now.toDate();

    // ── 3. Idempotency check ──────────────────────────────────────────────
    if (payload.clientRequestId) {
      const duplicate = await findDuplicateSubmission(
        adminDb,
        payload.clientRequestId,
        payload.employeeDocId,
      );
      if (duplicate) {
        return NextResponse.json({
          success: true,
          id: duplicate.id,
          duplicate: true,
          message: "Attendance already recorded for this request.",
        });
      }
    }

    // ── 4. QR token validation (if provided) ──────────────────────────────
    if (payload.qrToken && payload.employeePhoneNumber) {
      const tokenValid = await verifyQrToken(
        payload.employeeId,
        payload.employeePhoneNumber,
        payload.qrToken,
      );
      if (!tokenValid) {
        throw new AttendanceError("Invalid QR code. The code may be tampered with or expired.");
      }
    }

    const reportedAt = payload.reportedAtClient
      ? Timestamp.fromDate(new Date(payload.reportedAtClient))
      : now;
    const reportedAtDate = reportedAt.toDate();
    const oldestAllowedMs =
      OFFLINE_ATTENDANCE_MAX_AGE_HOURS * 60 * 60 * 1000;
    if (Date.now() - reportedAtDate.getTime() > oldestAllowedMs) {
      throw new AttendanceError(
        `Queued attendance older than ${OFFLINE_ATTENDANCE_MAX_AGE_HOURS} hours cannot be submitted. Please record a fresh attendance entry.`,
      );
    }
    const submittedAttendanceDate = INDIA_DATE_FORMATTER.format(reportedAtDate);
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
    let guardLocationWrite: GuardLocationWrite | null = null;
    let staleOutAutoCloseResult: { id: string; staleDate: string } | null = null;

    await adminDb.runTransaction(async (transaction) => {
      const [employeeSnap, siteSnap, stateSnap] = await Promise.all([
        transaction.get(employeeRef),
        transaction.get(siteRef),
        transaction.get(attendanceStateRef),
      ]);

      if (!employeeSnap.exists) {
        throw new AttendanceError("Employee record not found. Please verify your ID and try again.");
      }

      if (!siteSnap.exists) {
        throw new AttendanceError("The selected site is no longer available. Please select a different site.");
      }

      const employeeData = employeeSnap.data() as Record<string, any>;
      const siteData = siteSnap.data() as Record<string, any>;
      validateEmployee(payload, employeeData);

      if (!districtMatches(siteData.district, payload.district)) {
        throw new AttendanceError("The selected site does not belong to your district. Please choose a different site.");
      }

      const employeeClientName = normalizeNullableText(
        employeeData.clientName ?? payload.employeeClientName,
      );
      const siteClientName = normalizeNullableText(siteData.clientName ?? payload.clientName);
      const crossClientRelief = isCrossClientRelief(employeeClientName, siteClientName);

      const siteCoords = parseSiteCoordinates(siteData);
      if (!siteCoords) {
        throw new AttendanceError("This site's location has not been configured yet. Please ask your supervisor to set it up.");
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
        throw new AttendanceError("Please select a duty point for this site before submitting.");
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

      const lastState = stateSnap.exists
        ? (stateSnap.data() as Record<string, any>)
        : null;
      const lastRecordedShift = lastState?.lastShiftCode
        ? resolveShiftByCode(
            activeShiftSource.shiftMode,
            activeShiftSource.shiftTemplates,
            String(lastState.lastShiftCode),
          )
        : null;
      const selectedDutyPointId = selectedDutyPoint?.id ?? payload.dutyPointId ?? null;
      const selectedDutyPointName = selectedDutyPoint?.name ?? payload.dutyPointName ?? null;
      const selectedShiftCode = effectiveShift?.code ?? payload.shiftCode ?? null;
      const selectedShiftLabel = effectiveShift?.label ?? payload.shiftLabel ?? null;
      const selectedShiftStartTime = effectiveShift?.startTime ?? payload.shiftStartTime ?? null;
      const selectedShiftEndTime = effectiveShift?.endTime ?? payload.shiftEndTime ?? null;
      const submissionWindow = resolveAttendanceSubmissionWindow({
        attendanceDate: submittedAttendanceDate,
        status: payload.status,
        siteId: payload.siteId,
        dutyPointId: selectedDutyPointId,
        shift: effectiveShift,
        lastShift: lastRecordedShift,
        lastState,
      });
      const attendanceDate = submissionWindow.attendanceDate;
      let workOrderReviewWarning: string | null = null;

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
          if (payload.status === "Out" && submissionWindow.closingOpenSession) {
            workOrderReviewWarning = "Checkout was accepted for an open session even though no active work order was found for the session date.";
          } else {
            throw new AttendanceError("No work order has been assigned for this site today. Attendance cannot be recorded.");
          }
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

        if (!matchingWorkOrder && !workOrderReviewWarning) {
          if (payload.status === "Out" && submissionWindow.closingOpenSession) {
            workOrderReviewWarning = "Checkout was accepted for an open session even though the guard was not matched to the work order for the session date.";
          } else {
            throw new AttendanceError(
              "You are not assigned to this site for today's work order. Please contact your supervisor.",
            );
          }
        }
      } else {
        if (activeShiftSource.shiftMode === "fixed" && !effectiveShift) {
          throw new AttendanceError(
            selectedDutyPoint
              ? `Please select a shift for duty point "${selectedDutyPoint.name}" before submitting.`
              : "Please select a shift before submitting attendance.",
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
          `GPS signal is too weak (±${Math.round(gpsAccuracyMeters)}m). Please move to an open area and try again.`,
        );
      }

      // ── Geofence enforcement ────────────────────────────────────────────
      const geofenceViolation = actualDistance > effectiveRadiusMeters;
      const geofenceEnforcementMode =
        process.env.GEOFENCE_ENFORCEMENT_MODE || "warn"; // strict | warn | loose
      const geofenceWarning =
        geofenceViolation
          ? `Guard was ${Math.round(actualDistance)}m from the site (limit: ${effectiveRadiusMeters}m). Attendance recorded but flagged for review.`
          : null;

      // Strict mode: block attendance if outside geofence unless override reason provided
      if (
        geofenceViolation &&
        geofenceEnforcementMode === "strict" &&
        !payload.overrideReason
      ) {
        throw new AttendanceError(
          `You are outside the allowed radius (${Math.round(actualDistance)}m / limit: ${effectiveRadiusMeters}m). Please move closer to the site or contact your supervisor for an override.`,
        );
      }

      let staleSessionAutoClosed = false;
      let staleOutAutoClosed = false;

      if (!lastState && payload.status === "Out") {
        throw new AttendanceError(
          "You haven't marked IN yet today. Please mark IN first before recording OUT.",
        );
      }

      if (lastState) {
        if (payload.status === "In" && lastState.lastStatus === "In") {
          if (lastState.lastAttendanceDate === submittedAttendanceDate) {
            throw new AttendanceError(
              "You're already clocked IN today. Please mark OUT before marking IN again.",
            );
          }
          staleSessionAutoClosed = true;
        }

        if (
          lastState.lastAttendanceDate === attendanceDate &&
          lastState.lastStatus === payload.status
        ) {
          throw new AttendanceError(
            `Duplicate ${payload.status.toLowerCase()} entry is not allowed. You've already recorded attendance for today.`,
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
            lastShift: lastRecordedShift,
            lastState,
          });

          if (!overnightCheckoutAllowed) {
            staleOutAutoClosed = true;
          }
        }

        if (!staleOutAutoClosed) {
          if (payload.status === "Out" && lastState.lastStatus !== "In") {
            throw new AttendanceError(
              "You haven't marked IN yet. Please mark IN first before recording OUT.",
            );
          }

          if (
            lastState.lastAttendanceDate === attendanceDate &&
            lastState.lastStatus !== "In" &&
            payload.status === "Out"
          ) {
            throw new AttendanceError(
              "You haven't marked IN yet today. Please mark IN first before recording OUT.",
            );
          }
        }
      }

      const isMockLocationSuspected =
        payload.isMockLocationSuspected === true ||
        (typeof payload.mockLocationReason === "string" &&
          payload.mockLocationReason.trim().length > 0);
      const locationReviewWarning =
        geofenceViolation
          ? `Location is ${Math.round(actualDistance)}m away from the configured site radius of ${effectiveRadiusMeters}m.`
          : isMockLocationSuspected
            ? payload.mockLocationReason?.trim() ||
              "Location looks suspicious and requires admin review."
            : null;
      const attendanceReviewWarnings = [
        locationReviewWarning,
        workOrderReviewWarning,
        submissionWindow.contextChanged
          ? "Checkout context differed from the original IN session and requires admin review."
          : null,
        payload.overrideReason
          ? `Geofence override requested: ${payload.overrideReason}`
          : null,
      ].filter(Boolean) as string[];

      // Auto-close stale open session from a previous date
      if (staleSessionAutoClosed && lastState) {
        const staleOutLogRef = adminDb.collection("attendanceLogs").doc();
        const staleDate = lastState.lastAttendanceDate ?? "unknown";
        transaction.set(staleOutLogRef, {
          employeeId: payload.employeeId,
          employeeDocId: payload.employeeDocId,
          employeeName: payload.employeeName,
          status: "Out",
          attendanceDate: staleDate,
          siteId: lastState.lastSiteId ?? payload.siteId,
          siteName: payload.siteName,
          clientName: lastState.lastSiteClientName ?? siteClientName,
          autoClosed: true,
          autoClosedReason:
            "Previous IN session from " +
            staleDate +
            " was never checked out. Auto-closed by new IN on " +
            submittedAttendanceDate +
            ".",
          reportedAt: now,
          serverProcessedAt: now,
          createdAt: now,
          attendanceReviewWarnings: [
            "Auto-closed stale session from " + staleDate + ".",
          ],
        });
        if (lastState.openSessionId) {
          transaction.set(
            adminDb
              .collection("attendanceSessions")
              .doc(String(lastState.openSessionId)),
            {
              status: "closed",
              outLogId: staleOutLogRef.id,
              endedAt: now,
              autoClosed: true,
              autoClosedReason: "Auto-closed by new IN on " + submittedAttendanceDate,
              updatedAt: now,
            },
            { merge: true },
          );
        }
        attendanceReviewWarnings.push(
          "Previous session from " + staleDate + " was auto-closed (no OUT was recorded).",
        );
      }

      // Auto-close stale session via OUT attempt
      if (staleOutAutoClosed && lastState) {
        const staleOutLogRef = adminDb.collection("attendanceLogs").doc();
        const staleDate = lastState.lastAttendanceDate ?? "unknown";
        transaction.set(staleOutLogRef, {
          employeeId: payload.employeeId,
          employeeDocId: payload.employeeDocId,
          employeeName: payload.employeeName,
          status: "Out",
          attendanceDate: staleDate,
          siteId: lastState.lastSiteId ?? payload.siteId,
          siteName: payload.siteName,
          clientName: lastState.lastSiteClientName ?? siteClientName,
          autoClosed: true,
          autoClosedReason:
            "Previous IN session from " +
            staleDate +
            " was never checked out. Auto-closed by OUT attempt on " +
            submittedAttendanceDate +
            ".",
          reportedAt: now,
          serverProcessedAt: now,
          createdAt: now,
          attendanceReviewWarnings: [
            "Auto-closed stale session from " + staleDate + " (guard attempted late OUT).",
          ],
        });
        if (lastState.openSessionId) {
          transaction.set(
            adminDb
              .collection("attendanceSessions")
              .doc(String(lastState.openSessionId)),
            {
              status: "closed",
              outLogId: staleOutLogRef.id,
              endedAt: now,
              autoClosed: true,
              autoClosedReason:
                "Auto-closed by OUT attempt on " + submittedAttendanceDate,
              updatedAt: now,
            },
            { merge: true },
          );
        }
        transaction.set(
          attendanceStateRef,
          {
            lastStatus: "Out",
            lastAttendanceDate: staleDate,
            lastAttendanceId: staleOutLogRef.id,
            openSessionId: FieldValue.delete(),
            openSessionStartedAt: FieldValue.delete(),
            lastLoggedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
        staleOutAutoCloseResult = { id: staleOutLogRef.id, staleDate };
        return;
      }

      const attendanceSessionId =
        payload.status === "In"
          ? attendanceLogRef.id
          : submissionWindow.openSessionId ?? null;

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
        dutyPointId: selectedDutyPointId,
        dutyPointName: selectedDutyPointName,
        clientName: siteClientName,
        employeeClientName,
        siteClientName,
        crossClientRelief,
        sourceCollection: sourceCol,
        shiftCode: selectedShiftCode,
        shiftLabel: selectedShiftLabel,
        shiftStartTime: selectedShiftStartTime,
        shiftEndTime: selectedShiftEndTime,
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
        attendanceSessionId,
        checkoutContextChanged: submissionWindow.contextChanged,
        checkoutOriginalSiteId: submissionWindow.contextChanged ? lastState?.lastSiteId ?? null : null,
        checkoutOriginalDutyPointId: submissionWindow.contextChanged ? lastState?.lastDutyPointId ?? null : null,
        checkoutOriginalShiftCode: submissionWindow.contextChanged ? lastState?.lastShiftCode ?? null : null,
        attendanceReviewWarnings,
        isMockLocationSuspected,
        mockLocationReason: payload.mockLocationReason ?? null,
        requiresLocationReview: Boolean(locationReviewWarning),
        requiresAdminReview:
          attendanceReviewWarnings.length > 0 ||
          submissionWindow.requiresAdminReview ||
          Boolean(locationReviewWarning) ||
          Boolean(clockDriftWarning) ||
          isMockLocationSuspected ||
          (typeof payload.photoCompliance?.adminFlag === "boolean" && payload.photoCompliance.adminFlag) ||
          Boolean(payload.overrideReason),
        photoUrl: payload.photoUrl,
        photoCapturedAt: payload.photoCapturedAt ?? null,
        photoCompliance: locationReviewWarning
          ? mergePhotoCompliance(payload.photoCompliance, locationReviewWarning)
          : payload.photoCompliance ?? null,
        deviceInfo: payload.deviceInfo,
        attendanceDate,
        createdAt: now,
        submittedByUid: decoded?.uid ?? null,
        submittedByRole: decoded?.role ?? null,
        // Robustness fields
        processedClientRequestId: payload.clientRequestId ?? null,
        overrideReason: payload.overrideReason ?? null,
        qrToken: payload.qrToken ?? null,
        auditTrail: [
          buildServerAuditEvent(
            "attendance_submitted",
            decoded ? { uid: decoded.uid, email: decoded.email } : undefined,
            {
              employeeDocId: payload.employeeDocId,
              siteId: payload.siteId,
              status: payload.status,
              clientRequestId: payload.clientRequestId,
            },
          ),
        ],
      });

      if (payload.status === "In") {
        transaction.set(adminDb.collection("attendanceSessions").doc(attendanceLogRef.id), {
          employeeId: payload.employeeId,
          employeeDocId: payload.employeeDocId,
          employeeName: payload.employeeName,
          status: "open",
          attendanceDate,
          siteId: payload.siteId,
          siteName: payload.siteName,
          dutyPointId: selectedDutyPointId,
          dutyPointName: selectedDutyPointName,
          clientName: siteClientName,
          employeeClientName,
          siteClientName,
          crossClientRelief,
          sourceCollection: sourceCol,
          shiftCode: selectedShiftCode,
          shiftLabel: selectedShiftLabel,
          shiftStartTime: selectedShiftStartTime,
          shiftEndTime: selectedShiftEndTime,
          inLogId: attendanceLogRef.id,
          startedAt: reportedAt,
          createdAt: now,
          updatedAt: now,
        });
      } else if (submissionWindow.openSessionId) {
        transaction.set(
          adminDb.collection("attendanceSessions").doc(submissionWindow.openSessionId),
          {
            status: "closed",
            outLogId: attendanceLogRef.id,
            endedAt: reportedAt,
            checkoutSiteId: payload.siteId,
            checkoutDutyPointId: selectedDutyPointId,
            checkoutShiftCode: selectedShiftCode,
            checkoutContextChanged: submissionWindow.contextChanged,
            requiresAdminReview: submissionWindow.requiresAdminReview || attendanceReviewWarnings.length > 0,
            updatedAt: now,
          },
          { merge: true },
        );
      }

      transaction.set(
        attendanceStateRef,
        {
          employeeDocId: payload.employeeDocId,
          employeeName: payload.employeeName,
          lastStatus: payload.status,
          lastSiteId: payload.siteId,
          lastDutyPointId: selectedDutyPointId,
          lastShiftCode: selectedShiftCode,
          employeeClientName,
          lastSiteClientName: siteClientName,
          lastCrossClientRelief: crossClientRelief,
          lastAttendanceDate: attendanceDate,
          lastAttendanceId: attendanceLogRef.id,
          openSessionId: payload.status === "In" ? attendanceLogRef.id : FieldValue.delete(),
          openSessionStartedAt: payload.status === "In" ? reportedAt : FieldValue.delete(),
          lastLoggedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );

      guardLocationWrite = {
        employeeId: payload.employeeId,
        guardName: buildGuardName(employeeData, payload.employeeId),
        siteId: payload.siteId,
        siteName: String(siteData.siteName || payload.siteName || "").trim(),
        clientName: siteClientName ?? "",
        employeeClientName,
        siteClientName,
        crossClientRelief,
        district: normalizeDistrictName(payload.district),
        lat: payload.status === "In" ? payload.locationCoords.lat : 0,
        lng: payload.status === "In" ? payload.locationCoords.lon : 0,
        accuracy:
          typeof gpsAccuracyMeters === "number" && Number.isFinite(gpsAccuracyMeters)
            ? gpsAccuracyMeters
            : 0,
        isOutOfZone: payload.status === "In" ? actualDistance > effectiveRadiusMeters : false,
        status: payload.status,
        siteLat: siteCoords.lat,
        siteLng: siteCoords.lng,
        geofenceRadius: effectiveRadiusMeters,
        attendanceId: attendanceLogRef.id,
      };
    });

    const liveLocationWrite = guardLocationWrite as GuardLocationWrite | null;
    if (liveLocationWrite) {
      await adminDb
        .collection("guardLocations")
        .doc(liveLocationWrite.employeeId)
        .set(
          {
            employeeId: liveLocationWrite.employeeId,
            guardName: liveLocationWrite.guardName,
            siteId: liveLocationWrite.siteId,
            siteName: liveLocationWrite.siteName,
            clientName: liveLocationWrite.clientName,
            employeeClientName: liveLocationWrite.employeeClientName,
            siteClientName: liveLocationWrite.siteClientName,
            crossClientRelief: liveLocationWrite.crossClientRelief,
            district: liveLocationWrite.district,
            lat: liveLocationWrite.lat,
            lng: liveLocationWrite.lng,
            accuracy: liveLocationWrite.accuracy,
            isOutOfZone: liveLocationWrite.isOutOfZone,
            status: liveLocationWrite.status,
            attendanceId: liveLocationWrite.attendanceId,
            siteLat: liveLocationWrite.siteLat,
            siteLng: liveLocationWrite.siteLng,
            geofenceRadius: liveLocationWrite.geofenceRadius,
            updatedAt: now,
          },
          { merge: true },
        );
    }

    if (staleOutAutoCloseResult !== null) {
      const result = staleOutAutoCloseResult as { id: string; staleDate: string };
      await incrementSystemMetric(SYSTEM_METRIC_NAMES.attendanceSubmitSuccess);
      return NextResponse.json({
        success: true,
        id: result.id,
        autoClosed: true,
        message:
          "Previous IN session from " +
          result.staleDate +
          " was never checked out. Session has been auto-closed. Please mark IN to start today's attendance.",
      });
    }

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
          error: "Something went wrong with your submission. Please try again.",
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
