import { NextResponse } from "next/server";

import { REGION_CODE, REGION_NAME } from "@/lib/runtime-config";

export const runtime = "nodejs";

/**
 * Region discovery for the mobile app.
 *
 * Every state runs its own Firebase project under its own Google account, so a
 * regional deployment is the authority for *its own* region only. The previous
 * implementation always injected Kerala and reused `NEXT_PUBLIC_APP_URL`, which
 * made a Tamil Nadu (or any non-Kerala) deployment advertise "Kerala" pointing
 * at the wrong API host. Registered regions in this project are still listed
 * (the control-plane project may carry several), but the deployment's own region
 * is always present and cannot be overwritten by a stale document.
 */
function ownRegion() {
  const fallbackApiUrl =
    REGION_CODE === "KL"
      ? "https://cisskerala.site"
      : `https://ciss-${REGION_CODE.toLowerCase()}.vercel.app`;

  return {
    code: REGION_CODE,
    name: REGION_NAME,
    apiUrl: process.env.NEXT_PUBLIC_APP_URL || fallbackApiUrl,
  };
}

export async function GET() {
  const own = ownRegion();

  try {
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const snapshot = await adminDb
      .collection("regions")
      .where("status", "in", ["live", "ready"])
      .get();

    const registered = snapshot.docs
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const code = String(data.regionCode || doc.id || "")
          .trim()
          .toUpperCase();
        return {
          code,
          name: String(data.regionName || code),
          apiUrl:
            (typeof data.vercelProductionUrl === "string" &&
              data.vercelProductionUrl) ||
            `https://ciss-${code.toLowerCase()}.vercel.app`,
        };
      })
      .filter((region) => region.code && region.name);

    const byCode = new Map([[own.code, own]]);
    for (const region of registered) {
      if (!byCode.has(region.code)) byCode.set(region.code, region);
    }

    const regions = [...byCode.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    return NextResponse.json({ regions });
  } catch {
    return NextResponse.json({ regions: [own] });
  }
}
