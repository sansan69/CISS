import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import {
  buildServerAuditEvent,
  buildServerUpdateAudit,
} from "@/lib/server/audit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      assignedDistricts?: string[];
    };

    await adminDb.collection("fieldOfficers").doc(id).update({
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(body.assignedDistricts ? { assignedDistricts: body.assignedDistricts } : {}),
      ...buildServerUpdateAudit({
        uid: adminUser.uid,
        email: adminUser.email,
      }),
      auditTrail: FieldValue.arrayUnion(
        buildServerAuditEvent(
          "field_officer_updated",
          {
            uid: adminUser.uid,
            email: adminUser.email,
          },
          {
            assignedDistricts: body.assignedDistricts ?? null,
            name: body.name?.trim() ?? null,
          },
        ),
      ),
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
    const adminUser = await requireAdmin(request);
    const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;
    const officerRef = adminDb.collection("fieldOfficers").doc(id);
    const officerSnap = await officerRef.get();
    if (!officerSnap.exists) {
      return NextResponse.json({ error: "Field officer not found." }, { status: 404 });
    }

    const officerData = officerSnap.data() as { uid?: string };
    await adminDb.collection("fieldOfficerAudit").add({
      ...buildServerAuditEvent(
        "field_officer_deleted",
        {
          uid: adminUser.uid,
          email: adminUser.email,
        },
        {
          officerId: id,
          targetUid: officerData.uid ?? null,
        },
      ),
    });
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
