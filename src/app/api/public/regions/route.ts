import { NextResponse } from "next/server";

function keralaRegion() {
  return {
    code: "KL",
    name: "Kerala",
    apiUrl: process.env.NEXT_PUBLIC_APP_URL || "https://cisskerala.site",
  };
}

export async function GET() {
  try {
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const snapshot = await adminDb
      .collection("regions")
      .where("status", "in", ["live", "ready"])
      .get();

    const regions = snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const code = String(data.regionCode || doc.id || "").trim().toUpperCase();
      return {
        code,
        name: String(data.regionName || code),
        apiUrl: data.vercelProductionUrl || `https://ciss-${code.toLowerCase()}.vercel.app`,
      };
    }).filter((region) => region.code && region.name);

    // Always include Kerala
    const kerala = keralaRegion();

    const allRegions = [kerala, ...regions.filter((r) => r.code !== "KL")]
      .sort((left, right) => left.name.localeCompare(right.name));

    return NextResponse.json({ regions: allRegions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch regions";
    return NextResponse.json({ regions: [keralaRegion()], error: message });
  }
}
