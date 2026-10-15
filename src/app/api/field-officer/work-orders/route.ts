import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { resolveDutySupervisor, istToday } from "@/lib/server/duties/scope";
import { tallyWorkOrderWillingness } from "@/lib/server/duties/willingness";
import { dutyErrorResponse, dutyJson } from "@/lib/server/duties/requests";
import { hasAdminAccess, unauthorizedResponse, verifyRequestAuth, type AppDecodedToken } from "@/lib/server/auth";
import { canonicalizeDistrictList, districtMatches } from "@/lib/districts";
import { requireActiveFieldOfficerProfile } from "@/lib/server/linked-profiles";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";
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

export async function GET(request: Request) {
  try {
    const supervisor = await resolveDutySupervisor(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const isAdmin = supervisor.isAdmin;
    const assignedDistricts = supervisor.assignedDistricts;
    const todayTimestamp = Timestamp.fromDate(new Date(`${istToday()}T00:00:00+05:30`));
    // Only pull upcoming, active TCS work orders. Avoid an unbounded
    // `.limit(N)` without ordering — that silently hides recently-imported
    // sites once the collection grows past the cap.
    const workOrdersSnap = await adminDb
      .collection("workOrders")
      .where("date", ">=", todayTimestamp)
      .orderBy("date", "asc")
      .get();

    const rawRows = workOrdersSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string }))
      .filter((row) => isOperationalWorkOrderClientName(typeof row.clientName === "string" ? row.clientName : ""))
      .filter((row) => normalizeText(row.recordStatus || "active").toLowerCase() === "active");

    // Resolve the authoritative district from the site record (sites are
    // updated by the importer), then fall back to the work-order's own
    // district. This protects against stale/empty work-order districts.
    const siteIds = Array.from(
      new Set(rawRows.map((row) => normalizeText(row.siteId)).filter(Boolean)),
    );
    const siteDistrictById = new Map<string, string>();
    const siteMetaById = new Map<
      string,
      {
        clientId: string;
        clientName: string;
        siteName: string;
        latitude: number | null;
        longitude: number | null;
      }
    >();
    for (let index = 0; index < siteIds.length; index += 30) {
      const chunk = siteIds.slice(index, index + 30);
      const sitesSnap = await adminDb
        .collection("sites")
        .where("__name__", "in", chunk)
        .get();
      sitesSnap.docs.forEach((doc) => {
        const data = doc.data() as {
          district?: string;
          districtName?: string;
          clientId?: string;
          clientName?: string;
          siteName?: string;
          latitude?: number;
          longitude?: number;
          geolocation?: { latitude?: number; longitude?: number };
          latString?: string;
          lngString?: string;
        };
        const latitude =
          typeof data.latitude === "number"
            ? data.latitude
            : typeof data.geolocation?.latitude === "number"
              ? data.geolocation.latitude
              : typeof data.latString === "string"
                ? Number(data.latString)
                : null;
        const longitude =
          typeof data.longitude === "number"
            ? data.longitude
            : typeof data.geolocation?.longitude === "number"
              ? data.geolocation.longitude
              : typeof data.lngString === "string"
                ? Number(data.lngString)
                : null;
        siteDistrictById.set(doc.id, normalizeText(data.district || data.districtName || ""));
        siteMetaById.set(doc.id, {
          clientId: normalizeText(data.clientId),
          clientName: normalizeText(data.clientName),
          siteName: normalizeText(data.siteName),
          latitude: Number.isFinite(latitude) ? latitude : null,
          longitude: Number.isFinite(longitude) ? longitude : null,
        });
      });
    }

    const workOrders = rawRows
      .map((row) => {
        const siteIdString = normalizeText(row.siteId);
        const resolvedDistrict =
          siteDistrictById.get(siteIdString) || "";
        return { row, resolvedDistrict, siteIdString };
      })
      .filter(({ resolvedDistrict }) => {
        if (!resolvedDistrict) return false;
        if (!isAdmin && assignedDistricts.length === 0) return false;
        if (isAdmin && assignedDistricts.length === 0) return true;
        return assignedDistricts.some((district) => districtMatches(district, resolvedDistrict));
      })
      .map(({ row, resolvedDistrict, siteIdString }) => ({
        id: String(row.id),
        siteId: siteIdString,
        siteName: normalizeText(
          siteMetaById.get(siteIdString)?.siteName || row.siteName || "Site",
        ),
        clientId: normalizeText(
          siteMetaById.get(siteIdString)?.clientId || row.clientId,
        ),
        clientName: normalizeText(
          siteMetaById.get(siteIdString)?.clientName || row.clientName,
        ),
        district: resolvedDistrict,
        examName: normalizeText(row.examName || row.examCode || "Duty"),
        examCode: normalizeText(row.examCode),
        date: typeof (row.date as { toDate?: unknown } | undefined)?.toDate === "function"
          ? ((row.date as { toDate: () => Date }).toDate()).toISOString()
          : String(row.date ?? ""),
        totalManpower: Number(row.totalManpower ?? Number(row.maleGuardsRequired ?? 0) + Number(row.femaleGuardsRequired ?? 0)),
        assignedCount: Array.isArray(row.assignedGuards) ? row.assignedGuards.length : 0,
        maleGuardsRequired: Number(row.maleGuardsRequired ?? 0),
        femaleGuardsRequired: Number(row.femaleGuardsRequired ?? 0),
        assignedGuards: Array.isArray(row.assignedGuards) ? row.assignedGuards : [],
        assignmentReviewRequired: row.assignmentReviewRequired === true,
        assignmentStatus: normalizeText(row.assignmentStatus),
        latitude: siteMetaById.get(siteIdString)?.latitude ?? null,
        longitude: siteMetaById.get(siteIdString)?.longitude ?? null,
      }))
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());

    const enriched = await Promise.all(workOrders.map(async row=> {const counts=await tallyWorkOrderWillingness(row.id); return {...row,willingCount:counts.willingCount,unavailableCount:counts.unavailableCount};}));
    return dutyJson({ workOrders: enriched });
  } catch (error: unknown) {
    return dutyErrorResponse(error);
  }
}
