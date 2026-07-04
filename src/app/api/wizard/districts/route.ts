import { NextResponse } from "next/server";
import { requireAdminLike, unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { buildServerCreateAudit } from "@/lib/server/audit";
import { REGION_CODE, REGION_NAME } from "@/lib/runtime-config";
import { INDIA_STATE_DISTRICTS } from "@/lib/region-wizard";
import { normalizeDistrictForFirestore } from "@/lib/districts";

export async function GET(request: Request) {
  try {
    await requireAdminLike(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const districtSnap = await adminDb.collection("districts").orderBy("name").get();

    if (!districtSnap.empty) {
      const districts = districtSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return NextResponse.json({ districts, source: "firestore" });
    }

    const defaultDistricts =
      INDIA_STATE_DISTRICTS[REGION_NAME] ??
      INDIA_STATE_DISTRICTS[REGION_CODE] ??
      INDIA_STATE_DISTRICTS.Kerala ??
      [];
    return NextResponse.json({
      districts: defaultDistricts.map((name: string) => ({ name, active: true })),
      source: "defaults",
    });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdminLike(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as {
      districts: Array<{ name: string; active?: boolean; aliases?: string[] }>;
    };

    if (!Array.isArray(body.districts) || body.districts.length === 0) {
      return NextResponse.json({ error: "At least one district is required." }, { status: 400 });
    }

    const batch = adminDb.batch();
    for (const district of body.districts) {
      const id = normalizeDistrictForFirestore(district.name);
      const ref = adminDb.collection("districts").doc(id);
      batch.set(ref, {
        name: district.name.trim(),
        stateCode: REGION_CODE,
        active: district.active !== false,
        aliases: Array.isArray(district.aliases) ? district.aliases.filter(Boolean) : [],
        ...buildServerCreateAudit({ uid: actor.uid, email: actor.email }),
      });
    }
    await batch.commit();

    await adminDb.collection("regionSetupProgress").doc("default").set(
      { steps: { districts: true }, currentStep: 2 },
      { merge: true },
    );

    return NextResponse.json({ success: true, count: body.districts.length });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}
