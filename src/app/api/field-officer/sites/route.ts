import { NextResponse } from "next/server";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  unauthorizedResponse,
  verifyRequestAuth,
  type AppDecodedToken,
} from "@/lib/server/auth";
import { canonicalizeDistrictList, districtMatches } from "@/lib/districts";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function getAssignedDistricts(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
) {
  const foSnapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(1)
    .get();

  if (!foSnapshot.empty) {
    const foData = foSnapshot.docs[0].data();
    if (Array.isArray(foData.assignedDistricts)) {
      return canonicalizeDistrictList(
        foData.assignedDistricts.filter(
          (district): district is string => typeof district === "string",
        ),
      );
    }
  }

  return Array.isArray(decoded.assignedDistricts)
    ? canonicalizeDistrictList(
        decoded.assignedDistricts.filter(
          (district): district is string => typeof district === "string",
        ),
      )
    : [];
}

function coordinateFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return unauthorizedResponse(
        "Field officer or admin access required.",
        403,
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const isAdmin = hasAdminAccess(decoded);
    const requestedDistricts = new URL(request.url)
      .searchParams
      .getAll("district")
      .map(normalizeText)
      .filter(Boolean);
    const assignedDistricts = await getAssignedDistricts(adminDb, decoded);
    const districtScope = requestedDistricts.length > 0
      ? requestedDistricts.filter((district) =>
          isAdmin ||
          assignedDistricts.some((assigned) => districtMatches(assigned, district)),
        )
      : assignedDistricts;

    if (!isAdmin && districtScope.length === 0) {
      return NextResponse.json({ sites: [] });
    }

    const snapshot = await adminDb.collection("sites").get();
    const sites = snapshot.docs
      .map((doc) => {
        const data = doc.data() as {
          clientId?: string;
          clientName?: string;
          siteName?: string;
          district?: string;
          districtName?: string;
          latitude?: number;
          longitude?: number;
          geolocation?: { latitude?: number; longitude?: number };
          latString?: string;
          lngString?: string;
        };
        const latitude =
          coordinateFrom(data.latitude) ??
          coordinateFrom(data.geolocation?.latitude) ??
          coordinateFrom(
            typeof data.latString === "string" ? Number(data.latString) : null,
          );
        const longitude =
          coordinateFrom(data.longitude) ??
          coordinateFrom(data.geolocation?.longitude) ??
          coordinateFrom(
            typeof data.lngString === "string" ? Number(data.lngString) : null,
          );

        return {
          siteId: doc.id,
          clientId: normalizeText(data.clientId),
          clientName: normalizeText(data.clientName),
          siteName: normalizeText(data.siteName || doc.id),
          district: normalizeText(data.district || data.districtName),
          latitude,
          longitude,
        };
      })
      .filter((site) => {
        if (districtScope.length === 0) return true;
        return districtScope.some((district) =>
          districtMatches(district, site.district),
        );
      })
      .sort((left, right) => {
        const districtOrder = left.district.localeCompare(right.district);
        if (districtOrder !== 0) return districtOrder;
        return left.siteName.localeCompare(right.siteName);
      });

    return NextResponse.json({ sites });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Could not load sites.";
    if (
      message.includes("Missing bearer token") ||
      message.includes("access required")
    ) {
      return unauthorizedResponse(message, 401);
    }
    console.error("[field-officer/sites]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
