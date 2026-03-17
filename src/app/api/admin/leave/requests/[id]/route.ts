import { NextResponse } from "next/server";
import { verifyRequestAuth } from "@/lib/server/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const decoded = await verifyRequestAuth(request);
    const { id } = await params;
    const body = await request.json();
    const { status, notes } = body as { status: "approved" | "rejected"; notes?: string };

    if (!status || !["approved", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const leaveDoc = await adminDb.collection("leaveRequests").doc(id).get();
    if (!leaveDoc.exists) {
      return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
    }

    // Get approver display name
    let approverName = decoded.name ?? decoded.email ?? decoded.uid;

    await adminDb.collection("leaveRequests").doc(id).update({
      status,
      approvedBy: decoded.uid,
      approvedByName: approverName,
      respondedAt: FieldValue.serverTimestamp(),
      ...(notes ? { notes } : {}),
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
