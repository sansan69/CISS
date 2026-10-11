import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import { db } from "@/lib/firebaseAdmin";
import {
  buildLocationHistoryBucketId,
  buildLocationHistoryExpiry,
  DEFAULT_LIVE_GPS_ACCURACY_LIMIT_METERS,
  isValidLatitude,
  isValidLongitude,
  resolveLiveLocation,
  type LiveLocationZoneStatus,
} from "@/lib/guard-tracking";

/**
 * Shared persistence core for guard live-location samples.
 *
 * Both the single-sample heartbeat route and the offline batch route funnel
 * through {@link persistGuardLocationSample} so the geofence maths, the
 * `guardLocations/{employeeDocId}` "current" write and the bucketed
 * `locationHistory` write stay identical between the live and queued paths.
 */

export type GuardIdentity = {
  uid: string;
  employeeId: string;
  employeeDocId: string;
};

export type GuardLocationSample = {
  siteId: string;
  lat: number;
  lng: number;
  accuracy: number;
  capturedAt?: string;
  batteryLevel?: number | null;
  speed?: number | null;
  wifiConnected?: boolean | null;
  networkType?: string | null;
  activity?: string | null;
  isMock?: boolean | null;
  isGPSOn?: boolean | null;
  altitude?: number | null;
  bearing?: number | null;
  locationAccuracy?: number | null;
  batteryPercentage?: number | null;
};

export type GuardTrackingIdentity = {
  employee: Record<string, unknown>;
  attendanceState: Record<string, unknown>;
  activeSiteId: string;
  openSessionId: string;
};

export type GuardTrackingSessionContext = {
  site: Record<string, unknown>;
  siteCoords: { lat: number; lng: number };
  sourceCollection: "sites" | "clientLocations";
  geofenceRadius: number;
  accuracyLimit: number;
};

export type GuardTrackingContext = GuardTrackingIdentity &
  GuardTrackingSessionContext;

export type PersistFailure = { ok: false; status: number; error: string };
export type GuardLocationPersistSuccess = {
  ok: true;
  siteId: string;
  distanceFromSite: number;
  zoneStatus: LiveLocationZoneStatus;
  gpsReliable: boolean;
  updatedAt: Date;
};
export type GuardLocationPersistResult =
  | GuardLocationPersistSuccess
  | PersistFailure;

export type GuardTrackingIdentityResult =
  | { ok: true; value: GuardTrackingIdentity }
  | PersistFailure;
export type GuardTrackingSessionResult =
  | { ok: true; value: GuardTrackingSessionContext }
  | PersistFailure;

const DEFAULT_CAPTURE_DRIFT_MS = 10 * 60 * 1000;

export function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function parseCoordinates(input?: Record<string, unknown> | null) {
  if (!input) return null;
  const geolocation = input.geolocation as
    | { latitude?: unknown; longitude?: unknown; lat?: unknown; lng?: unknown }
    | undefined;

  const lat =
    typeof geolocation?.latitude === "number"
      ? geolocation.latitude
      : typeof geolocation?.lat === "number"
        ? geolocation.lat
        : typeof input.latitude === "number"
          ? input.latitude
          : typeof input.lat === "number"
            ? input.lat
            : Number(input.latString);
  const lng =
    typeof geolocation?.longitude === "number"
      ? geolocation.longitude
      : typeof geolocation?.lng === "number"
        ? geolocation.lng
        : typeof input.longitude === "number"
          ? input.longitude
          : typeof input.lng === "number"
            ? input.lng
            : Number(input.lngString);

  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return null;
  }

  return { lat, lng };
}

/**
 * Parse a client-supplied capture timestamp. Frames outside
 * `maxDriftMs` of server time are discarded so a wildly wrong device clock
 * cannot poison history buckets.
 */
export function parseCapturedAt(
  value?: string,
  maxDriftMs = DEFAULT_CAPTURE_DRIFT_MS,
) {
  if (!value) return null;
  const capturedAt = new Date(value);
  if (Number.isNaN(capturedAt.getTime())) return null;
  const driftMs = Math.abs(Date.now() - capturedAt.getTime());
  return driftMs <= maxDriftMs ? capturedAt : null;
}

