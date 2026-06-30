import { NextResponse } from "next/server";
import { requireAdminLike, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerCreateAudit } from "@/lib/server/audit";
import { REGION_CODE } from "@/lib/runtime-config";

export async function POST(request: Request) {
  try {
    const actor = await requireAdminLike(await (await import("@/lib/server/auth")).verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as {
      clientName: string;
      sites?: Array<{ name: string; district: string }>;
    };

    if (!body.clientName?.trim()) {
      return NextResponse.json({ error: "Client name is required." }, { status: 400 });
    }

    const clientRef = await adminDb.collection("clients").add({
      name: body.clientName.trim(),
      stateCode: REGION_CODE,
      ...buildServerCreateAudit({ uid: actor.uid, email: actor.email }),
    });

    if (Array.isArray(body.sites)) {
      const batch = adminDb.batch();
      for (const site of body.sites) {
        const siteRef = adminDb.collection("sites").doc();
        batch.set(siteRef, {
          siteName: site.name.trim(),
          district: site.district.trim(),
          clientName: body.clientName.trim(),
          stateCode: REGION_CODE,
          ...buildServerCreateAudit({ uid: actor.uid, email: actor.email }),
        });
      }
      await batch.commit();
    }

    await adminDb.collection("regionSetupProgress").doc("default").set(
      { steps: { clients: true } },
      { merge: true },
    );

    return NextResponse.json({ success: true, clientId: clientRef.id });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}
