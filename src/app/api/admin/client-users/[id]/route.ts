import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;
    const mappingRef = adminDb.collection("clientUsers").doc(id);
    const mappingSnap = await mappingRef.get();

    if (!mappingSnap.exists) {
      return NextResponse.json({ error: "Mapping not found." }, { status: 404 });
    }

    const mapping = mappingSnap.data() as { uid?: string };
    await mappingRef.delete();

    if (mapping.uid) {
      await adminDb.collection("clientUsersByUid").doc(mapping.uid).delete();
      const userRecord = await adminAuth.getUser(mapping.uid);
      const existingClaims = userRecord.customClaims || {};
      if (existingClaims.role === "client") {
        const { role, ...restClaims } = existingClaims;
        await adminAuth.setCustomUserClaims(mapping.uid, restClaims);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
