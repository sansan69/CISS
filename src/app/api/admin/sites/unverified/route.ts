import { NextResponse } from "next/server";

import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snapshot = await adminDb.collection("sites").get();

    const unverifiedSites = snapshot.docs
      .map((siteDoc) => ({ id: siteDoc.id, ...(siteDoc.data() as Record<string, unknown>) }))
      .filter((site) => {
        const status = String((site as Record<string, unknown>).coordinateStatus || "missing");
        return status === "missing" || status === "geocoded";
      })
      .sort((left, right) => {
        const statusWeight = (value: string) => (value === "missing" ? 0 : 1);
        const leftRecord = left as Record<string, unknown>;
        const rightRecord = right as Record<string, unknown>;
        const byStatus = statusWeight(String(leftRecord.coordinateStatus || "missing")) -
          statusWeight(String(rightRecord.coordinateStatus || "missing"));
        if (byStatus !== 0) return byStatus;
        return String(leftRecord.siteName || "").localeCompare(String(rightRecord.siteName || ""));
      });

    return NextResponse.json({ sites: unverifiedSites });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
