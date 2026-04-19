import { NextResponse } from "next/server";
import { requireAdmin, verifyRequestAuth, unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await verifyRequestAuth(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const doc = await adminDb.collection("questionBanks").doc(id).get();
    if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ bank: { id: doc.id, ...doc.data() } });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminUser = await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = await request.json();
    await adminDb.collection("questionBanks").doc(id).update({
      ...body,
      updatedAt: new Date(),
      updatedBy: adminUser.uid,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const qSnap = await adminDb.collection("questionBanks").doc(id).collection("questions").get();
    const batch = adminDb.batch();
    qSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(adminDb.collection("questionBanks").doc(id));
    await batch.commit();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
