import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { startOfToday } from "date-fns";
import { hasAdminAccess, hasFieldOfficerAccess, unauthorizedResponse, verifyRequestAuth, type AppDecodedToken } from "@/lib/server/auth";
import { canonicalizeDistrictList, districtMatches } from "@/lib/districts";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";

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
        foData.assignedDistricts.filter((district): district is string => typeof district === "string"),
      );
    }
  }

  return Array.isArray(decoded.assignedDistricts)
    ? canonicalizeDistrictList(decoded.assignedDistricts.filter((district): district is string => typeof district === "string"))
    : [];
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return unauthorizedResponse("Field officer or admin access required.", 403);
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const assignedDistricts = await getAssignedDistricts(adminDb, decoded);
    const todayTimestamp = Timestamp.fromDate(startOfToday());
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
    for (let index = 0; index < siteIds.length; index += 30) {
      const chunk = siteIds.slice(index, index + 30);
      const sitesSnap = await adminDb
        .collection("sites")
        .where("__name__", "in", chunk)
        .get();
      sitesSnap.docs.forEach((doc) => {
        const data = doc.data() as { district?: string; districtName?: string };
        siteDistrictById.set(doc.id, normalizeText(data.district || data.districtName || ""));
      });
    }

    const workOrders = rawRows
      .map((row) => {
        const siteIdString = normalizeText(row.siteId);
        const resolvedDistrict =
          siteDistrictById.get(siteIdString) || normalizeText(row.district);
        return { row, resolvedDistrict, siteIdString };
      })
      .filter(({ resolvedDistrict }) => {
        if (assignedDistricts.length === 0) return true;
        return assignedDistricts.some((district) => districtMatches(district, resolvedDistrict));
      })
      .map(({ row, resolvedDistrict, siteIdString }) => ({
        id: String(row.id),
        siteId: siteIdString,
        siteName: normalizeText(row.siteName || "Site"),
        district: resolvedDistrict,
        examName: normalizeText(row.examName || row.examCode || "Duty"),
        examCode: normalizeText(row.examCode),
        date: typeof (row.date as { toDate?: unknown } | undefined)?.toDate === "function"
          ? ((row.date as { toDate: () => Date }).toDate()).toISOString()
          : String(row.date ?? ""),
        totalManpower: Number(row.totalManpower ?? Number(row.maleGuardsRequired ?? 0) + Number(row.femaleGuardsRequired ?? 0)),
        assignedCount: Array.isArray(row.assignedGuards) ? row.assignedGuards.length : 0,
      }))
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());

    return NextResponse.json({ workOrders });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load work orders.";
    return unauthorizedResponse(message, 401);
  }
}
