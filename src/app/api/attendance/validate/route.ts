import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import {
  resolveSiteDutyPoints,
  resolveSiteShift,
} from "@/lib/shift-utils";
import { districtMatches } from "@/lib/districts";
import { DEFAULT_GEOFENCE_RADIUS_METERS } from "@/lib/constants";
import { haversineDistanceMeters } from "@/lib/geo";

export const runtime = "nodejs";

/**
 * POST /api/attendance/validate
 * Pre-flight check before attendance submission.
 * Returns whether the guard can mark attendance now, along with
 * resolved shift, duty point, and geofence status.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const employeeDocId = String(body.employeeDocId ?? "");
    const siteId = String(body.siteId ?? "");
    const sourceCollection = String(body.sourceCollection ?? "sites");
    const status = body.status === "Out" ? "Out" : "In";
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    const dutyPointId = body.dutyPointId ? String(body.dutyPointId) : undefined;

    if (!employeeDocId || !siteId || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json(
        { error: "Missing required fields: employeeDocId, siteId, lat, lon." },
        { status: 400 },
      );
    }

    const sourceCol = sourceCollection === "clientLocations" ? "clientLocations" : "sites";

    const [employeeSnap, siteSnap, stateSnap] = await Promise.all([
      db.collection("employees").doc(employeeDocId).get(),
      db.collection(sourceCol).doc(siteId).get(),
      db.collection("attendanceState").doc(employeeDocId).get(),
    ]);

    if (!employeeSnap.exists) {
      return NextResponse.json({ canSubmit: false, reason: "Employee not found." }, { status: 404 });
    }
    if (!siteSnap.exists) {
      return NextResponse.json({ canSubmit: false, reason: "Site not found." }, { status: 404 });
    }

    const employeeData = employeeSnap.data() as Record<string, any>;
    const siteData = siteSnap.data() as Record<string, any>;
    const stateData = stateSnap.exists ? (stateSnap.data() as Record<string, any>) : null;

    if (employeeData.status && employeeData.status !== "Active") {
      return NextResponse.json({
        canSubmit: false,
        reason: "Employee account is inactive.",
      });
    }

    if (!districtMatches(siteData.district, employeeData.district)) {
      return NextResponse.json({
        canSubmit: false,
        reason: "Site district does not match employee district.",
      });
    }

    // Resolve site coordinates
    const geolocation = siteData.geolocation as { latitude?: number; longitude?: number } | undefined;
    const siteLat =
      typeof geolocation?.latitude === "number"
        ? geolocation.latitude
        : typeof siteData.lat === "number"
          ? siteData.lat
          : Number(siteData.latString);
    const siteLng =
      typeof geolocation?.longitude === "number"
        ? geolocation.longitude
        : typeof siteData.lng === "number"
          ? siteData.lng
          : Number(siteData.lngString);

    if (!Number.isFinite(siteLat) || !Number.isFinite(siteLng)) {
      return NextResponse.json({
        canSubmit: false,
        reason: "Site GPS coordinates are not configured.",
      });
    }

    // Resolve duty point and shift
    const configuredDutyPoints =
      sourceCol === "sites" ? resolveSiteDutyPoints(siteData as any) : [];
    const selectedDutyPoint = dutyPointId
      ? configuredDutyPoints.find((p) => p.id === dutyPointId)
      : configuredDutyPoints.length === 1
        ? configuredDutyPoints[0]
        : null;

    const shiftMode: "fixed" | "none" = selectedDutyPoint
      ? selectedDutyPoint.shiftMode
      : siteData.shiftMode === "fixed"
        ? "fixed"
        : "none";
    const shiftTemplates = selectedDutyPoint
      ? selectedDutyPoint.shiftTemplates
      : Array.isArray(siteData.shiftTemplates)
        ? siteData.shiftTemplates
        : [];

    const resolvedShift = resolveSiteShift(
      shiftMode,
      shiftTemplates,
      new Date(),
    );

    // Geofence check
    const distance = haversineDistanceMeters(lat, lon, siteLat, siteLng);
    const radius =
      selectedDutyPoint?.geofenceRadiusMeters ??
      siteData.geofenceRadiusMeters ??
      DEFAULT_GEOFENCE_RADIUS_METERS;
    const isOutOfZone = distance > radius;

    // State machine check
    let stateCheck: { ok: boolean; reason?: string } = { ok: true };
    if (status === "In") {
      if (stateData?.lastStatus === "In" && stateData?.lastAttendanceDate === new Date().toISOString().slice(0, 10)) {
        stateCheck = { ok: false, reason: "Already clocked IN today." };
      }
    } else {
      if (!stateData || stateData.lastStatus !== "In") {
        stateCheck = { ok: false, reason: "No open IN session to check out from." };
      }
    }

    return NextResponse.json({
      canSubmit: true,
      warnings: {
        outOfZone: isOutOfZone,
        outOfZoneDistance: Math.round(distance),
        geofenceRadius: radius,
        stateConflict: !stateCheck.ok,
        stateConflictReason: stateCheck.reason,
      },
      resolved: {
        dutyPointId: selectedDutyPoint?.id ?? null,
        dutyPointName: selectedDutyPoint?.name ?? null,
        shiftCode: resolvedShift?.code ?? null,
        shiftLabel: resolvedShift?.label ?? null,
        shiftStartTime: resolvedShift?.startTime ?? null,
        shiftEndTime: resolvedShift?.endTime ?? null,
      },
      employee: {
        employeeId: employeeData.employeeId ?? "",
        fullName: employeeData.fullName || employeeData.name || "",
        clientName: employeeData.clientName ?? "",
        district: employeeData.district ?? "",
      },
      site: {
        siteName: siteData.siteName ?? "",
        clientName: siteData.clientName ?? "",
        district: siteData.district ?? "",
      },
    });
  } catch (error: any) {
    console.error("Attendance validation failed:", error);
    return NextResponse.json(
      { canSubmit: false, error: error?.message || "Validation failed." },
      { status: 500 },
    );
  }
}
