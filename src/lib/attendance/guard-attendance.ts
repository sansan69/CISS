import { districtMatches } from "@/lib/districts";

export type GuardAttendanceEntry = {
  id: string;
  guardName: string;
  guardId: string;
  employeeId: string;
  siteName: string;
  clientName: string;
  district: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  dutyPointName: string;
  shiftLabel: string;
  status: string;
  photoUrl: string | null;
  locationCoords: { lat: number; lon: number } | null;
  distanceMeters: number | null;
  gpsAccuracyMeters: number | null;
  geofenceRadiusAtTime: number | null;
  isMockLocationSuspected: boolean;
  mockLocationReason: string | null;
  photoCompliance: Record<string, unknown> | null;
  reviewStatus: string | null;
  requiresAdminReview: boolean;
};

type AttendanceLog = Record<string, unknown> & { id: string };

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().getTime();
  }
  if (typeof (value as { seconds?: unknown }).seconds === "number") {
    return (value as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function toTimeLabel(value: unknown): string | null {
  const millis = toMillis(value);
  if (!millis) return null;
  return new Date(millis).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Grouping key for an attendance log. Uses employeeDocId as the unique key,
 * falling back to employeeId for legacy logs and finally to the log's own
 * document id so different guards are never incorrectly merged.
 */
function employeeKey(log: AttendanceLog): string {
  const docId = normalizeText(log.employeeDocId);
  if (docId) return docId;
  const empId = normalizeText(log.employeeId);
  if (empId) return empId;
  return log.id || `unknown-${Math.random().toString(36).slice(2, 8)}`;
}

export type GuardAttendanceRangeInput = {
  adminDb: FirebaseFirestore.Firestore;
  isAdmin: boolean;
  /** FO assigned districts (used when `requestedDistrict` is empty and not admin). */
  assignedDistricts: string[];
  requestedDistrict: string | null;
  /** Inclusive start date in YYYY-MM-DD (IST). */
  startDate: string;
  /** Inclusive end date in YYYY-MM-DD (IST). */
  endDate: string;
};

/**
 * Aggregates guard attendance for a date range in a single server-side pass,
 * grouping persisted check-in/out events per employee per day. Shared by the
 * single-day and range field-officer endpoints.
 *
 * The caller validates date format/order and the requested-district
 * authorization; this function scopes its Firestore queries by district so the
 * result is already authorized. When `startDate === endDate` the output matches
 * the former single-day endpoint exactly.
 */
export async function aggregateGuardAttendance(
  input: GuardAttendanceRangeInput,
): Promise<GuardAttendanceEntry[]> {
  const {
    adminDb,
    isAdmin,
    assignedDistricts,
    requestedDistrict,
    startDate,
    endDate,
  } = input;

  let attendanceQuery: FirebaseFirestore.Query =
    adminDb.collection("attendanceLogs");
  if (startDate === endDate) {
    // Single-day path keeps the original exact-match query (and its
    // index-free behavior) when start === end.
    attendanceQuery = attendanceQuery.where("attendanceDate", "==", startDate);
  } else {
    attendanceQuery = attendanceQuery
      .where("attendanceDate", ">=", startDate)
      .where("attendanceDate", "<=", endDate);
  }
  if (requestedDistrict) {
    attendanceQuery = attendanceQuery.where(
      "district",
      "==",
      requestedDistrict,
    );
  } else if (!isAdmin) {
    attendanceQuery = attendanceQuery.where(
      "district",
      "in",
      assignedDistricts.slice(0, 30),
    );
  }

  const snapshot = await attendanceQuery.limit(8000).get();

  const logs = snapshot.docs
    .map(
      (doc) =>
        ({
          id: doc.id,
          ...(doc.data() as Record<string, unknown>),
        }) as AttendanceLog,
    )
    .filter((log) => {
      const district = normalizeText(log.district);
      if (requestedDistrict && !districtMatches(district, requestedDistrict)) {
        return false;
      }
      if (isAdmin) return true;
      return assignedDistricts.some((assigned) =>
        districtMatches(assigned, district),
      );
    })
    .sort((left, right) => {
      const leftMillis = Math.max(
        toMillis(left.reportedAt),
        toMillis(left.createdAt),
        toMillis(left.reportedAtClient),
      );
      const rightMillis = Math.max(
        toMillis(right.reportedAt),
        toMillis(right.createdAt),
        toMillis(right.reportedAtClient),
      );
      return leftMillis - rightMillis;
    });

  type InternalEntry = GuardAttendanceEntry & { _last: number };
  const grouped = new Map<string, InternalEntry>();

  for (const log of logs) {
    const status = normalizeText(log.status).toLowerCase();
    if (status !== "in" && status !== "out") continue;
    const punchTime = toTimeLabel(log.reportedAt || log.createdAt);
    if (!punchTime) continue;
    const employee = employeeKey(log);
    const sessionId = normalizeText(log.attendanceSessionId);
    const date = normalizeText(log.attendanceDate) || startDate;
    const key = `${employee}:${date}:${sessionId}`;
    if (!key) continue;

    const millis = Math.max(
      toMillis(log.reportedAt),
      toMillis(log.createdAt),
      toMillis(log.reportedAtClient),
    );

    let current = grouped.get(key);
    if (!current) {
      current = {
        id: key,
        guardName: normalizeText(log.employeeName) || "Guard",
        guardId: normalizeText(log.employeeId),
        employeeId: normalizeText(log.employeeId),
        siteName: normalizeText(log.siteName),
        clientName: normalizeText(log.clientName),
        district: normalizeText(log.district),
        date,
        checkIn: null,
        checkOut: null,
        dutyPointName: normalizeText(log.dutyPointName),
        shiftLabel: normalizeText(log.shiftLabel),
        status: "Absent",
        photoUrl:
          typeof log.photoUrl === "string" && log.photoUrl.trim().length > 0
            ? log.photoUrl
            : null,
        locationCoords:
          log.locationCoords && typeof log.locationCoords === "object"
            ? {
                lat: Number((log.locationCoords as { lat?: unknown }).lat ?? 0),
                lon: Number((log.locationCoords as { lon?: unknown }).lon ?? 0),
              }
            : null,
        distanceMeters:
          typeof log.distanceMeters === "number" ? log.distanceMeters : null,
        gpsAccuracyMeters:
          typeof log.gpsAccuracyMeters === "number"
            ? log.gpsAccuracyMeters
            : null,
        geofenceRadiusAtTime:
          typeof log.geofenceRadiusAtTime === "number"
            ? log.geofenceRadiusAtTime
            : null,
        isMockLocationSuspected: log.isMockLocationSuspected === true,
        mockLocationReason: normalizeText(log.mockLocationReason) || null,
        photoCompliance:
          log.photoCompliance && typeof log.photoCompliance === "object"
            ? (log.photoCompliance as Record<string, unknown>)
            : null,
        reviewStatus: normalizeText(log.reviewStatus) || null,
        requiresAdminReview: log.requiresAdminReview === true,
        _last: 0,
      };
      grouped.set(key, current);
    }

    if (status === "in" && !current.checkIn) {
      current.checkIn = punchTime;
    }
    if (status === "out" && !current.checkOut) {
      current.checkOut = punchTime;
    }

    if (millis >= current._last) {
      current.guardName = normalizeText(log.employeeName) || current.guardName;
      current.guardId = normalizeText(log.employeeId) || current.guardId;
      current.employeeId = normalizeText(log.employeeId) || current.employeeId;
      current.siteName = normalizeText(log.siteName) || current.siteName;
      current.clientName = normalizeText(log.clientName) || current.clientName;
      current.district = normalizeText(log.district) || current.district;
      current.dutyPointName =
        normalizeText(log.dutyPointName) || current.dutyPointName;
      current.shiftLabel = normalizeText(log.shiftLabel) || current.shiftLabel;
      current.photoUrl =
        (typeof log.photoUrl === "string" && log.photoUrl.trim().length > 0
          ? log.photoUrl
          : current.photoUrl) || null;
      if (log.locationCoords && typeof log.locationCoords === "object") {
        current.locationCoords = {
          lat: Number((log.locationCoords as { lat?: unknown }).lat ?? 0),
          lon: Number((log.locationCoords as { lon?: unknown }).lon ?? 0),
        };
      }
      current.distanceMeters =
        typeof log.distanceMeters === "number"
          ? log.distanceMeters
          : current.distanceMeters;
      current.gpsAccuracyMeters =
        typeof log.gpsAccuracyMeters === "number"
          ? log.gpsAccuracyMeters
          : current.gpsAccuracyMeters;
      current.geofenceRadiusAtTime =
        typeof log.geofenceRadiusAtTime === "number"
          ? log.geofenceRadiusAtTime
          : current.geofenceRadiusAtTime;
      current.isMockLocationSuspected =
        log.isMockLocationSuspected === true || current.isMockLocationSuspected;
      current.mockLocationReason =
        normalizeText(log.mockLocationReason) || current.mockLocationReason;
      if (log.photoCompliance && typeof log.photoCompliance === "object") {
        current.photoCompliance = log.photoCompliance as Record<
          string,
          unknown
        >;
      }
      current.reviewStatus =
        normalizeText(log.reviewStatus) || current.reviewStatus;
      current.requiresAdminReview =
        log.requiresAdminReview === true || current.requiresAdminReview;
      current._last = millis;
    }
  }

  for (const entry of grouped.values()) {
    entry.status =
      entry.checkOut != null
        ? "Checked out"
        : entry.checkIn != null
          ? "Present"
          : "Absent";
  }

  const attendance: GuardAttendanceEntry[] = Array.from(grouped.values());
  attendance.sort((left, right) => {
    const dateCmp = right.date.localeCompare(left.date);
    if (dateCmp !== 0) return dateCmp;
    return left.guardName.localeCompare(right.guardName);
  });

  return attendance;
}
