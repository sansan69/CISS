import { NextResponse } from "next/server";

import { parseDate, resolvePatrolSettings, toGuardPatrolActivityRow } from "@/lib/patrol";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  unauthorizedResponse,
  verifyRequestAuth,
  type AppDecodedToken,
} from "@/lib/server/auth";
import { canonicalizeDistrictList, districtMatches } from "@/lib/districts";
export const runtime = "nodejs";

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

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const isAdmin = hasAdminAccess(decoded);
    const isFieldOfficer = hasFieldOfficerAccess(decoded);
    if (!isAdmin && !isFieldOfficer) {
      return unauthorizedResponse("Admin or field officer access required.", 403);
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { searchParams } = new URL(request.url);
    const clientId = normalizeText(searchParams.get("clientId"));
    const type = normalizeText(searchParams.get("type"));
    const assignedDistricts = isAdmin
      ? []
      : await getAssignedDistricts(adminDb, decoded);

    if (!isAdmin && assignedDistricts.length === 0) {
      return NextResponse.json({
        summary: {
          total: 0,
          hourlyPhotos: 0,
          patrolRounds: 0,
          activeSites: 0,
          uniqueGuards: 0,
        },
        settings: null,
        activities: [],
      });
    }

    const snapshot = clientId
      ? await adminDb.collection("guardPatrolActivities").where("clientId", "==", clientId).limit(300).get()
      : await adminDb.collection("guardPatrolActivities").limit(300).get();

    const activities = snapshot.docs
      .map((doc) => toGuardPatrolActivityRow(doc.id, doc.data() as Record<string, unknown>))
      .filter((row) => !type || row.type === type)
      .filter(
        (row) =>
          isAdmin ||
          assignedDistricts.some((district) => districtMatches(district, row.district)),
      )
      .sort((left, right) => {
        const leftAt = parseDate(left.activityAt ?? left.createdAt) ?? new Date(0);
        const rightAt = parseDate(right.activityAt ?? right.createdAt) ?? new Date(0);
        return rightAt.getTime() - leftAt.getTime();
      });

    let settings = null;
    if (clientId) {
      const clientDoc = await adminDb.collection("clients").doc(clientId).get();
      if (clientDoc.exists) {
        settings = resolvePatrolSettings(clientDoc.data()?.patrolSettings);
      }
    }

    return NextResponse.json({
      summary: {
        total: activities.length,
        hourlyPhotos: activities.filter((activity) => activity.type === "hourly_photo").length,
        patrolRounds: activities.filter((activity) => activity.type === "patrol").length,
        activeSites: new Set(activities.map((activity) => activity.siteId).filter(Boolean)).size,
        uniqueGuards: new Set(activities.map((activity) => activity.employeeDocId).filter(Boolean)).size,
      },
      settings,
      activities: activities.slice(0, 120),
    });
  } catch (error: any) {
    const status =
      error?.message?.includes("access required") ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
