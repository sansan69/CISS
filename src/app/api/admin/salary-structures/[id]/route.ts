import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const decoded = await requireAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    await adminDb.collection("salaryStructures").doc(id).update({
      ...body,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: decoded.uid,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const assigned = await adminDb
      .collection("employeeSalaries")
      .where("structureId", "==", id)
      .limit(1)
      .get();

    if (!assigned.empty) {
      return NextResponse.json(
        { error: "This salary grade is already assigned to employees." },
        { status: 409 },
      );
    }

    await adminDb.collection("salaryStructures").doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
