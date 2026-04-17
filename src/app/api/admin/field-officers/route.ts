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

type OfficerRequest = {
  uid?: string;
  email?: string;
  name?: string;
  password?: string;
  assignedDistricts?: string[];
};

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
    const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as OfficerRequest;
    const assignedDistricts = body.assignedDistricts || [];
    const name = body.name?.trim();
    const stateCode =
      typeof adminUser.stateCode === "string" && adminUser.stateCode.trim()
        ? adminUser.stateCode.trim().toUpperCase()
        : REGION_CODE;

    if (!name || !body.email) {
      return NextResponse.json(
        { error: "Officer name and email are required." },
        { status: 400 }
      );
    }

    let uid = body.uid;
    if (!uid) {
      if (!body.password) {
        return NextResponse.json(
          { error: "Password is required when creating a new auth user." },
          { status: 400 }
        );
      }
      // Check for duplicate email before attempting to create
      try {
        const existing = await adminAuth.getUserByEmail(body.email);
        if (existing) {
          return NextResponse.json(
            { error: "An account with this email already exists. Provide the existing UID to link them instead." },
            { status: 409 }
          );
        }
      } catch (e: any) {
        // auth/user-not-found is expected — means email is available
        if (e?.code !== "auth/user-not-found") throw e;
      }
      const createdUser = await adminAuth.createUser({
        email: body.email,
        password: body.password,
        displayName: name,
        emailVerified: true,
      });
      uid = createdUser.uid;
    }

    // Check for conflicting existing claims before overwriting
    if (body.uid) {
      const existingUser = await adminAuth.getUser(uid);
      const existingClaims = existingUser.customClaims as Record<string, unknown> | undefined;
      if (existingClaims?.role && existingClaims.role !== "fieldOfficer") {
        return NextResponse.json(
          { error: `This user already has the role '${existingClaims.role}'. Remove that role first before assigning as a field officer.` },
          { status: 409 }
        );
      }
    }

    await adminAuth.setCustomUserClaims(uid, {
      role: "fieldOfficer",
      stateCode,
      assignedDistricts,
    });

    const existingOfficer = await adminDb
      .collection("fieldOfficers")
      .where("uid", "==", uid)
      .limit(1)
      .get();

    if (!existingOfficer.empty) {
      return NextResponse.json(
        { error: "This user is already assigned as a field officer." },
        { status: 409 }
      );
    }

    const docRef = await adminDb.collection("fieldOfficers").add({
      uid,
      email: body.email,
      name,
      stateCode,
      assignedDistricts,
      ...buildServerCreateAudit({
        uid: adminUser.uid,
        email: adminUser.email,
      }),
      auditTrail: [
        buildServerAuditEvent(
          body.uid ? "field_officer_linked" : "field_officer_created",
          {
            uid: adminUser.uid,
            email: adminUser.email,
          },
          {
            targetUid: uid,
            targetEmail: body.email,
            assignedDistricts,
          },
        ),
      ],
    });

    await incrementSystemMetric(SYSTEM_METRIC_NAMES.adminProvisionSuccess);

    return NextResponse.json({
      id: docRef.id,
      uid,
      email: body.email,
      name,
      stateCode,
      assignedDistricts,
    });
  } catch (error: any) {
    await incrementSystemMetric(SYSTEM_METRIC_NAMES.adminProvisionFailure);
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
