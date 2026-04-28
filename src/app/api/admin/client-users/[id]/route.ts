import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerAuditEvent } from "@/lib/server/audit";

type ClientUserPatch = {
  name?: string;
  email?: string;
  password?: string;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminUser = await requireAdmin(request);
    const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;
    const body = (await request.json()) as ClientUserPatch;

    const mappingRef = adminDb.collection("clientUsers").doc(id);
    const mappingSnap = await mappingRef.get();

    if (!mappingSnap.exists) {
      return NextResponse.json({ error: "Mapping not found." }, { status: 404 });
    }

    const mapping = mappingSnap.data() as {
      uid?: string;
      email?: string;
      name?: string;
      clientId?: string;
      clientName?: string;
    };

    if (!mapping.uid) {
      return NextResponse.json({ error: "Mapping has no linked Firebase user." }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {};
    const authUpdates: { displayName?: string; email?: string; password?: string } = {};

    if (body.name !== undefined && body.name.trim()) {
      const trimmed = body.name.trim();
      updatePayload.name = trimmed;
      authUpdates.displayName = trimmed;
    }

    if (body.email !== undefined && body.email.trim()) {
      const trimmed = body.email.trim().toLowerCase();
      if (!trimmed.includes("@")) {
        return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
      }
      updatePayload.email = trimmed;
      authUpdates.email = trimmed;
    }

    if (body.password !== undefined) {
      if (body.password.length < 6) {
        return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
      }
      authUpdates.password = body.password;
    }

    if (Object.keys(updatePayload).length === 0 && Object.keys(authUpdates).length === 0) {
      return NextResponse.json({ error: "No changes provided." }, { status: 400 });
    }

    // Update Firebase Auth user if needed
    if (Object.keys(authUpdates).length > 0) {
      await adminAuth.updateUser(mapping.uid, authUpdates);
    }

    // Update Firestore mapping docs
    if (Object.keys(updatePayload).length > 0) {
      updatePayload.updatedAt = new Date().toISOString();
      const firestorePayload = updatePayload as { [x: string]: string | undefined };
      const batch = adminDb.batch();
      batch.update(mappingRef, firestorePayload);
      batch.update(adminDb.collection("clientUsersByUid").doc(mapping.uid), firestorePayload);
      await batch.commit();
    }

    // Audit
    await adminDb.collection("clientUserAudit").add(
      buildServerAuditEvent(
        "client_user_updated",
        { uid: adminUser.uid, email: adminUser.email },
        {
          mappingId: id,
          targetUid: mapping.uid,
          targetEmail: mapping.email ?? null,
          changes: Object.keys(updatePayload).filter((k) => k !== "updatedAt"),
          passwordChanged: !!authUpdates.password,
        },
      ),
    );

    return NextResponse.json({ ok: true, updated: Object.keys(updatePayload) });
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
    const mappingRef = adminDb.collection("clientUsers").doc(id);
    const mappingSnap = await mappingRef.get();

    if (!mappingSnap.exists) {
      return NextResponse.json({ error: "Mapping not found." }, { status: 404 });
    }

    const mapping = mappingSnap.data() as { uid?: string };
    await adminDb.collection("clientUserAudit").add({
      ...buildServerAuditEvent(
        "client_user_unlinked",
        {
          uid: adminUser.uid,
          email: adminUser.email,
        },
        {
          mappingId: id,
          targetUid: mapping.uid ?? null,
        },
      ),
    });
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
