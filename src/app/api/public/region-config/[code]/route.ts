import { NextResponse } from "next/server";

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

    return NextResponse.json({
      regionCode: region.regionCode,
      regionName: region.regionName,
      apiUrl: region.vercelProductionUrl || `https://ciss-${regionCode.toLowerCase()}.vercel.app`,
      android: {
        apiKey: region.firebaseApiKey || region.androidApiKey || "",
        appId: region.firebaseWebAppId || region.androidAppId || "",
        projectId: region.firebaseProjectId || "",
        messagingSenderId: region.messagingSenderId || "",
        storageBucket: region.storageBucket || "",
      },
      web: {
        apiKey: region.firebaseApiKey || "",
        appId: region.firebaseWebAppId || "",
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
