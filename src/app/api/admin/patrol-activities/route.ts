import { NextResponse } from "next/server";

import { parseDate, resolvePatrolSettings, toGuardPatrolActivityRow } from "@/lib/patrol";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const clientId = normalizeText(searchParams.get("clientId"));
    const type = normalizeText(searchParams.get("type"));

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const snapshot = clientId
      ? await adminDb.collection("guardPatrolActivities").where("clientId", "==", clientId).limit(300).get()
      : await adminDb.collection("guardPatrolActivities").limit(300).get();

    const activities = snapshot.docs
      .map((doc) => toGuardPatrolActivityRow(doc.id, doc.data() as Record<string, unknown>))
      .filter((row) => !type || row.type === type)
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
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
