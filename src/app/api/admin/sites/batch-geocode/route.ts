import { NextResponse } from "next/server";

import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { lookupLocationGeocode } from "@/lib/server/location-geocode";
import { buildServerAuditEvent, buildServerUpdateAudit } from "@/lib/server/audit";

type BatchGeocodeResult = {
  siteId: string;
  siteName: string;
  clientName?: string;
  district?: string;
  siteAddress?: string;
  status: "updated" | "kept" | "failed" | "no_result" | "skipped";
  message: string;
  oldLat?: number;
  oldLng?: number;
  newLat?: number;
  newLng?: number;
};

function extractCoordinates(siteData: Record<string, any>) {
  const latitude =
    typeof siteData?.geolocation?.latitude === "number"
      ? siteData.geolocation.latitude
      : typeof siteData?.geolocation?.lat === "number"
        ? siteData.geolocation.lat
        : Number(siteData?.latString);
  const longitude =
    typeof siteData?.geolocation?.longitude === "number"
      ? siteData.geolocation.longitude
      : typeof siteData?.geolocation?.lng === "number"
        ? siteData.geolocation.lng
        : Number(siteData?.lngString);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue, GeoPoint } = await import("firebase-admin/firestore");
    const body = (await request.json().catch(() => ({}))) as {
      siteIds?: string[];
      includeGeocoded?: boolean;
    };

    const snapshot = await adminDb.collection("sites").get();
    const requestedIds = new Set((body.siteIds ?? []).filter(Boolean));

    const sites = snapshot.docs.filter((siteDoc) => {
      const siteData = siteDoc.data() as Record<string, any>;
      const coordinateStatus = String(siteData.coordinateStatus || "");
      const hasExplicitCoordinates = Boolean(extractCoordinates(siteData));
      const shouldInclude =
        requestedIds.size > 0
          ? requestedIds.has(siteDoc.id)
          : !hasExplicitCoordinates ||
            coordinateStatus === "missing" ||
            (body.includeGeocoded && coordinateStatus === "geocoded");
      return shouldInclude;
    });

    if (sites.length === 0) {
      return NextResponse.json({ results: [] satisfies BatchGeocodeResult[] });
    }

    const results: BatchGeocodeResult[] = [];
    let batch = adminDb.batch();
    let writes = 0;

    const flushBatch = async () => {
      if (!writes) return;
      await batch.commit();
      batch = adminDb.batch();
      writes = 0;
    };

    for (const siteDoc of sites) {
      const siteData = siteDoc.data() as Record<string, any>;
      const coords = extractCoordinates(siteData);
      const isLockedCoordinate =
        siteData.coordinateStatus === "verified" ||
        siteData.coordinateStatus === "overridden";

      if (coords && isLockedCoordinate) {
        results.push({
          siteId: siteDoc.id,
          siteName: siteData.siteName || siteDoc.id,
          clientName: siteData.clientName,
          district: siteData.district,
          siteAddress: siteData.siteAddress,
          status: "kept",
          message: "Skipped because coordinates are already verified.",
          oldLat: coords.latitude,
          oldLng: coords.longitude,
        });
        continue;
      }

      try {
        const geocode = await lookupLocationGeocode({
          address: siteData.siteAddress,
          district: siteData.district,
          entityType: "site",
        });

        batch.update(siteDoc.ref, {
          geolocation: new GeoPoint(geocode.lat, geocode.lng),
          latString: geocode.lat.toFixed(6),
          lngString: geocode.lng.toFixed(6),
          coordinateStatus: coords ? "overridden" : "geocoded",
          coordinateSource: "geocode",
          placeAccuracy: geocode.placeAccuracy ?? null,
          geocodedAt: new Date(),
          ...buildServerUpdateAudit({
            uid: adminUser.uid,
            email: adminUser.email,
          }),
          auditTrail: FieldValue.arrayUnion(
            buildServerAuditEvent("site_geocoded", adminUser, {
              siteId: siteDoc.id,
              siteName: siteData.siteName ?? null,
              previousCoordinateStatus: siteData.coordinateStatus ?? null,
            }),
          ),
        });
        writes += 1;

        results.push({
          siteId: siteDoc.id,
          siteName: siteData.siteName || siteDoc.id,
          clientName: siteData.clientName,
          district: siteData.district,
          siteAddress: siteData.siteAddress,
          status: "updated",
          message: "Coordinates updated from geocoding.",
          oldLat: coords?.latitude,
          oldLng: coords?.longitude,
          newLat: geocode.lat,
          newLng: geocode.lng,
        });

        if (writes >= 400) {
          await flushBatch();
        }
      } catch (error: any) {
        results.push({
          siteId: siteDoc.id,
          siteName: siteData.siteName || siteDoc.id,
          clientName: siteData.clientName,
          district: siteData.district,
          siteAddress: siteData.siteAddress,
          status: /no coordinates/i.test(error?.message || "") ? "no_result" : "failed",
          message: error?.message || "Unexpected geocoding error.",
          oldLat: coords?.latitude,
          oldLng: coords?.longitude,
        });
      }
    }

    await flushBatch();

    return NextResponse.json({ results });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
