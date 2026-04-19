import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = await request.json();
    await adminDb.collection("trainingModules").doc(id).update({
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb, storage: adminStorage } = await import("@/lib/firebaseAdmin");
    const docRef = adminDb.collection("trainingModules").doc(id);
    const snap = await docRef.get();
    const contentPath = snap.exists ? (snap.data()?.contentPath as string | undefined) : undefined;
    if (contentPath) {
      try {
        await adminStorage.bucket().file(contentPath).delete({ ignoreNotFound: true });
      } catch (err) {
        console.warn("Failed to delete training storage object", err);
      }
    }
    await docRef.delete();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
