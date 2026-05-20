import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { db } from "@/lib/firebaseAdmin";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseSiteCoordinates(siteData: Record<string, unknown>) {
  const geolocation = siteData.geolocation as
    | { latitude?: unknown; longitude?: unknown; lat?: unknown; lng?: unknown }
    | undefined;

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

export async function POST(request: Request) {
  try {
    const guard = await requireGuard(request);
    const body = (await request.json()) as {
      employeeId?: string;
      siteId?: string;
      lat?: number;
      lng?: number;
      accuracy?: number;
      distanceFromSite?: number;
      isOutOfZone?: boolean;
    };

    const siteId = normalizeText(body.siteId);
    if (!siteId) {
      return NextResponse.json({ error: "Site id is required." }, { status: 400 });
    }

    if (normalizeText(body.employeeId) && normalizeText(body.employeeId) != guard.employeeId) {
      return NextResponse.json({ error: "Employee mismatch." }, { status: 403 });
    }

    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "Valid coordinates are required." }, { status: 400 });
    }

    const [employeeDoc, attendanceStateDoc, siteDoc] = await Promise.all([
      db.collection("employees").doc(guard.employeeDocId).get(),
      db.collection("attendanceState").doc(guard.employeeDocId).get(),
      db.collection("sites").doc(siteId).get(),
    ]);

    if (!employeeDoc.exists) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    if (!siteDoc.exists) {
      return NextResponse.json({ error: "Site not found." }, { status: 404 });
    }

    const attendanceState = attendanceStateDoc.exists
      ? (attendanceStateDoc.data() as Record<string, unknown>)
      : null;
    if (attendanceState && normalizeText(attendanceState.lastStatus) === "Out") {
      return NextResponse.json(
        { error: "Live tracking is only available for active duty sessions." },
        { status: 409 },
      );
    }

    if (attendanceState && normalizeText(attendanceState.lastSiteId) && normalizeText(attendanceState.lastSiteId) !== siteId) {
      return NextResponse.json(
        { error: "Tracking site does not match the active attendance session." },
        { status: 409 },
      );
    }

    const employee = employeeDoc.data() as Record<string, unknown>;
    const site = siteDoc.data() as Record<string, unknown>;
    const accuracy = Number(body.accuracy);
    const geofenceRadius = Number(site.geofenceRadiusMeters ?? site.allowedRadiusMeters ?? 150);
    const siteCoords = parseSiteCoordinates(site);

    await db.collection("guardLocations").doc(guard.employeeId).set(
      {
        employeeId: guard.employeeId,
        guardName: normalizeText(
          employee.fullName ||
            employee.name ||
            [employee.firstName, employee.lastName].filter(Boolean).join(" ") ||
            guard.employeeId,
        ),
        siteId,
        siteName: normalizeText(site.siteName),
        clientName: normalizeText(site.clientName || employee.clientName),
        district: normalizeText(site.district || employee.district),
        lat,
        lng,
        accuracy: Number.isFinite(accuracy) ? accuracy : 0,
        isOutOfZone: body.isOutOfZone === true,
        distanceFromSite: Number.isFinite(Number(body.distanceFromSite))
          ? Number(body.distanceFromSite)
          : null,
        status: "In",
        attendanceId:
          normalizeText(attendanceState?.lastAttendanceId) ||
          normalizeText(attendanceState?.attendanceId) ||
          null,
        siteLat: siteCoords?.lat ?? null,
        siteLng: siteCoords?.lng ?? null,
        geofenceRadius: Number.isFinite(geofenceRadius) ? geofenceRadius : 150,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not update tracking heartbeat.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return unauthorizedResponse(message);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
