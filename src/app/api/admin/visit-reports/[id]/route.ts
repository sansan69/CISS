import { NextResponse } from "next/server";
import { hasAdminAccess, verifyRequestAuth, unauthorizedResponse } from "@/lib/server/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const decoded = await verifyRequestAuth(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const doc = await adminDb.collection("foVisitReports").doc(id).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data = doc.data()!;
    // Field officers can only view their own
    if (!hasAdminAccess(decoded) && data.fieldOfficerId !== decoded.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ report: { id: doc.id, ...data } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const decoded = await verifyRequestAuth(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const doc = await adminDb.collection("foVisitReports").doc(id).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data = doc.data()!;
    const admin = hasAdminAccess(decoded);

    // FO can only update own draft
    if (!admin && data.fieldOfficerId !== decoded.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!admin && data.status !== "draft") {
      return NextResponse.json({ error: "Cannot edit submitted report" }, { status: 403 });
    }

    const body = (await request.json()) as {
      status?: string;
      reviewNotes?: string;
      summary?: string;
      issuesFound?: string;
      actionsRequired?: string;
      guardsPresentCount?: number;
      guardsAbsentCount?: number;
    };

    const updates: Record<string, unknown> = {};

    if (body.summary !== undefined) updates.summary = body.summary;
    if (body.issuesFound !== undefined) updates.issuesFound = body.issuesFound;
    if (body.actionsRequired !== undefined) updates.actionsRequired = body.actionsRequired;
    if (body.guardsPresentCount !== undefined) updates.guardsPresentCount = body.guardsPresentCount;
    if (body.guardsAbsentCount !== undefined) updates.guardsAbsentCount = body.guardsAbsentCount;

    if (body.status !== undefined) {
      if (!admin && body.status === "reviewed") {
        return NextResponse.json({ error: "Only admin can mark as reviewed" }, { status: 403 });
      }
      updates.status = body.status;
      if (body.status === "reviewed" && admin) {
        updates.reviewedBy = decoded.uid;
        updates.reviewedAt = FieldValue.serverTimestamp();
        updates.reviewNotes = body.reviewNotes ?? "";
      }
    }

    await adminDb.collection("foVisitReports").doc(id).update(updates);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}
