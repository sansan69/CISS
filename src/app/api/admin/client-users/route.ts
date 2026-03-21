import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import {
  buildServerAuditEvent,
  buildServerCreateAudit,
} from "@/lib/server/audit";
import {
  SYSTEM_METRIC_NAMES,
  incrementSystemMetric,
} from "@/lib/server/monitoring";
import { REGION_CODE } from "@/lib/runtime-config";

type ClientUserRequest = {
  mode: "existing" | "create";
  clientId?: string;
  clientName?: string;
  email?: string;
  password?: string;
  name?: string;
};

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
    const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as ClientUserRequest;
    const clientId = body.clientId?.trim();
    const clientName = body.clientName?.trim();
    const email = body.email?.trim();
    const stateCode =
      typeof adminUser.stateCode === "string" && adminUser.stateCode.trim()
        ? adminUser.stateCode.trim().toUpperCase()
        : REGION_CODE;

    if (!clientId || !clientName || !email) {
      return NextResponse.json(
        { error: "Client and user details are required." },
        { status: 400 }
      );
    }

    let userRecord;
    if (body.mode === "create") {
      if (!body.password) {
        return NextResponse.json(
          { error: "Password is required when creating a client user." },
          { status: 400 }
        );
      }

      userRecord = await adminAuth.createUser({
        email,
        password: body.password,
        displayName: body.name?.trim() || undefined,
      });
    } else {
      userRecord = await adminAuth.getUserByEmail(email);
    }

    await adminAuth.setCustomUserClaims(userRecord.uid, {
      role: "client",
      clientId,
      stateCode,
    });

    const payload = {
      uid: userRecord.uid,
      email: userRecord.email || email,
      name: body.name?.trim() || userRecord.displayName || email.split("@")[0],
      clientId,
      clientName,
      stateCode,
      ...buildServerCreateAudit({
        uid: adminUser.uid,
        email: adminUser.email,
      }),
      auditTrail: [
        buildServerAuditEvent(
          body.mode === "create" ? "client_user_created" : "client_user_linked",
          {
            uid: adminUser.uid,
            email: adminUser.email,
          },
          {
            clientId,
            clientName,
            targetUid: userRecord.uid,
            targetEmail: userRecord.email || email,
          },
        ),
      ],
    };

    const existing = await adminDb
      .collection("clientUsers")
      .where("uid", "==", userRecord.uid)
      .where("clientId", "==", clientId)
      .limit(1)
      .get();

    if (!existing.empty) {
      return NextResponse.json(
        { error: "This user is already linked to the selected client." },
        { status: 409 }
      );
    }

    const mappingRef = adminDb.collection("clientUsers").doc();
    const batch = adminDb.batch();
    batch.set(mappingRef, payload);
    batch.set(adminDb.collection("clientUsersByUid").doc(userRecord.uid), payload);
    await batch.commit();

    await incrementSystemMetric(SYSTEM_METRIC_NAMES.adminProvisionSuccess);

    return NextResponse.json({ id: mappingRef.id, ...payload });
  } catch (error: any) {
    await incrementSystemMetric(SYSTEM_METRIC_NAMES.adminProvisionFailure);
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
