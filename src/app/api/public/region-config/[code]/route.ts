import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const regionCode = code.trim().toUpperCase();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // Kerala is the default/current deployment
    if (regionCode === "KL") {
      return NextResponse.json({
        regionCode: "KL",
        regionName: "Kerala",
        apiUrl: process.env.NEXT_PUBLIC_APP_URL || "https://cisskerala.site",
        android: {
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
          appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
          messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
          storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
        },
        web: {
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
          appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
          messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
          storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
          measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || undefined,
        },
      });
    }

    // Look up region record
    const regionSnap = await adminDb.collection("regions").doc(regionCode).get();
    if (!regionSnap.exists) {
      return NextResponse.json({ error: "Region not found." }, { status: 404 });
    }

    const region = regionSnap.data() as Record<string, unknown>;
    const status = typeof region.status === "string" ? region.status : "draft";
    if (!["ready", "live"].includes(status)) {
      return NextResponse.json({ error: "Region is not available yet." }, { status: 404 });
    }

    const missingConfig =
      !region.firebaseProjectId ||
      !(region.firebaseApiKey || region.webApiKey) ||
      !(region.firebaseWebAppId || region.webAppId);
    if (missingConfig) {
      return NextResponse.json({ error: "Region configuration is incomplete." }, { status: 503 });
    }

    return NextResponse.json({
      regionCode: region.regionCode,
      regionName: region.regionName,
      apiUrl: region.vercelProductionUrl || `https://ciss-${regionCode.toLowerCase()}.vercel.app`,
      android: {
        apiKey: region.androidApiKey || region.firebaseApiKey || region.webApiKey || "",
        appId: region.androidAppId || region.firebaseWebAppId || region.webAppId || "",
        projectId: region.firebaseProjectId || "",
        messagingSenderId: region.messagingSenderId || "",
        storageBucket: region.storageBucket || "",
      },
      web: {
        apiKey: region.firebaseApiKey || region.webApiKey || "",
        appId: region.firebaseWebAppId || region.webAppId || "",
        projectId: region.firebaseProjectId || "",
        messagingSenderId: region.messagingSenderId || "",
        storageBucket: region.storageBucket || "",
        authDomain: region.authDomain || "",
        measurementId: region.measurementId || undefined,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch region config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