/** AMS-named tracking fields accepted alongside the legacy heartbeat shape. */
export const guardLocationAmsFieldsSchema = {
  activity: z.string().trim().max(64).nullable().optional(),
  isMock: z.boolean().nullable().optional(),
  isGPSOn: z.boolean().nullable().optional(),
  altitude: z.number().finite().nullable().optional(),
  bearing: z.number().finite().nullable().optional(),
  locationAccuracy: z
    .number()
    .finite()
    .positive()
    .max(5_000)
    .nullable()
    .optional(),
  batteryPercentage: z.number().int().min(0).max(100).nullable().optional(),
};

const guardLocationSampleSchema = z.object({
  siteId: z.string().trim().min(1).max(160),
  lat: z.number().finite().min(-90).max(90).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  accuracy: z.number().finite().positive().max(5_000),
  capturedAt: z.string().datetime().optional(),
  batteryLevel: z.number().finite().min(0).max(1).nullable().optional(),
  speed: z.number().finite().min(0).max(150).nullable().optional(),
  wifiConnected: z.boolean().nullable().optional(),
  networkType: z.string().trim().max(32).nullable().optional(),
  ...guardLocationAmsFieldsSchema,
});

/**
 * Validate and normalise one raw sample (accepting `lat`/`latitude` and
 * `lng`/`longitude` aliases). Returns `null` when the sample is unusable.
 */
export function toGuardLocationSample(value: unknown): GuardLocationSample | null {
  const parsed = guardLocationSampleSchema.safeParse(value);
  if (!parsed.success) return null;

  const data = parsed.data;
  const lat = data.lat ?? data.latitude;
  const lng = data.lng ?? data.longitude;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !isValidLatitude(lat) ||
    !isValidLongitude(lng)
  ) {
    return null;
  }

  return {
    siteId: data.siteId,
    lat,
    lng,
    accuracy: data.accuracy,
    capturedAt: data.capturedAt,
    batteryLevel: data.batteryLevel ?? null,
    speed: data.speed ?? null,
    wifiConnected: data.wifiConnected ?? null,
    networkType: data.networkType ?? null,
    activity: normalizeText(data.activity) || null,
    isMock: data.isMock ?? null,
    isGPSOn: data.isGPSOn ?? null,
    altitude: data.altitude ?? null,
    bearing: data.bearing ?? null,
    locationAccuracy: data.locationAccuracy ?? null,
    batteryPercentage: data.batteryPercentage ?? null,
  };
}

function resolveBatteryPercentage(sample: GuardLocationSample) {
  if (typeof sample.batteryPercentage === "number") {
    return sample.batteryPercentage;
  }
  if (
    typeof sample.batteryLevel === "number" &&
    sample.batteryLevel >= 0 &&
    sample.batteryLevel <= 1
  ) {
    return Math.round(sample.batteryLevel * 100);
  }
  return null;
}

