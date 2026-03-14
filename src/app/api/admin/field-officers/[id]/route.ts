import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      assignedDistricts?: string[];
    };

    await adminDb.collection("fieldOfficers").doc(id).update({
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(body.assignedDistricts ? { assignedDistricts: body.assignedDistricts } : {}),
      updatedAt: new Date(),
      updatedBy: adminUser.uid,
    });

    return NextResponse.json({ ok: true });
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
    const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;
    const officerRef = adminDb.collection("fieldOfficers").doc(id);
    const officerSnap = await officerRef.get();
    if (!officerSnap.exists) {
      return NextResponse.json({ error: "Field officer not found." }, { status: 404 });
    }

    const officerData = officerSnap.data() as { uid?: string };
    await officerRef.delete();

    if (officerData.uid) {
      const userRecord = await adminAuth.getUser(officerData.uid);
      const existingClaims = userRecord.customClaims || {};
      if (existingClaims.role === "fieldOfficer") {
        const { role, ...restClaims } = existingClaims;
        await adminAuth.setCustomUserClaims(officerData.uid, restClaims);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
