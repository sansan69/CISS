import { NextResponse } from "next/server";

import { matchesClientScope, resolveClientScope } from "@/lib/server/client-access";
import { hasClientAccess, unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { parseDate, resolvePatrolSettings, toGuardPatrolActivityRow } from "@/lib/patrol";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasClientAccess(decoded)) {
      return unauthorizedResponse("Client access required.", 403);
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const scope = await resolveClientScope(adminDb, decoded);
    if (!scope) {
      return unauthorizedResponse("Client account is not linked to a valid client profile.", 403);
    }

    const snapshot = scope.clientId
      ? await adminDb.collection("guardPatrolActivities").where("clientId", "==", scope.clientId).limit(200).get()
      : await adminDb.collection("guardPatrolActivities").where("clientName", "==", scope.clientName).limit(200).get();

    const activities = snapshot.docs
      .map((doc) => toGuardPatrolActivityRow(doc.id, doc.data() as Record<string, unknown>))
      .filter((row) => matchesClientScope(row as unknown as Record<string, unknown>, scope))
      .sort((left, right) => {
        const leftAt = parseDate(left.activityAt ?? left.createdAt) ?? new Date(0);
        const rightAt = parseDate(right.activityAt ?? right.createdAt) ?? new Date(0);
        return rightAt.getTime() - leftAt.getTime();
      });

    const clientDoc = await adminDb.collection("clients").doc(scope.clientId).get();
    const settings = clientDoc.exists
      ? resolvePatrolSettings(clientDoc.data()?.patrolSettings)
      : null;

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
    return unauthorizedResponse(error?.message || "Unauthorized", 401);
  }
}
