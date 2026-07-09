import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { normalizeText } from "@/lib/server/mobile-api-utils";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    let query: FirebaseFirestore.Query = adminDb.collection("sites").limit(500);

    if (clientId) {
      query = query.where("clientId", "==", clientId);
    }

    const snapshot = await query.get();
    const sites = snapshot.docs.map((doc) => {
      const d = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        name: normalizeText(d.name || d.siteName),
        siteName: normalizeText(d.siteName || d.name),
        clientId: normalizeText(d.clientId),
        clientName: normalizeText(d.clientName),
        district: normalizeText(d.district),
        location: d.location ?? null,
        latitude: d.latitude ?? d.coordinates?.latitude ?? null,
        longitude: d.longitude ?? d.coordinates?.longitude ?? null,
        status: normalizeText(d.status || "active"),
        dutyPoints: Array.isArray(d.dutyPoints)
          ? d.dutyPoints.map((dp: unknown) =>
              typeof dp === "object" ? dp : { name: String(dp) },
            )
          : [],
      };
    });

    return NextResponse.json({ sites });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Admin access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[admin/sites GET]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const docRef = await adminDb.collection("sites").add({
      name: normalizeText(body.name || body.siteName),
      siteName: normalizeText(body.siteName || body.name),
      clientId: normalizeText(body.clientId),
      clientName: normalizeText(body.clientName),
      district: normalizeText(body.district),
      address: normalizeText(body.address),
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      status: normalizeText(body.status || "active"),
      createdBy: body.createdBy ?? null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, id: docRef.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Admin access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[admin/sites POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
