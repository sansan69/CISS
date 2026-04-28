import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerAuditEvent } from "@/lib/server/audit";
import {
  buildClientPortalAuthEmail,
  normalizeClientLoginId,
} from "@/lib/client-portal";

type UpdateClientUserRequest = {
  name?: string;
  loginId?: string;
  password?: string;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await requireAdmin(request);
    const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;
    const body = (await request.json()) as UpdateClientUserRequest;
    const mappingRef = adminDb.collection("clientUsers").doc(id);
    const mappingSnap = await mappingRef.get();

    if (!mappingSnap.exists) {
      return NextResponse.json({ error: "Mapping not found." }, { status: 404 });
    }

    const mapping = mappingSnap.data() as {
      uid?: string;
      name?: string;
      email?: string;
      authEmail?: string;
      clientId?: string;
      clientName?: string;
      stateCode?: string;
      loginId?: string | null;
    };

    if (!mapping.uid || !mapping.clientId || !mapping.clientName) {
      return NextResponse.json(
        { error: "Client user record is incomplete." },
        { status: 400 }
      );
    }

    const nextName = String(body.name ?? "").trim() || mapping.name || "";
    const requestedLoginId = normalizeClientLoginId(body.loginId);
    const nextLoginId = requestedLoginId || mapping.loginId || "";
    const nextPassword = String(body.password ?? "").trim();

    if (requestedLoginId && requestedLoginId !== mapping.loginId) {
      const duplicateLoginId = await adminDb
        .collection("clientUsers")
        .where("clientId", "==", mapping.clientId)
        .where("loginId", "==", requestedLoginId)
        .limit(1)
        .get();

      if (!duplicateLoginId.empty && duplicateLoginId.docs[0]?.id !== id) {
        return NextResponse.json(
          { error: "This login ID is already used for the selected client." },
          { status: 409 }
        );
      }
    }

    const authUpdates: Record<string, string> = {};
    const mappingUpdates: Record<string, unknown> = {};

    if (nextName && nextName !== mapping.name) {
      authUpdates.displayName = nextName;
      mappingUpdates.name = nextName;
    }

    if (requestedLoginId && requestedLoginId !== mapping.loginId) {
      const nextEmail = buildClientPortalAuthEmail(mapping.clientId, requestedLoginId);
      if (!nextEmail) {
        return NextResponse.json(
          { error: "Could not build a valid auth email for this login ID." },
          { status: 400 }
        );
      }
      authUpdates.email = nextEmail;
      mappingUpdates.loginId = requestedLoginId;
      mappingUpdates.email = nextEmail;
      mappingUpdates.authEmail = nextEmail;
    }

    if (nextPassword) {
      authUpdates.password = nextPassword;
    }

    if (Object.keys(authUpdates).length) {
      await adminAuth.updateUser(mapping.uid, authUpdates);
    }

    const userRecord = await adminAuth.getUser(mapping.uid);
    const existingClaims = userRecord.customClaims || {};
    await adminAuth.setCustomUserClaims(mapping.uid, {
      ...existingClaims,
      role: "client",
      clientId: mapping.clientId,
      clientName: mapping.clientName,
      loginId: nextLoginId || null,
      stateCode: mapping.stateCode ?? existingClaims.stateCode ?? null,
    });

    const auditEntry = buildServerAuditEvent(
      "client_user_updated",
      {
        uid: adminUser.uid,
        email: adminUser.email,
      },
      {
        mappingId: id,
        targetUid: mapping.uid,
        targetEmail: userRecord.email || mapping.authEmail || mapping.email || null,
        loginId: nextLoginId || null,
        passwordUpdated: Boolean(nextPassword),
      }
    );

    const batch = adminDb.batch();
    batch.set(
      mappingRef,
      {
        ...mappingUpdates,
        loginId: nextLoginId || null,
        email: userRecord.email || mapping.authEmail || mapping.email || null,
        authEmail: userRecord.email || mapping.authEmail || mapping.email || null,
        auditTrail: [...(((mappingSnap.data() as any)?.auditTrail as unknown[]) ?? []), auditEntry],
      },
      { merge: true }
    );
    batch.set(
      adminDb.collection("clientUsersByUid").doc(mapping.uid),
      {
        ...mappingUpdates,
        loginId: nextLoginId || null,
        email: userRecord.email || mapping.authEmail || mapping.email || null,
        authEmail: userRecord.email || mapping.authEmail || mapping.email || null,
        auditTrail: [...(((mappingSnap.data() as any)?.auditTrail as unknown[]) ?? []), auditEntry],
      },
      { merge: true }
    );
    await batch.commit();

    return NextResponse.json({
      ok: true,
      id,
      uid: mapping.uid,
      clientId: mapping.clientId,
      clientName: mapping.clientName,
      name: nextName,
      loginId: nextLoginId || null,
      email: userRecord.email || mapping.authEmail || mapping.email || null,
      authEmail: userRecord.email || mapping.authEmail || mapping.email || null,
    });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}

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
