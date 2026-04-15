import { NextResponse } from "next/server";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { getRegionConnection } from "@/lib/server/region-connections";
import { REGION_CODE, REGION_NAME } from "@/lib/runtime-config";
import type { RegionRecord } from "@/types/region";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin(request);
    const { id } = await params;
    const regionCode = id.toUpperCase();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    let region: RegionRecord | null = null;

    if (regionCode === REGION_CODE) {
      region = {
        id: REGION_CODE,
        regionCode: REGION_CODE,
        regionName: REGION_NAME,
        status: "live",
        firebaseProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "ciss-workforce",
        firebaseApiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || null,
        firebaseWebAppId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || null,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || null,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || null,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || null,
        measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || null,
        regionAdminEmail:
          process.env.SUPER_ADMIN_EMAIL || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL || null,
        onboardingChecklist: {
          metadataSaved: true,
          firebaseValidated: true,
          defaultsSeeded: true,
          regionAdminCreated: true,
          vercelConfigured: true,
        },
      } as RegionRecord;
    } else {
      const snap = await adminDb.collection("regions").doc(regionCode).get();
      if (!snap.exists) {
        return NextResponse.json({ error: "Region not found." }, { status: 404 });
      }
      region = {
        id: snap.id,
        ...snap.data(),
      } as RegionRecord;
    }

    const hasPersistentConnection =
      regionCode === REGION_CODE
        ? Boolean(
            process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64 || process.env.FIREBASE_ADMIN_SDK_CONFIG,
          )
        : Boolean((await getRegionConnection(adminDb, regionCode))?.serviceAccountJson);

    return NextResponse.json({
      region,
      deploymentConfig: {
        APP_MODE: "regional",
        NEXT_PUBLIC_APP_MODE: "regional",
        REGION_CODE: region.regionCode,
        NEXT_PUBLIC_REGION_CODE: region.regionCode,
        REGION_NAME: region.regionName,
        NEXT_PUBLIC_REGION_NAME: region.regionName,
        NEXT_PUBLIC_FIREBASE_API_KEY: region.firebaseApiKey || "",
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: region.authDomain || "",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: region.firebaseProjectId,
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: region.storageBucket || "",
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: region.messagingSenderId || "",
        NEXT_PUBLIC_FIREBASE_APP_ID: region.firebaseWebAppId || "",
        NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: region.measurementId || "",
      },
      hasPersistentConnection,
    });
  } catch (error: any) {
    return unauthorizedResponse(
      error?.message || "Unauthorized",
      error?.message === "Super admin access required." ? 403 : 401,
    );
  }
}
