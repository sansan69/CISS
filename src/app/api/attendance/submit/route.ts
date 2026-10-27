import { NextRequest, NextResponse } from "next/server";
import { haversineDistanceMeters } from "@/lib/geo";
import {
  getNextShift,
  resolveShiftByCode,
  resolveSiteDutyPoints,
  resolveAttendanceShift,
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
  canRecordIn,
  canRecordOut,
  computeShiftInterval,
  resolveAttendanceSubmissionWindow,
  resolveShiftOperationalDate,
} from "@/lib/attendance/attendance-validation";
import type { AppDecodedToken } from "@/lib/server/auth";
import {
  checkRateLimit,
  buildRateLimitKey,
  getClientIp,
} from "@/lib/server/rate-limit";
import { verifyAttendanceVerificationToken } from "@/lib/server/attendance-verification-token";
import { consumeAttendanceProofInTransaction } from "@/lib/server/attendance-proofs";

export const runtime = "nodejs";

// Firestore-based distributed rate limiting config
const RATE_LIMIT_CONFIG = {
  authenticated: { maxRequests: 30, windowMs: 60_000 },
  // Shared site kiosks legitimately submit a whole shift change from one IP.
  anonymous: { maxRequests: 60, windowMs: 60_000 },
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
 * Whether the authenticated caller is the guard the attendance is for.
 *
 * Self submissions need no external proof. Everything else is an *assisted*
 * submission (guard B marking guard A from B's phone) and must present a
 * single-use identity proof minted for exactly this actor and subject.
 */
async function callerOwnsEmployee(
  decoded: AppDecodedToken,
  employeeDocId: string,
): Promise<boolean> {
  if (decoded.employeeDocId && decoded.employeeDocId === employeeDocId) {
    return true;
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
  return employeeData.guardAuthUid === decoded.uid;
}

/** Business-logic errors that should return HTTP 400 (not 500). */
class AttendanceProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceProofError";
  }
}

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
  employeeDocId: string;
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
  accuracyLimit: number;
  gpsReliable: boolean;
  distanceFromSite: number;
  zoneStatus: "in_zone" | "out_of_zone";
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
          : typeof siteData.latitude === "number"
            ? siteData.latitude
            : Number(siteData.latitude) || Number(siteData.latString);
  const lng =
    typeof geolocation?.longitude === "number"
      ? geolocation.longitude
      : typeof geolocation?.lng === "number"
        ? geolocation.lng
        : typeof siteData.lng === "number"
          ? siteData.lng
          : typeof siteData.longitude === "number"
            ? siteData.longitude
            : Number(siteData.longitude) || Number(siteData.lngString);

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
    .where("processedClientRequestId", "==", clientRequestId)
    .limit(10)
    .get();

  if (snap.empty) return null;

  const doc = snap.docs.find((candidate) => {
    const data = candidate.data() as Record<string, any>;
    return data.employeeDocId === employeeDocId;
  });
  if (!doc) return null;

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

    // ── 2. Guard identity ─────────────────────────────────────────────────────
    // Three supported shapes:
    //   self      — the signed-in guard submits their own attendance.
    //   assisted  — a signed-in guard submits for a colleague who does not have
    //               their phone, using the colleague's QR badge, employee ID,
    //               phone, or (TCS only) resource ID.
    //   kiosk     — no session; only a signed QR badge is accepted.
    // Assisted and kiosk submissions require a single-use proof minted for this
    // exact subject (and actor, when signed in).
    const verification = payload.attendanceVerificationToken
      ? verifyAttendanceVerificationToken(payload.attendanceVerificationToken)
      : null;
    let assistedSubmission = false;
    // Consumed only after the idempotency lookup: a retry of a request that
    // already committed must get its duplicate result, not a "proof used" 401.
    let proofToConsume: {
      nonce: string;
      employeeDocId: string;
      actorUid: string | null;
    } | null = null;

    if (isAuthenticated) {
      const ownsEmployee = await callerOwnsEmployee(decoded, payload.employeeDocId);

      if (!ownsEmployee) {
        if (decoded.role !== "guard") {
          return NextResponse.json(
            { error: "You can only submit attendance for your own account." },
            { status: 403 },
          );
        }
        if (
          !verification ||
          verification.employeeDocId !== payload.employeeDocId ||
          verification.actorUid !== decoded.uid
        ) {
          return NextResponse.json(
            {
              error:
                "Identify the guard again from this phone, then submit. The identification has expired or belongs to another account.",
            },
            { status: 401 },
          );
        }
        proofToConsume = {
          nonce: verification.nonce,
          employeeDocId: payload.employeeDocId,
          actorUid: decoded.uid,
        };
        assistedSubmission = true;
      } else if (verification && verification.employeeDocId === payload.employeeDocId) {
        // A self-submitting guard may still hold a proof from the identify step
        // (e.g. they looked themselves up first). Burn it so it cannot be reused.
        proofToConsume = {
          nonce: verification.nonce,
          employeeDocId: payload.employeeDocId,
          actorUid: verification.actorUid,
        };
      }
    } else {
      // Compatibility with installed kiosk builds: a signed-in guard is still
      // preferred, but a genuinely shared device may identify by employee ID,
      // phone or resource ID while the switch is on. Set
      // ATTENDANCE_ALLOW_ANONYMOUS_IDENTIFIERS=false to require a badge again.
      const kioskMethodAllowed =
        verification?.method === "qr" ||
        process.env.ATTENDANCE_ALLOW_ANONYMOUS_IDENTIFIERS === "true";
      if (
        !verification ||
        verification.employeeDocId !== payload.employeeDocId ||
        verification.actorUid !== null ||
        !kioskMethodAllowed
      ) {
        return NextResponse.json(
          {
            error:
              "A shared device can only mark attendance from a signed QR badge. Sign in to use an employee ID, phone number, or resource ID.",
          },
          { status: 401 },
        );
      }
      proofToConsume = {
        nonce: verification.nonce,
        employeeDocId: payload.employeeDocId,
        actorUid: null,
      };
      assistedSubmission = true;
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue, Timestamp } = await import("firebase-admin/firestore");
    const now = Timestamp.now();
    const serverNow = now.toDate();

    // ── 3. Idempotency check ──────────────────────────────────────────────
    // Mobile builds before 1.0.22 reused one client request id for the IN and
    // the following OUT. A same-status retry is a duplicate, but a different
    // status is a new punch and must not be silently swallowed. The derived
    // suffix keeps that second punch idempotent on its own retries.
    let effectiveClientRequestId = payload.clientRequestId ?? null;
    if (effectiveClientRequestId) {
      const duplicate = await findDuplicateSubmission(
        adminDb,
        effectiveClientRequestId,
        payload.employeeDocId,
      );
      if (duplicate) {
        if (duplicate.status === payload.status) {
          return NextResponse.json({
            success: true,
            id: duplicate.id,
            duplicate: true,
            message: "Attendance already recorded for this request.",
          });
        }
        effectiveClientRequestId = `${effectiveClientRequestId}:${payload.status.toLowerCase()}`;
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
    const locationCapturedAtDate = new Date(payload.locationCapturedAt);
    const photoCapturedAtDate = new Date(payload.photoCapturedAt);
    const futureToleranceMs = 5 * 60 * 1000;
    const captureWindowMs = 30 * 60 * 1000;
    if (
      locationCapturedAtDate.getTime() > serverNow.getTime() + futureToleranceMs ||
      photoCapturedAtDate.getTime() > serverNow.getTime() + futureToleranceMs
    ) {
      throw new AttendanceError(
        "The device time is incorrect. Set the device clock automatically and try again.",
      );
    }
    if (
      Math.abs(locationCapturedAtDate.getTime() - reportedAtDate.getTime()) >
        captureWindowMs ||
      Math.abs(photoCapturedAtDate.getTime() - reportedAtDate.getTime()) >
        captureWindowMs
    ) {
      throw new AttendanceError(
        "Location and photo must be captured during the current attendance attempt.",
      );
    }
    const expectedPhotoStoragePath =
      `employees/${payload.employeeDocId}/attendance/` +
      `${payload.attendanceAttemptId}/photo.jpg`;
    if (
      payload.photoStoragePath !== expectedPhotoStoragePath ||
      !payload.photoUrl.includes(encodeURIComponent(expectedPhotoStoragePath))
    ) {
      throw new AttendanceError(
        "Attendance photo does not belong to this attendance attempt.",
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
    const attendanceLogsCollection = adminDb.collection("attendanceLogs");
    let attendanceLogRef = effectiveClientRequestId
      ? attendanceLogsCollection.doc(effectiveClientRequestId)
      : attendanceLogsCollection.doc();
    let transactionDuplicateId: string | null = null;
    let transactionConflict = false;

    await adminDb.runTransaction(async (transaction) => {
      const [employeeSnap, siteSnap, stateSnap, existingLogSnap] =
        await Promise.all([
        transaction.get(employeeRef),
        transaction.get(siteRef),
        transaction.get(attendanceStateRef),
        transaction.get(attendanceLogRef),
      ]);

      if (existingLogSnap.exists) {
        const existing = existingLogSnap.data() as Record<string, unknown> | undefined;
        const existingSubject =
          typeof existing?.employeeDocId === "string" ? existing.employeeDocId : null;
        // The log document id is the client request id. If another guard already
        // used that id, reporting duplicate success would silently drop this
        // submission, so surface an explicit conflict instead.
        if (existingSubject && existingSubject !== payload.employeeDocId) {
          transactionConflict = true;
          return;
        }
        const existingStatus = String(existing?.status ?? "");
        if (existingStatus !== payload.status && effectiveClientRequestId) {
          // A legacy client reused the IN request id for OUT. The preflight
          // may have missed the concurrently committed IN; resolve the
          // status-suffixed log inside this transaction before any writes.
          const suffixedId = `${effectiveClientRequestId}:${payload.status.toLowerCase()}`;
          const suffixedRef = attendanceLogsCollection.doc(suffixedId);
          const suffixedSnap = await transaction.get(suffixedRef);
          if (suffixedSnap.exists) {
            const suffixedSubject = String(
              (suffixedSnap.data() as Record<string, unknown> | undefined)
                ?.employeeDocId ?? "",
            );
            if (suffixedSubject && suffixedSubject !== payload.employeeDocId) {
              transactionConflict = true;
              return;
            }
            transactionDuplicateId = suffixedRef.id;
            return;
          }
          attendanceLogRef = suffixedRef;
          effectiveClientRequestId = suffixedId;
        } else {
          transactionDuplicateId = attendanceLogRef.id;
          return;
        }
      }

      if (!employeeSnap.exists) {
        throw new AttendanceError("Employee record not found. Please verify your ID and try again.");
      }

      if (!siteSnap.exists) {
        throw new AttendanceError("The selected site is no longer available. Please select a different site.");
      }

      const employeeData = employeeSnap.data() as Record<string, any>;
      const siteData = siteSnap.data() as Record<string, any>;
      validateEmployee(payload, employeeData);

      // Guards are routinely posted across district boundaries (TCS exam
      // duty is the common case). The geofence, not the home district, is the
      // location authority; a mismatch is recorded for review instead of
      // blocking a legitimate punch.
      const crossDistrictRelief = !districtMatches(
        siteData.district,
        payload.district,
      );

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
        sourceCol === "sites" ? resolveSiteDutyPoints(siteData) : [];
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
      const lastState = stateSnap.exists
        ? (stateSnap.data() as Record<string, any>)
        : null;
      const resolvedShift = resolveAttendanceShift({
        shiftTemplates: activeShiftSource.shiftTemplates,
        punchAt: reportedAtDate,
        status: payload.status,
        explicitShiftCode: payload.shiftCode ?? null,
        lastShiftCode: lastState?.lastShiftCode ?? null,
      });
      const selectedShift = resolveShiftByCode(
        activeShiftSource.shiftMode,
        activeShiftSource.shiftTemplates,
        payload.shiftCode,
      );
      const effectiveShift = resolvedShift ?? selectedShift;
      const nextShift = getNextShift(
        activeShiftSource.shiftMode,
        activeShiftSource.shiftTemplates,
        effectiveShift?.code,
      );

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
      const resolvedOperationalDate = resolveShiftOperationalDate({
        punchAt: reportedAtDate,
        shift: effectiveShift,
        status: payload.status,
        openSessionOperationalDate:
          lastState?.lastStatus === "In"
            ? lastState.lastAttendanceDate ?? null
            : null,
      });
      const submissionWindow = resolveAttendanceSubmissionWindow({
        attendanceDate:
          effectiveShift ? resolvedOperationalDate : submittedAttendanceDate,
        status: payload.status,
        siteId: payload.siteId,
        dutyPointId: selectedDutyPointId,
        shift: effectiveShift,
        lastShift: lastRecordedShift,
        lastState,
      });
      const attendanceDate = submissionWindow.attendanceDate;
      const shiftInterval = computeShiftInterval({
        operationalDate: attendanceDate,
        shift: effectiveShift,
      });
      // Work orders represent TCS ad-hoc manpower planning only. Attendance is
      // authoritative on its own and must never be blocked by the presence,
      // absence, or guard assignment of a work order.
      if (
        !isTcsSite &&
        activeShiftSource.shiftMode === "fixed" &&
        activeShiftSource.shiftTemplates.length > 0 &&
        !effectiveShift
      ) {
        throw new AttendanceError(
          selectedDutyPoint
            ? `Please select a shift for duty point "${selectedDutyPoint.name}" before submitting.`
            : "Please select a shift before submitting attendance.",
        );
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

      // ── State machine validation using canRecordIn / canRecordOut ────────────
      let staleSessionAutoClosed = false;

      if (payload.status === "In") {
        const inCheck = canRecordIn({
          lastState,
          attendanceDate,
          siteId: payload.siteId,
          dutyPointId: selectedDutyPointId,
          shift: effectiveShift,
          employeeDocId: payload.employeeDocId,
        });

        if (!inCheck.ok) {
          throw new AttendanceError(inCheck.reason || "Cannot record IN at this time.");
        }

        if (inCheck.action === "autoClosePrevious" && lastState) {
          staleSessionAutoClosed = true;
        }
      } else {
        const outCheck = canRecordOut({
          lastState,
          attendanceDate,
          siteId: payload.siteId,
          dutyPointId: selectedDutyPointId,
          shift: effectiveShift,
        });

        if (!outCheck.ok) {
          throw new AttendanceError(outCheck.reason || "Cannot record OUT at this time.");
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
        crossDistrictRelief
          ? `Guard district "${payload.district}" differs from site district "${siteData.district ?? ""}"; recorded for review.`
          : null,
        locationReviewWarning,
        submissionWindow.contextChanged
          ? "Checkout context differed from the original IN session and requires admin review."
          : null,
        payload.overrideReason
          ? `Geofence override requested: ${payload.overrideReason}`
          : null,
      ].filter(Boolean) as string[];

      // Consume the identity proof atomically with the attendance write, after
      // every validation has passed. A rejected or aborted attempt must leave
      // the proof usable for a legitimate retry.
      if (proofToConsume) {
        const consumed = await consumeAttendanceProofInTransaction(
          transaction,
          proofToConsume,
        );
        if (!consumed) {
          throw new AttendanceProofError(
            "This identification has already been used or has expired. Identify the guard again.",
          );
        }
      }

      // Auto-close stale open session from a previous date
      if (staleSessionAutoClosed && lastState) {
        const staleOutLogRef = adminDb.collection("attendanceLogs").doc();
        const staleDate = lastState.lastAttendanceDate ?? INDIA_DATE_FORMATTER.format(new Date());
        const shiftEndsAtValue = lastState.shiftEndsAt as
          | { toDate?: () => Date; seconds?: number }
          | string
          | undefined;
        const scheduledEndCandidate =
          typeof shiftEndsAtValue === "object" &&
          typeof shiftEndsAtValue?.toDate === "function"
            ? shiftEndsAtValue.toDate()
            : typeof shiftEndsAtValue === "object" &&
                typeof shiftEndsAtValue?.seconds === "number"
              ? new Date(shiftEndsAtValue.seconds * 1000)
              : typeof shiftEndsAtValue === "string"
                ? new Date(shiftEndsAtValue)
                : null;
        const scheduledEndDate =
          scheduledEndCandidate &&
          !Number.isNaN(scheduledEndCandidate.getTime())
            ? scheduledEndCandidate
            : reportedAtDate;
        const scheduledEnd = Timestamp.fromDate(scheduledEndDate);
        transaction.set(staleOutLogRef, {
          employeeId: lastState.employeeId ?? payload.employeeId,
          employeeDocId: payload.employeeDocId,
          employeeName: lastState.employeeName ?? buildGuardName(employeeData, payload.employeeId),
          status: "Out",
          attendanceDate: staleDate,
          siteId: lastState.lastSiteId ?? payload.siteId,
          siteName: lastState.lastSiteName ?? "",
          dutyPointId: lastState.lastDutyPointId ?? null,
          dutyPointName: lastState.lastDutyPointName ?? null,
          clientName: lastState.lastSiteClientName ?? siteClientName,
          employeeClientName: lastState.employeeClientName ?? employeeClientName,
          siteClientName: lastState.lastSiteClientName ?? siteClientName,
          shiftCode: lastState.lastShiftCode ?? null,
          shiftLabel: lastState.lastShiftLabel ?? null,
          attendanceSessionId: lastState.openSessionId ?? null,
          autoClosed: true,
          closeReason: "missed_checkout",
          requiresAdminReview: true,
          autoClosedReason:
            "Previous IN session from " +
            staleDate +
            " was never checked out. Auto-closed by new IN on " +
            submittedAttendanceDate +
            ".",
          reportedAt: scheduledEnd,
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
              endedAt: scheduledEnd,
              autoClosed: true,
              closeReason: "missed_checkout",
              requiresAdminReview: true,
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
        crossDistrictRelief,
        sourceCollection: sourceCol,
        shiftCode: selectedShiftCode,
        shiftLabel: selectedShiftLabel,
        shiftStartTime: selectedShiftStartTime,
        shiftEndTime: selectedShiftEndTime,
        shiftStartsAt: shiftInterval
          ? Timestamp.fromDate(new Date(shiftInterval.shiftStartsAt))
          : null,
        shiftEndsAt: shiftInterval
          ? Timestamp.fromDate(new Date(shiftInterval.shiftEndsAt))
          : null,
        nextShiftCode: payload.nextShiftCode ?? nextShift?.code ?? null,
        nextShiftStartsAt: payload.nextShiftStartsAt ?? nextShift?.startTime ?? null,
        siteCoords,
        locationText: payload.locationText,
        locationCoords: payload.locationCoords,
        locationCapturedAt: Timestamp.fromDate(locationCapturedAtDate),
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
          (payload.riskFlags?.length ?? 0) > 0 ||
          Boolean(payload.punchDeviceChanged) ||
          attendanceReviewWarnings.length > 0 ||
          submissionWindow.requiresAdminReview ||
          Boolean(locationReviewWarning) ||
          Boolean(clockDriftWarning) ||
          isMockLocationSuspected ||
          (typeof payload.photoCompliance?.adminFlag === "boolean" && payload.photoCompliance.adminFlag) ||
          Boolean(payload.overrideReason),
        photoUrl: payload.photoUrl,
        photoStoragePath: payload.photoStoragePath,
        photoCapturedAt: Timestamp.fromDate(photoCapturedAtDate),
        photoCompliance: locationReviewWarning
          ? mergePhotoCompliance(payload.photoCompliance, locationReviewWarning)
          : payload.photoCompliance ?? null,
        deviceInfo: payload.deviceInfo,
        deviceId: payload.deviceId ?? null,
        punchDeviceChanged: payload.punchDeviceChanged ?? false,
        riskFlags: payload.riskFlags ?? [],
        attestationStatus: payload.attestationStatus ?? "not_configured",
        raspStatus: payload.raspStatus ?? "not_configured",
        attendanceDate,
        createdAt: now,
        submittedByUid: decoded?.uid ?? null,
        submittedByRole: decoded?.role ?? null,
        // Assisted attendance: a colleague (or a shared kiosk) marked this
        // guard present. Kept for audit and review reporting.
        assistedSubmission,
        attendanceMethod:
          verification?.method ?? (isAuthenticated ? "authenticated" : null),
        markedByUid: assistedSubmission ? decoded?.uid ?? null : null,
        markedByEmployeeDocId: assistedSubmission
          ? decoded?.employeeDocId ?? null
          : null,
        // Robustness fields
        processedClientRequestId: effectiveClientRequestId,
        attendanceAttemptId: payload.attendanceAttemptId,
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
              clientRequestId: effectiveClientRequestId,
              assistedSubmission,
              attendanceMethod:
                verification?.method ?? (isAuthenticated ? "authenticated" : null),
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
          shiftStartsAt: shiftInterval
            ? Timestamp.fromDate(new Date(shiftInterval.shiftStartsAt))
            : null,
          shiftEndsAt: shiftInterval
            ? Timestamp.fromDate(new Date(shiftInterval.shiftEndsAt))
            : null,
          autoCheckoutAt: shiftInterval
            ? Timestamp.fromDate(new Date(shiftInterval.autoCheckoutAt))
            : null,
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
          employeeId: payload.employeeId,
          employeeName: payload.employeeName,
          lastStatus: payload.status,
          lastSiteId: payload.siteId,
          lastSiteName: String(siteData.siteName || payload.siteName || "").trim(),
          lastDutyPointId: selectedDutyPointId,
          lastDutyPointName: selectedDutyPointName,
          lastShiftCode: selectedShiftCode,
          lastShiftLabel: selectedShiftLabel,
          shiftStartsAt:
            payload.status === "In" && shiftInterval
              ? Timestamp.fromDate(new Date(shiftInterval.shiftStartsAt))
              : FieldValue.delete(),
          shiftEndsAt:
            payload.status === "In" && shiftInterval
              ? Timestamp.fromDate(new Date(shiftInterval.shiftEndsAt))
              : FieldValue.delete(),
          employeeClientName,
          lastSiteClientName: siteClientName,
          lastCrossClientRelief: crossClientRelief,
          lastAttendanceDate: attendanceDate,
          lastAttendanceId: attendanceLogRef.id,
          openSessionId: payload.status === "In" ? attendanceLogRef.id : FieldValue.delete(),
          openSessionStartedAt: payload.status === "In" ? reportedAt : FieldValue.delete(),
          autoCheckoutAt:
            payload.status === "In" && shiftInterval
              ? Timestamp.fromDate(new Date(shiftInterval.autoCheckoutAt))
              : FieldValue.delete(),
          lastLoggedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );

      const liveLocationWrite: GuardLocationWrite = {
        employeeId: payload.employeeId,
        employeeDocId: payload.employeeDocId,
        guardName: buildGuardName(employeeData, payload.employeeId),
        siteId: payload.siteId,
        siteName: String(siteData.siteName || payload.siteName || "").trim(),
        clientName: siteClientName ?? "",
        employeeClientName,
        siteClientName,
        crossClientRelief,
        district: normalizeDistrictName(payload.district),
        lat: payload.locationCoords.lat,
        lng: payload.locationCoords.lon,
        accuracy:
          typeof gpsAccuracyMeters === "number" && Number.isFinite(gpsAccuracyMeters)
            ? gpsAccuracyMeters
            : 0,
        accuracyLimit: gpsAccuracyLimitMeters,
        gpsReliable:
          typeof gpsAccuracyMeters === "number" &&
          Number.isFinite(gpsAccuracyMeters) &&
          gpsAccuracyMeters > 0 &&
          gpsAccuracyMeters <= gpsAccuracyLimitMeters,
        distanceFromSite: actualDistance,
        zoneStatus:
          actualDistance > effectiveRadiusMeters ? "out_of_zone" : "in_zone",
        isOutOfZone: payload.status === "In" ? actualDistance > effectiveRadiusMeters : false,
        status: payload.status,
        siteLat: siteCoords.lat,
        siteLng: siteCoords.lng,
        geofenceRadius: effectiveRadiusMeters,
        attendanceId: attendanceLogRef.id,
      };
      transaction.set(
        adminDb
          .collection("guardLocations")
          .doc(liveLocationWrite.employeeDocId),
        {
          employeeDocId: liveLocationWrite.employeeDocId,
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
          accuracyLimit: liveLocationWrite.accuracyLimit,
          gpsReliable: liveLocationWrite.gpsReliable,
          distanceFromSite: liveLocationWrite.distanceFromSite,
          zoneStatus: liveLocationWrite.zoneStatus,
          isOutOfZone: liveLocationWrite.isOutOfZone,
          status: liveLocationWrite.status,
          attendanceId: liveLocationWrite.attendanceId,
          siteLat: liveLocationWrite.siteLat,
          siteLng: liveLocationWrite.siteLng,
          geofenceRadius: liveLocationWrite.geofenceRadius,
          attendanceSessionId:
            payload.status === "In"
              ? attendanceLogRef.id
              : submissionWindow.openSessionId ?? null,
          trackingSource: "attendance_submission",
          serverReceivedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
    });

    if (transactionConflict) {
      return NextResponse.json(
        {
          error:
            "This request id was already used for another guard. Retry with a new request id.",
        },
        { status: 409 },
      );
    }

    if (transactionDuplicateId) {
      return NextResponse.json({
        success: true,
        id: transactionDuplicateId,
        duplicate: true,
        message: "Attendance already recorded for this request.",
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
    const status =
      error instanceof AttendanceProofError
        ? 401
        : error instanceof AttendanceError
          ? 400
          : 500;

    const { log } = await import("@/lib/server/log");
    log("error", "attendance", "Attendance submit failed", { error: error?.message });
    return NextResponse.json(
      { error: error?.message || "Could not submit attendance." },
      { status },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}
