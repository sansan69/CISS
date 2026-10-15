import { NextResponse } from "next/server";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  unauthorizedResponse,
  verifyRequestAuth,
  type AppDecodedToken,
} from "@/lib/server/auth";
import { canonicalizeDistrictList, districtMatches } from "@/lib/districts";
import { requireActiveFieldOfficerProfile } from "@/lib/server/linked-profiles";
import { resolveDutySupervisor } from "@/lib/server/duties/scope";
import { dutyErrorResponse } from "@/lib/server/duties/requests";
export const runtime = "nodejs";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function getAssignedDistricts(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
) {
  return (await requireActiveFieldOfficerProfile(adminDb, decoded)).assignedDistricts;
}

function coordinateFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function GET(request: Request) {
  try {
    const supervisor = await resolveDutySupervisor(request);
    const decoded = {role: supervisor.isAdmin ? "admin" : "fieldOfficer"};
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
    const assignedDistricts = supervisor.assignedDistricts;
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
          shiftTemplates?: unknown[];
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
          shiftTemplates: Array.isArray(data.shiftTemplates) ? data.shiftTemplates.map((s:any)=>({code:normalizeText(s.code),label:normalizeText(s.label),startTime:normalizeText(s.startTime),endTime:normalizeText(s.endTime),crossesMidnight:s.crossesMidnight===true})) : [],
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
    return dutyErrorResponse(error);
  }
}
