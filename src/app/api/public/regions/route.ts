import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const snapshot = await adminDb
      .collection("regions")
      .where("status", "in", ["live", "ready"])
      .orderBy("regionCode")
      .get();

    const regions = snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        code: data.regionCode,
        name: data.regionName,
        apiUrl: data.vercelProductionUrl || `https://ciss-${String(data.regionCode).toLowerCase()}.vercel.app`,
      };
    });

    // Always include Kerala
    const kerala = {
      code: "KL",
      name: "Kerala",
      apiUrl: process.env.NEXT_PUBLIC_APP_URL || "https://cisskerala.site",
    };

    const allRegions = [kerala, ...regions.filter((r) => r.code !== "KL")];

    return NextResponse.json({ regions: allRegions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch regions";
    return NextResponse.json({ regions: [], error: message });
  }
}
