import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id: clientId } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const doc = await adminDb.collection("clientWageConfig").doc(clientId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ id: doc.id, ...doc.data() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const decoded = await requireAdmin(request);
    const { id: clientId } = await params;
    const body = await request.json();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    await adminDb.collection("clientWageConfig").doc(clientId).set(
      {
        ...body,
        clientId,
        lastUpdatedAt: FieldValue.serverTimestamp(),
        lastUpdatedBy: decoded.uid,
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
