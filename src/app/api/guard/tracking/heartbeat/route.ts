import { NextResponse } from "next/server";
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
} from "@/lib/guard-tracking";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
import {
  buildRateLimitKey,
  checkRateLimit,
} from "@/lib/server/rate-limit";
export const runtime = "nodejs";

const heartbeatSchema = z.object({
  siteId: z.string().trim().min(1).max(160),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().positive().max(5_000),
  capturedAt: z.string().datetime().optional(),
  batteryLevel: z.number().finite().min(0).max(1).nullable().optional(),
  speed: z.number().finite().min(0).max(150).nullable().optional(),
});

const HEARTBEAT_RATE_LIMIT = {
  maxRequests: 30,
  windowMs: 10 * 60 * 1000,
  failClosed: true,
} as const;

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseCoordinates(input?: Record<string, unknown> | null) {
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

function parseCapturedAt(value?: string) {
  if (!value) return null;
  const capturedAt = new Date(value);
  if (Number.isNaN(capturedAt.getTime())) return null;
  const driftMs = Math.abs(Date.now() - capturedAt.getTime());
  return driftMs <= 10 * 60 * 1000 ? capturedAt : null;
}

export async function POST(request: Request) {
  try {
    const guard = await requireGuard(request);
    const rateLimit = await checkRateLimit(
      buildRateLimitKey("guard-heartbeat", guard.uid),
      HEARTBEAT_RATE_LIMIT,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Location updates are arriving too quickly. Please wait." },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.ceil(HEARTBEAT_RATE_LIMIT.windowMs / 1000),
            ),
          },
        },
      );
    }

    const parsed = heartbeatSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            "A valid live location and GPS accuracy are required.",
        },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const [employeeDoc, attendanceStateDoc] = await Promise.all([
      db.collection("employees").doc(guard.employeeDocId).get(),
      db.collection("attendanceState").doc(guard.employeeDocId).get(),
    ]);

    if (!employeeDoc.exists) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    if (!attendanceStateDoc.exists) {
      return NextResponse.json(
        { error: "Mark IN before starting live location sharing." },
        { status: 409 },
      );
    }

    const attendanceState =
      attendanceStateDoc.data() as Record<string, unknown>;
    const activeSiteId = normalizeText(attendanceState.lastSiteId);
    const openSessionId = normalizeText(attendanceState.openSessionId);
    if (
      normalizeText(attendanceState.lastStatus) !== "In" ||
      !activeSiteId ||
      !openSessionId
    ) {
      return NextResponse.json(
        { error: "Live location sharing requires an open IN session." },
        { status: 409 },
      );
    }

    if (body.siteId !== activeSiteId) {
      return NextResponse.json(
        {
          error:
            "The tracking site does not match your open attendance session.",
        },
        { status: 409 },
      );
    }

    const [sessionDoc, attendanceLogDoc] = await Promise.all([
      db.collection("attendanceSessions").doc(openSessionId).get(),
      db.collection("attendanceLogs").doc(openSessionId).get(),
    ]);
    if (!sessionDoc.exists) {
      return NextResponse.json(
        { error: "The open attendance session could not be verified." },
        { status: 409 },
      );
    }
    const session = sessionDoc.data() as Record<string, unknown>;
    if (
      normalizeText(session.status) !== "open" ||
      normalizeText(session.employeeDocId) !== guard.employeeDocId ||
      normalizeText(session.siteId) !== activeSiteId
    ) {
      return NextResponse.json(
        { error: "The active attendance session is no longer valid." },
        { status: 409 },
      );
    }

    const sourceCollection =
      normalizeText(session.sourceCollection) === "clientLocations"
        ? "clientLocations"
        : "sites";
    const siteDoc = await db
      .collection(sourceCollection)
      .doc(activeSiteId)
      .get();
    if (!siteDoc.exists) {
      return NextResponse.json({ error: "Site not found." }, { status: 404 });
    }

    const employee = employeeDoc.data() as Record<string, unknown>;
    const site = siteDoc.data() as Record<string, unknown>;
    const attendanceLog = attendanceLogDoc.exists
      ? (attendanceLogDoc.data() as Record<string, unknown>)
      : {};
    const siteCoords =
      parseCoordinates(attendanceLog.siteCoords as Record<string, unknown>) ??
      parseCoordinates(site);
    if (!siteCoords) {
      return NextResponse.json(
        {
          error:
            "This duty site does not have verified coordinates. Contact your supervisor.",
        },
        { status: 409 },
      );
    }

    const configuredRadius = Number(
      attendanceLog.geofenceRadiusAtTime ??
        site.geofenceRadiusMeters ??
        site.allowedRadiusMeters ??
        150,
    );
    const geofenceRadius =
      Number.isFinite(configuredRadius) && configuredRadius > 0
        ? configuredRadius
        : 150;
    const configuredAccuracyLimit = Number(
      process.env.GPS_ACCURACY_LIMIT_METERS ??
        DEFAULT_LIVE_GPS_ACCURACY_LIMIT_METERS,
    );
    const accuracyLimit =
      Number.isFinite(configuredAccuracyLimit) &&
      configuredAccuracyLimit > 0
        ? configuredAccuracyLimit
        : DEFAULT_LIVE_GPS_ACCURACY_LIMIT_METERS;
    const resolved = resolveLiveLocation({
      guardLat: body.lat,
      guardLng: body.lng,
      accuracyMeters: body.accuracy,
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
      siteId: activeSiteId,
      siteName: normalizeText(site.siteName),
      clientName: normalizeText(site.clientName || employee.clientName),
      employeeClientName: normalizeText(employee.clientName) || null,
      siteClientName: normalizeText(site.clientName) || null,
      district: normalizeText(site.district || employee.district),
      lat: body.lat,
      lng: body.lng,
      accuracy: body.accuracy,
      accuracyLimit,
      gpsReliable: resolved.hasReliableAccuracy,
      distanceFromSite: resolved.distanceFromSite,
      zoneStatus: resolved.zoneStatus,
      isOutOfZone: resolved.isOutOfZone,
      status: "In",
      attendanceId: normalizeText(attendanceState.lastAttendanceId) || null,
      attendanceSessionId: openSessionId,
      siteLat: siteCoords.lat,
      siteLng: siteCoords.lng,
      geofenceRadius,
      batteryLevel: body.batteryLevel ?? null,
      speed: body.speed ?? null,
      trackingSource: "guard_portal",
    };

    const nowDate = new Date();
    const now = Timestamp.now();
    locationData.updatedAt = now;
    locationData.serverReceivedAt = now;
    const capturedAt = parseCapturedAt(body.capturedAt);
    locationData.clientCapturedAt = capturedAt
      ? Timestamp.fromDate(capturedAt)
      : null;

    const guardLocRef = db.collection("guardLocations").doc(guard.employeeDocId);
    const batch = db.batch();
    batch.set(guardLocRef, locationData, { merge: true });
    batch.set(
      guardLocRef
        .collection("locationHistory")
        .doc(buildLocationHistoryBucketId(openSessionId, nowDate)),
      {
        employeeDocId: guard.employeeDocId,
        employeeId: guard.employeeId,
        attendanceSessionId: openSessionId,
        siteId: activeSiteId,
        siteName: locationData.siteName,
        clientName: locationData.clientName,
        district: locationData.district,
        lat: body.lat,
        lng: body.lng,
        accuracy: body.accuracy,
        gpsReliable: resolved.hasReliableAccuracy,
        distanceFromSite: resolved.distanceFromSite,
        zoneStatus: resolved.zoneStatus,
        isOutOfZone: resolved.isOutOfZone,
        speed: body.speed ?? null,
        batteryLevel: locationData.batteryLevel,
        clientCapturedAt: locationData.clientCapturedAt,
        recordedAt: now,
        expiresAt: Timestamp.fromDate(buildLocationHistoryExpiry(nowDate)),
      },
      { merge: true },
    );
    await batch.commit();

    return NextResponse.json({
      success: true,
      siteId: activeSiteId,
      distanceFromSite: Math.round(resolved.distanceFromSite),
      zoneStatus: resolved.zoneStatus,
      gpsReliable: resolved.hasReliableAccuracy,
      updatedAt: now.toDate().toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid live location payload." },
        { status: 400 },
      );
    }
    const message =
      error instanceof Error
        ? error.message
        : "Could not update tracking heartbeat.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return unauthorizedResponse(message);
    }
    console.error("[guard/tracking/heartbeat]", error);
    return NextResponse.json(
      { error: "Live location could not be saved. Please try again." },
      { status: 500 },
    );
  }
}
