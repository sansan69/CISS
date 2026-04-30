import { NextResponse } from "next/server";
import { hasAdminAccess, hasFieldOfficerAccess, unauthorizedResponse, verifyRequestAuth, type AppDecodedToken } from "@/lib/server/auth";
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
    const workOrdersSnap = await adminDb.collection("workOrders").limit(1000).get();

    const workOrders = workOrdersSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string }))
      .filter((row) => {
        if (assignedDistricts.length === 0) return true;
        return assignedDistricts.some((district) => districtMatches(district, String(row.district ?? "")));
      })
      .filter((row) => normalizeText(row.recordStatus || "active").toLowerCase() === "active")
      .map((row) => ({
        id: String(row.id),
        siteId: normalizeText(row.siteId),
        siteName: normalizeText(row.siteName || "Site"),
        district: normalizeText(row.district),
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