function parseRadius(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolve the guard's employee record plus open IN attendance state
 * (employee + attendanceState reads).
 */
export async function resolveGuardTrackingIdentity(
  guard: GuardIdentity,
): Promise<GuardTrackingIdentityResult> {
  const [employeeDoc, attendanceStateDoc] = await Promise.all([
    db.collection("employees").doc(guard.employeeDocId).get(),
    db.collection("attendanceState").doc(guard.employeeDocId).get(),
  ]);

  if (!employeeDoc.exists) {
    return { ok: false, status: 404, error: "Employee not found." };
  }

  if (!attendanceStateDoc.exists) {
    return {
      ok: false,
      status: 409,
      error: "Mark IN before starting live location sharing.",
    };
  }

  const attendanceState = attendanceStateDoc.data() as Record<string, unknown>;
  const activeSiteId = normalizeText(attendanceState.lastSiteId);
  const openSessionId = normalizeText(attendanceState.openSessionId);
  if (
    normalizeText(attendanceState.lastStatus) !== "In" ||
    !activeSiteId ||
    !openSessionId
  ) {
    return {
      ok: false,
      status: 409,
      error: "Live location sharing requires an open IN session.",
    };
  }

  const employee = employeeDoc.data() as Record<string, unknown>;
  return {
    ok: true,
    value: { employee, attendanceState, activeSiteId, openSessionId },
  };
}

/**
 * Resolve the open session, its source site and the geofence configuration
 * (session + attendanceLog + site reads).
 */
export async function resolveGuardTrackingSession(
  guard: GuardIdentity,
  identity: GuardTrackingIdentity,
): Promise<GuardTrackingSessionResult> {
  const [sessionDoc, attendanceLogDoc] = await Promise.all([
    db.collection("attendanceSessions").doc(identity.openSessionId).get(),
    db.collection("attendanceLogs").doc(identity.openSessionId).get(),
  ]);

  if (!sessionDoc.exists) {
    return {
      ok: false,
      status: 409,
      error: "The open attendance session could not be verified.",
    };
  }

  const session = sessionDoc.data() as Record<string, unknown>;
  if (
    normalizeText(session.status) !== "open" ||
    normalizeText(session.employeeDocId) !== guard.employeeDocId ||
    normalizeText(session.siteId) !== identity.activeSiteId
  ) {
    return {
      ok: false,
      status: 409,
      error: "The active attendance session is no longer valid.",
    };
  }

  const sourceCollection =
    normalizeText(session.sourceCollection) === "clientLocations"
      ? "clientLocations"
      : "sites";
  const siteDoc = await db
    .collection(sourceCollection)
    .doc(identity.activeSiteId)
    .get();
  if (!siteDoc.exists) {
    return { ok: false, status: 404, error: "Site not found." };
  }

  const site = siteDoc.data() as Record<string, unknown>;
  const attendanceLog = attendanceLogDoc.exists
    ? (attendanceLogDoc.data() as Record<string, unknown>)
    : {};
  const siteCoords =
    parseCoordinates(attendanceLog.siteCoords as Record<string, unknown>) ??
    parseCoordinates(site);
  if (!siteCoords) {
    return {
      ok: false,
      status: 409,
      error:
        "This duty site does not have verified coordinates. Contact your supervisor.",
    };
  }

  const geofenceRadius = parseRadius(
    attendanceLog.geofenceRadiusAtTime ??
      site.geofenceRadiusMeters ??
      site.allowedRadiusMeters,
    150,
  );
  const accuracyLimit = parseRadius(
    process.env.GPS_ACCURACY_LIMIT_METERS,
    DEFAULT_LIVE_GPS_ACCURACY_LIMIT_METERS,
  );

  return {
    ok: true,
    value: { site, siteCoords, sourceCollection, geofenceRadius, accuracyLimit },
  };
}

export type PersistGuardLocationSampleParams = {
  guard: GuardIdentity;
  sample: GuardLocationSample;
  now: Timestamp;
  /** Pre-resolved context (batch path). When omitted it is resolved here. */
  context?: GuardTrackingContext;
  /** Bucket time for `locationHistory`; defaults to server `now`. */
  bucketAt?: Date;
  trackingSource?: string;
  /** Max client-clock drift accepted for `capturedAt`. */
  captureDriftMs?: number;
};

/**
 * Persist one validated sample: verify the open IN session, compute the
 * server-authoritative zone status, then write the current location doc and a
 * bucketed history entry. Returns the same failure codes the heartbeat route
 * historically surfaced (404/409).
 */
export async function persistGuardLocationSample({
  guard,
  sample,
  now,
  context,
  bucketAt,
  trackingSource = "guard_portal",
  captureDriftMs = DEFAULT_CAPTURE_DRIFT_MS,
}: PersistGuardLocationSampleParams): Promise<GuardLocationPersistResult> {
  let ctx: GuardTrackingContext;

  if (context) {
    ctx = context;
  } else {
    const identityResult = await resolveGuardTrackingIdentity(guard);
    if (!identityResult.ok) return identityResult;
    const identity = identityResult.value;

    if (sample.siteId !== identity.activeSiteId) {
      return {
        ok: false,
        status: 409,
        error:
          "The tracking site does not match your open attendance session.",
      };
    }

    const sessionResult = await resolveGuardTrackingSession(guard, identity);
    if (!sessionResult.ok) return sessionResult;
    ctx = { ...identity, ...sessionResult.value };
  }

  if (sample.siteId !== ctx.activeSiteId) {
    return {
      ok: false,
      status: 409,
      error: "The tracking site does not match your open attendance session.",
    };
  }

  const { employee, site, siteCoords, geofenceRadius, accuracyLimit } = ctx;

  const resolved = resolveLiveLocation({
    guardLat: sample.lat,
    guardLng: sample.lng,
    accuracyMeters: sample.accuracy,
    siteLat: siteCoords.lat,
    siteLng: siteCoords.lng,
    geofenceRadiusMeters: geofenceRadius,
    accuracyLimitMeters: accuracyLimit,
  });

  const locationData: Record<string, unknown> = {
    employeeDocId: guard.employeeDocId,
    employeeId: guard.employeeId,
    guardName: normalizeText(
      employee.fullName ||
        employee.name ||
        [employee.firstName, employee.lastName].filter(Boolean).join(" ") ||
        guard.employeeId,
    ),
    siteId: ctx.activeSiteId,
    siteName: normalizeText(site.siteName),
    clientName: normalizeText(site.clientName || employee.clientName),
    employeeClientName: normalizeText(employee.clientName) || null,
    siteClientName: normalizeText(site.clientName) || null,
    district: normalizeText(site.district || employee.district),
    lat: sample.lat,
    lng: sample.lng,
    accuracy: sample.accuracy,
    accuracyLimit,
    gpsReliable: resolved.hasReliableAccuracy,
    distanceFromSite: resolved.distanceFromSite,
    zoneStatus: resolved.zoneStatus,
    isOutOfZone: resolved.isOutOfZone,
    status: "In",
    attendanceId: normalizeText(ctx.attendanceState.lastAttendanceId) || null,
    attendanceSessionId: ctx.openSessionId,
    siteLat: siteCoords.lat,
    siteLng: siteCoords.lng,
    geofenceRadius,
    batteryLevel: sample.batteryLevel ?? null,
    batteryPercentage: resolveBatteryPercentage(sample),
    speed: sample.speed ?? null,
    wifiConnected: sample.wifiConnected ?? null,
    networkType: normalizeText(sample.networkType) || null,
    activity: sample.activity ?? null,
    isMock: sample.isMock ?? null,
    isGPSOn: sample.isGPSOn ?? null,
    altitude: sample.altitude ?? null,
    bearing: sample.bearing ?? null,
    locationAccuracy: sample.locationAccuracy ?? null,
    trackingSource,
  };

  const nowDate = now.toDate();
  const historyAt = bucketAt ?? nowDate;
  locationData.updatedAt = now;
  locationData.serverReceivedAt = now;
  const capturedAt = parseCapturedAt(sample.capturedAt, captureDriftMs);
  locationData.clientCapturedAt = capturedAt
    ? Timestamp.fromDate(capturedAt)
    : null;

  const guardLocRef = db.collection("guardLocations").doc(guard.employeeDocId);
  const batch = db.batch();
  batch.set(guardLocRef, locationData, { merge: true });
  batch.set(
    guardLocRef
      .collection("locationHistory")
      .doc(buildLocationHistoryBucketId(ctx.openSessionId, historyAt)),
    {
      employeeDocId: guard.employeeDocId,
      employeeId: guard.employeeId,
      attendanceSessionId: ctx.openSessionId,
      siteId: ctx.activeSiteId,
      siteName: locationData.siteName,
      clientName: locationData.clientName,
      district: locationData.district,
      lat: sample.lat,
      lng: sample.lng,
      accuracy: sample.accuracy,
      gpsReliable: resolved.hasReliableAccuracy,
      distanceFromSite: resolved.distanceFromSite,
      zoneStatus: resolved.zoneStatus,
      isOutOfZone: resolved.isOutOfZone,
      speed: sample.speed ?? null,
      batteryLevel: locationData.batteryLevel,
      batteryPercentage: locationData.batteryPercentage,
      wifiConnected: sample.wifiConnected ?? null,
      networkType: normalizeText(sample.networkType) || null,
      activity: sample.activity ?? null,
      isMock: sample.isMock ?? null,
      isGPSOn: sample.isGPSOn ?? null,
      altitude: sample.altitude ?? null,
      bearing: sample.bearing ?? null,
      locationAccuracy: sample.locationAccuracy ?? null,
      clientCapturedAt: locationData.clientCapturedAt,
      recordedAt: now,
      expiresAt: Timestamp.fromDate(buildLocationHistoryExpiry(historyAt)),
    },
    { merge: true },
  );
  await batch.commit();

  return {
    ok: true,
    siteId: ctx.activeSiteId,
    distanceFromSite: resolved.distanceFromSite,
    zoneStatus: resolved.zoneStatus,
    gpsReliable: resolved.hasReliableAccuracy,
    updatedAt: nowDate,
  };
}
