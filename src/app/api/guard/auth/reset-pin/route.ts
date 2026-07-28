import { NextResponse } from "next/server";
import { db as adminDb } from "@/lib/firebaseAdmin";
import { normalizeGuardPhone } from "@/lib/guard/identity-utils";
import { hashPin, validatePinFormat } from "@/lib/guard/pin-utils";
import { parseEmployeeQrText } from "@/lib/qr/employee-qr";
import {
  requireAdmin,
  unauthorizedResponse,
} from "@/lib/server/auth";
import { GUARD_AUTH_EMAIL_DOMAIN } from "@/lib/runtime-config";
import { FieldValue } from "firebase-admin/firestore";
export const runtime = "nodejs";

type EmployeeDocLike = {
  id: string;
  data: () => Record<string, unknown>;
  ref: {
    update: (data: Record<string, unknown>) => Promise<unknown>;
  };
};

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLookup(body: Record<string, unknown>) {
  const parsedQr = parseEmployeeQrText(String(body.qrText ?? ""));
  const employeeId = normalizeText(body.employeeId ?? parsedQr.employeeId ?? "");
  const phoneNumber = normalizeGuardPhone(
    String(body.phoneNumber ?? parsedQr.phoneNumber ?? ""),
  );

  return { employeeId, phoneNumber };
}

async function findEmployeeDoc(
  lookup: { employeeId: string; phoneNumber: string; employeeDocId?: string },
): Promise<EmployeeDocLike | null> {
  if (lookup.employeeDocId) {
    const docRef = adminDb.collection("employees").doc(lookup.employeeDocId);
    const snap = await docRef.get();
    return snap.exists
      ? {
          id: snap.id,
          data: () => snap.data() as Record<string, unknown>,
          ref: docRef,
        } satisfies EmployeeDocLike
      : null;
  }

  const employeesRef = adminDb.collection("employees");
    if (lookup.employeeId) {
      let query = await employeesRef.where("employeeId", "==", lookup.employeeId).limit(1).get();
      if (query.empty) {
        query = await employeesRef.where("legacyUniqueId", "==", lookup.employeeId).limit(1).get();
      }
      if (!query.empty) {
        return query.docs[0] as unknown as EmployeeDocLike;
      }
    }

  if (lookup.phoneNumber) {
    const query = await employeesRef.where("phoneNumber", "==", lookup.phoneNumber).limit(1).get();
    if (!query.empty) {
      return query.docs[0] as unknown as EmployeeDocLike;
    }
  }

  return null;
}

async function ensureGuardAuthAccount(empDoc: EmployeeDocLike) {
  const empData = empDoc.data() as Record<string, unknown>;
  const guardPhone = normalizeGuardPhone(typeof empData.phoneNumber === "string" ? empData.phoneNumber : "");
  if (!guardPhone) {
    throw new Error("Employee phone number is required to create a guard auth account.");
  }

  const guardEmail = `${guardPhone}@${GUARD_AUTH_EMAIL_DOMAIN}`;
  const { auth: adminAuth } = await import("@/lib/firebaseAdmin");

  let guardUid: string;
  if (typeof empData.guardAuthUid === "string" && empData.guardAuthUid) {
    guardUid = empData.guardAuthUid;
    try {
      await adminAuth.setCustomUserClaims(guardUid, {
        role: "guard",
        employeeId: empData.employeeId,
        employeeDocId: empDoc.id,
      });
    } catch {
      try {
        const newUser = await adminAuth.createUser({
          email: guardEmail,
          password: crypto.randomUUID(),
          displayName: typeof empData.fullName === "string" ? empData.fullName : undefined,
        });
        guardUid = newUser.uid;
        await adminAuth.setCustomUserClaims(guardUid, {
          role: "guard",
          employeeId: empData.employeeId,
          employeeDocId: empDoc.id,
        });
      } catch (createErr: unknown) {
        const msg = createErr instanceof Error ? createErr.message : "Unknown error";
        throw new Error(`Failed to create auth account: ${msg}`);
      }
    }
  } else {
    try {
      let existingUid: string | null = null;
      try {
        const existing = await adminAuth.getUserByEmail(guardEmail);
        existingUid = existing.uid;
      } catch {
        // Normal path: auth user does not exist yet.
      }

      if (existingUid) {
        guardUid = existingUid;
      } else {
        const newUser = await adminAuth.createUser({
          email: guardEmail,
          password: crypto.randomUUID(),
          displayName: typeof empData.fullName === "string" ? empData.fullName : undefined,
        });
        guardUid = newUser.uid;
      }

      await adminAuth.setCustomUserClaims(guardUid, {
        role: "guard",
        employeeId: empData.employeeId,
        employeeDocId: empDoc.id,
      });
    } catch (createErr: unknown) {
      const msg = createErr instanceof Error ? createErr.message : "Unknown error";
      throw new Error(`Failed to create auth account: ${msg}`);
    }
  }

  return guardUid;
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const body = (await request.json()) as Record<string, unknown>;
    const employeeDocId = normalizeText(body.employeeDocId ?? "");
    const reason = normalizeText(body.reason ?? "");
    const newPin = normalizeText(body.newPin ?? "");
    const { employeeId, phoneNumber } = normalizeLookup(body);

    if (!validatePinFormat(newPin)) {
      return NextResponse.json({ error: "PIN must be 4 to 6 digits." }, { status: 400 });
    }

    if (!employeeDocId && !employeeId && !phoneNumber) {
      return NextResponse.json({ error: "Employee ID, phone number, or QR code is required." }, { status: 400 });
    }
    if (reason.length < 3) {
      return NextResponse.json(
        { error: "A reset reason of at least 3 characters is required." },
        { status: 400 },
      );
    }

    const employeeDoc = await findEmployeeDoc({
      employeeDocId,
      employeeId,
      phoneNumber,
    });

    if (!employeeDoc) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const empData = employeeDoc.data() as Record<string, unknown>;

    const pinHash = await hashPin(newPin);
    const employeeRef = employeeDoc.ref;
    const guardUid = await ensureGuardAuthAccount(employeeDoc);

    await employeeRef.update({
      guardPin: pinHash,
      guardAuthUid: guardUid,
      guardPinSetAt: FieldValue.serverTimestamp(),
      guardFailedAttempts: 0,
      guardLockoutUntil: FieldValue.delete(),
    });

    await adminDb.collection("guardPinResetEvents").add({
      action: "guard_pin_reset",
      mode: "admin",
      employeeDocId: employeeDoc.id,
      employeeId: empData.employeeId ?? null,
      targetPhoneNumber: typeof empData.phoneNumber === "string" ? empData.phoneNumber : null,
      district: typeof empData.district === "string" ? empData.district : null,
      reason,
      byUid: actor.uid,
      byEmail: actor.email ?? null,
      at: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: "PIN reset successfully. The action was recorded in the audit log.",
    });
  } catch (error) {
    console.error("PIN reset error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    if (message.includes("Admin access required") || message.includes("Missing bearer token")) {
      return unauthorizedResponse(message, 403);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
