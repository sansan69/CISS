import { NextResponse } from "next/server";

import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerAuditEvent, buildServerUpdateAudit } from "@/lib/server/audit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminUser = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue, GeoPoint } = await import("firebase-admin/firestore");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      lat?: number;
      lng?: number;
      address?: string;
      district?: string;
      coordinateSource?: "manual" | "map_pin" | "current_location" | "geocode";
      placeAccuracy?: string | null;
      geofenceRadiusMeters?: number;
      strictGeofence?: boolean;
    };

    const patch: Record<string, unknown> = {
      ...buildServerUpdateAudit({
        uid: adminUser.uid,
        email: adminUser.email,
      }),
      auditTrail: FieldValue.arrayUnion(
        buildServerAuditEvent("site_coordinates_verified", adminUser, {
          siteId: id,
        }),
      ),
    };

    if (typeof body.lat === "number" && typeof body.lng === "number") {
      patch.geolocation = new GeoPoint(body.lat, body.lng);
      patch.latString = body.lat.toFixed(6);
      patch.lngString = body.lng.toFixed(6);
      patch.coordinateStatus =
        body.coordinateSource === "manual" || body.coordinateSource === "map_pin"
          ? "overridden"
          : "verified";
      patch.coordinateSource = body.coordinateSource ?? "manual";
      patch.geocodedAt = new Date();
    } else {
      patch.coordinateStatus = "verified";
    }

    if (typeof body.address === "string") {
      patch.siteAddress = body.address.trim();
    }
    if (typeof body.district === "string") {
      patch.district = body.district.trim();
    }
    if (typeof body.placeAccuracy === "string" || body.placeAccuracy === null) {
      patch.placeAccuracy = body.placeAccuracy;
    }
    if (typeof body.geofenceRadiusMeters === "number" && Number.isFinite(body.geofenceRadiusMeters)) {
      patch.geofenceRadiusMeters = Math.max(1, Math.round(body.geofenceRadiusMeters));
    }
    if (typeof body.strictGeofence === "boolean") {
      patch.strictGeofence = body.strictGeofence;
    }

    await adminDb.collection("sites").doc(id).update(patch);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
