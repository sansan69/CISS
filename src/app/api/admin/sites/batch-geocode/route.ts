import { NextResponse } from "next/server";

import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { lookupLocationGeocode } from "@/lib/server/location-geocode";
import { buildServerAuditEvent, buildServerUpdateAudit } from "@/lib/server/audit";
import {
  classifySiteGpsState,
  extractSiteCoordinates,
  normalizeIndianStateName,
} from "@/lib/site-gps-repair";

export type BatchGeocodeResult = {
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

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue, GeoPoint } = await import("firebase-admin/firestore");

    const body = (await request.json().catch(() => ({}))) as {
      /** Restrict to a specific client. */
      clientId?: string;
      /** Explicit list of site document IDs to process. */
      siteIds?: string[];
      /** Also re-geocode sites with coordinates that fall outside India's bounding box. */
      includeInvalid?: boolean;
      /** Also re-geocode sites with coordinateStatus === "geocoded". */
      includeGeocoded?: boolean;
    };

    // Build query — if clientId given, filter by it.
    let snapshotQuery: FirebaseFirestore.Query = adminDb.collection("sites");
    if (body.clientId) {
      snapshotQuery = snapshotQuery.where("clientId", "==", body.clientId);
    }
    const snapshot = await snapshotQuery.get();

    const requestedIds = new Set((body.siteIds ?? []).filter(Boolean));

    const sites = snapshot.docs.filter((siteDoc) => {
      const siteData = siteDoc.data() as Record<string, any>;
      const gpsState = classifySiteGpsState(siteData);

      if (requestedIds.size > 0) return requestedIds.has(siteDoc.id);

      if (gpsState === "missing_coords" || gpsState === "missing_status") return true;
      if (body.includeInvalid && gpsState === "invalid_coords") return true;
      if (body.includeGeocoded && siteData.coordinateStatus === "geocoded") return true;
      return false;
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
      const coords = extractSiteCoordinates(siteData);
      const gpsState = classifySiteGpsState(siteData);
      const isLockedCoordinate =
        siteData.coordinateStatus === "verified" ||
        siteData.coordinateStatus === "overridden";

      if (gpsState === "ok" && coords && isLockedCoordinate) {
        results.push({
          siteId: siteDoc.id,
          siteName: siteData.siteName || siteDoc.id,
          clientName: siteData.clientName,
          district: siteData.district,
          siteAddress: siteData.siteAddress,
          status: "kept",
          message: "Skipped — coordinates are already verified or manually overridden.",
          oldLat: coords.lat,
          oldLng: coords.lng,
        });
        continue;
      }

      if (gpsState === "missing_status" && coords && !siteData.siteAddress?.trim()) {
        batch.update(siteDoc.ref, {
          geolocation: new GeoPoint(coords.lat, coords.lng),
          latString: siteData.latString || coords.lat.toFixed(6),
          lngString: siteData.lngString || coords.lng.toFixed(6),
          coordinateStatus: "verified",
          coordinateSource: siteData.coordinateSource || "manual",
          ...(normalizeIndianStateName(siteData.state) && normalizeIndianStateName(siteData.state) !== siteData.state
            ? { state: normalizeIndianStateName(siteData.state) }
            : {}),
          ...buildServerUpdateAudit({
            uid: adminUser.uid,
            email: adminUser.email,
          }),
          auditTrail: FieldValue.arrayUnion(
            buildServerAuditEvent("site_coordinate_status_repaired", adminUser, {
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
          message: "Existing coordinates kept because no address was available for re-geocoding.",
          oldLat: coords.lat,
          oldLng: coords.lng,
          newLat: coords.lat,
          newLng: coords.lng,
        });

        if (writes >= 400) {
          await flushBatch();
        }
        continue;
      }

      try {
        const normalizedState = normalizeIndianStateName(siteData.state);
        const geocode = await lookupLocationGeocode({
          name: siteData.siteName,
          address: siteData.siteAddress,
          district: siteData.district,
          state: normalizedState,
          entityType: "site",
        });

        batch.update(siteDoc.ref, {
          geolocation: new GeoPoint(geocode.lat, geocode.lng),
          latString: geocode.lat.toFixed(6),
          lngString: geocode.lng.toFixed(6),
          coordinateStatus: "geocoded",
          coordinateSource: "geocode",
          placeAccuracy: geocode.placeAccuracy ?? null,
          geocodedAt: new Date(),
          ...(normalizedState && normalizedState !== siteData.state
            ? { state: normalizedState }
            : {}),
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
          message: "Coordinates updated via geocoding.",
          oldLat: coords?.lat,
          oldLng: coords?.lng,
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
          oldLat: coords?.lat,
          oldLng: coords?.lng,
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
