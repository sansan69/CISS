import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import {
  buildServerAuditEvent,
  buildServerUpdateAudit,
} from "@/lib/server/audit";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await requireAdmin(request);
    const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      assignedDistricts?: string[];
      password?: string;
    };

    // Only admins can reach this route (requireAdmin above). Passwords are
    // updated on the Firebase Auth user only — never stored in Firestore.
    const nextPassword = String(body.password ?? "").trim();
    if (nextPassword && nextPassword.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters long." },
        { status: 400 }
      );
    }

    // Apply the auth password change before touching Firestore so a failed
    // auth update never leaves a half-applied officer edit behind.
    if (nextPassword) {
      const officerSnap = await adminDb.collection("fieldOfficers").doc(id).get();
      if (!officerSnap.exists) {
        return NextResponse.json({ error: "Field officer not found." }, { status: 404 });
      }
      const officerData = officerSnap.data() as { uid?: string } | undefined;
      if (!officerData?.uid) {
        return NextResponse.json(
          { error: "This field officer has no linked auth user to update." },
          { status: 400 }
        );
      }
      await adminAuth.updateUser(officerData.uid, { password: nextPassword });
    }

    const auditEvents = [
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
    ];
    if (nextPassword) {
      auditEvents.push(
        buildServerAuditEvent(
          "field_officer_password_updated",
          {
            uid: adminUser.uid,
            email: adminUser.email,
          },
          { passwordUpdated: true },
        ),
      );
    }

    await adminDb.collection("fieldOfficers").doc(id).update({
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(body.assignedDistricts ? { assignedDistricts: body.assignedDistricts } : {}),
      ...buildServerUpdateAudit({
        uid: adminUser.uid,
        email: adminUser.email,
      }),
      auditTrail: FieldValue.arrayUnion(...auditEvents),
    });

    // Sync assignedDistricts to Firebase Auth custom claims so the security
    // rules (which check request.auth.token.assignedDistricts) match the
    // updated Firestore data. Without this, FO queries with the latest
    // districts get "Missing or insufficient permissions" because the
    // token claims are stale.
    if (body.assignedDistricts) {
      const officerSnap = await adminDb.collection("fieldOfficers").doc(id).get();
      if (officerSnap.exists) {
        const officerData = officerSnap.data() as { uid?: string } | undefined;
        if (officerData?.uid) {
          const existingClaims = (await adminAuth.getUser(officerData.uid)).customClaims || {};
          await adminAuth.setCustomUserClaims(officerData.uid, {
            ...existingClaims,
            assignedDistricts: body.assignedDistricts,
          });
        }
      }
    }

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
