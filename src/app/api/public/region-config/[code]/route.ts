import { NextResponse } from "next/server";

import { REGION_CODE, REGION_NAME } from "@/lib/runtime-config";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const regionCode = code.trim().toUpperCase();

    // The deployment's own region is served from its own environment. Hard-coding
    // Kerala here meant a non-Kerala deployment answered `/region-config/TN` with
    // a 404 (its Firestore has no region registry) while answering `/KL` with the
    // wrong project's config.
    if (regionCode === REGION_CODE) {
      const fallbackApiUrl =
        REGION_CODE === "KL"
          ? "https://cisskerala.site"
          : `https://ciss-${REGION_CODE.toLowerCase()}.vercel.app`;
      return NextResponse.json({
        regionCode: REGION_CODE,
        regionName: REGION_NAME,
        apiUrl: process.env.NEXT_PUBLIC_APP_URL || fallbackApiUrl,
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

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // Look up a region registered in this project (control-plane deployments).
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
