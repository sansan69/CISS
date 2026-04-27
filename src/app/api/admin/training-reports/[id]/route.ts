import { NextResponse } from "next/server";
import { hasAdminAccess, verifyRequestAuth, unauthorizedResponse } from "@/lib/server/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const decoded = await verifyRequestAuth(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const docRef = adminDb.collection("foTrainingReports").doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data = snap.data()!;
    const admin = hasAdminAccess(decoded);

    if (!admin && data.fieldOfficerId !== decoded.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as {
      status?: string;
      topic?: string;
      description?: string;
      durationMinutes?: number;
      attendeeCount?: number;
      attendeeIds?: string[];
      photoUrls?: string[];
    };

    const updates: Record<string, unknown> = {};

    if (body.topic !== undefined) updates.topic = body.topic;
    if (body.description !== undefined) updates.description = body.description;
    if (body.durationMinutes !== undefined) updates.durationMinutes = body.durationMinutes;
    if (body.attendeeCount !== undefined) updates.attendeeCount = body.attendeeCount;
    if (body.attendeeIds !== undefined) updates.attendeeIds = body.attendeeIds;
    if (Array.isArray(body.photoUrls)) updates.photoUrls = body.photoUrls;

    if (body.status === "acknowledged" && admin) {
      updates.status = "acknowledged";
      updates.acknowledgedBy = decoded.uid;
      updates.acknowledgedAt = FieldValue.serverTimestamp();
    } else if (body.status && !admin) {
      if (body.status !== "submitted") {
        return NextResponse.json({ error: "Only admin can acknowledge training reports" }, { status: 403 });
      }
      updates.status = body.status;
    }

    await docRef.update(updates);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}
