import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { normalizeText } from "@/lib/server/mobile-api-utils";
export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const { db: adminDb, FieldValue } = await import("@/lib/firebaseAdmin");

    if (!id || !id.trim()) {
      return NextResponse.json(
        { error: "Site ID is required." },
        { status: 400 },
      );
    }

    const docRef = adminDb.collection("sites").doc(id.trim());
    const existing = await docRef.get();
    if (!existing.exists) {
      return NextResponse.json(
        { error: "Site not found." },
        { status: 404 },
      );
    }

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (body.name) update.name = normalizeText(body.name);
    if (body.siteName) update.siteName = normalizeText(body.siteName);
    if (body.clientId) update.clientId = normalizeText(body.clientId);
    if (body.clientName) update.clientName = normalizeText(body.clientName);
    if (body.district) update.district = normalizeText(body.district);
    if (body.address) update.address = normalizeText(body.address);
    if (body.latitude != null) update.latitude = body.latitude;
    if (body.longitude != null) update.longitude = body.longitude;
    if (body.status) update.status = normalizeText(body.status);

    await docRef.update(update);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Admin access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[admin/sites PATCH]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    if (!id || !id.trim()) {
      return NextResponse.json(
        { error: "Site ID is required." },
        { status: 400 },
      );
    }

    const docRef = adminDb.collection("sites").doc(id.trim());
    const existing = await docRef.get();
    if (!existing.exists) {
      return NextResponse.json(
        { error: "Site not found." },
        { status: 404 },
      );
    }

    await docRef.delete();

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Admin access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[admin/sites DELETE]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
