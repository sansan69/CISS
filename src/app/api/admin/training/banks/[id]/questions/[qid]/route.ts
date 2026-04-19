import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; qid: string }> },
) {
  try {
    const adminUser = await requireAdmin(request);
    const { id, qid } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = await request.json();
    await adminDb
      .collection("questionBanks")
      .doc(id)
      .collection("questions")
      .doc(qid)
      .update({ ...body, updatedAt: new Date(), updatedBy: adminUser.uid });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; qid: string }> },
) {
  try {
    await requireAdmin(request);
    const { id, qid } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const bankRef = adminDb.collection("questionBanks").doc(id);
    await bankRef.collection("questions").doc(qid).delete();
    const count = (await bankRef.collection("questions").count().get()).data().count;
    await bankRef.update({ questionCount: count });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
