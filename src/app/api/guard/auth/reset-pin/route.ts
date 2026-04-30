import { NextResponse } from "next/server";
import { db as adminDb } from "@/lib/firebaseAdmin";
import { guardDobMatches, normalizeGuardPhone } from "@/lib/guard/identity-utils";
import { hashPin, validatePinFormat } from "@/lib/guard/pin-utils";
import { parseEmployeeQrText } from "@/lib/qr/employee-qr";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  unauthorizedResponse,
  verifyRequestAuth,
  type AppDecodedToken,
} from "@/lib/server/auth";
import { GUARD_AUTH_EMAIL_DOMAIN } from "@/lib/runtime-config";
import { districtMatches } from "@/lib/districts";
import { FieldValue } from "firebase-admin/firestore";

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

function buildResetRateLimitKey(employeeId: string, phoneNumber: string, ip: string) {
  if (phoneNumber) {
    return `reset_${phoneNumber}`;
  }

  if (employeeId) {
    return `reset_employee_${employeeId}`;
  }

  return `reset_${ip}`;
}

function normalizeLookup(body: Record<string, unknown>) {
  const parsedQr = parseEmployeeQrText(String(body.qrText ?? ""));
  const employeeId = normalizeText(body.employeeId ?? parsedQr.employeeId ?? "");
  const phoneNumber = normalizeGuardPhone(
    String(body.phoneNumber ?? parsedQr.phoneNumber ?? ""),
  );

  return { employeeId, phoneNumber };
}

async function tryVerifyActor(request: Request): Promise<AppDecodedToken | null> {
  try {
    return await verifyRequestAuth(request);
  } catch {
    return null;
  }
}

async function getAssignedDistricts(decoded: AppDecodedToken) {
  const foSnapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(1)
    .get();

  if (!foSnapshot.empty) {
    const foData = foSnapshot.docs[0].data();
    if (Array.isArray(foData.assignedDistricts)) {
      return foData.assignedDistricts.filter((district): district is string => typeof district === "string");
    }
  }

  return Array.isArray(decoded.assignedDistricts)
    ? decoded.assignedDistricts.filter((district): district is string => typeof district === "string")
    : [];
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
    const body = await request.json();
    const employeeDocId = normalizeText(body.employeeDocId ?? "");
    const reason = normalizeText(body.reason ?? "");
    const newPin = normalizeText(body.newPin ?? "");
    const dateOfBirth = normalizeText(body.dateOfBirth ?? "");
    const { employeeId, phoneNumber } = normalizeLookup(body);
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const rateLimitRef = adminDb.doc(
      `rateLimits/${buildResetRateLimitKey(employeeId, phoneNumber, ip)}`,
    );

    const actor = await tryVerifyActor(request);
    const isPrivilegedReset = Boolean(actor && (hasAdminAccess(actor) || hasFieldOfficerAccess(actor)));
    const resetMode = isPrivilegedReset ? (hasFieldOfficerAccess(actor!) ? "field-officer" : "admin") : "self-service";

    const registerFailedAttempt = async () => {
      const now = Date.now();
      const rateLimitSnap = await rateLimitRef.get();
      const windowMs = 60 * 60 * 1000;

      if (!rateLimitSnap.exists) {
        await rateLimitRef.set({ windowStart: now, attempts: 1 });
        return false;
      }

      const data = rateLimitSnap.data() as Record<string, unknown>;
      const windowStart = typeof data.windowStart === "number" ? data.windowStart : 0;
      const attempts = typeof data.attempts === "number" ? data.attempts : 0;
      const withinWindow = now - windowStart < windowMs;
      const nextAttempts = withinWindow ? attempts + 1 : 1;

      await rateLimitRef.set(
        {
          windowStart: withinWindow ? windowStart : now,
          attempts: nextAttempts,
        },
        { merge: true },
      );

      return withinWindow && nextAttempts >= 5;
    };

    if (!validatePinFormat(newPin)) {
      return NextResponse.json({ error: "PIN must be 4 to 6 digits." }, { status: 400 });
    }

    const requiresIdentityCheck = !isPrivilegedReset;
    if (requiresIdentityCheck && !dateOfBirth) {
      return NextResponse.json({ error: "Date of birth is required." }, { status: 400 });
    }

    if (requiresIdentityCheck && !employeeId && !phoneNumber) {
      return NextResponse.json({ error: "Employee ID, phone number, or QR code is required." }, { status: 400 });
    }

    const employeeDoc = await findEmployeeDoc({
      employeeDocId,
      employeeId,
      phoneNumber,
    });

    if (!employeeDoc) {
      if (!isPrivilegedReset) {
        const blocked = await registerFailedAttempt();
        return NextResponse.json(
          { error: blocked ? "Too many attempts. Please try again later." : "Employee not found." },
          { status: blocked ? 429 : 404 },
        );
      }
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const empData = employeeDoc.data() as Record<string, unknown>;

    if (isPrivilegedReset && hasFieldOfficerAccess(actor!)) {
      const assignedDistricts = await getAssignedDistricts(actor!);
      if (assignedDistricts.length === 0) {
        return NextResponse.json(
          { error: "No districts are assigned to your account." },
          { status: 403 },
        );
      }

      const district = typeof empData.district === "string" ? empData.district : "";
      if (!assignedDistricts.some((assigned) => districtMatches(assigned, district))) {
        return NextResponse.json(
          { error: "This guard is outside your assigned districts." },
          { status: 403 },
        );
      }
    }

    if (requiresIdentityCheck) {
      const storedPhone = normalizeGuardPhone(
        typeof empData.phoneNumber === "string" ? empData.phoneNumber : "",
      );
      if (phoneNumber && storedPhone && storedPhone !== phoneNumber) {
        const blocked = await registerFailedAttempt();
        return NextResponse.json(
          { error: blocked ? "Too many attempts. Please try again later." : "Identity verification failed." },
          { status: blocked ? 429 : 401 },
        );
      }

      if (!guardDobMatches(empData.dateOfBirth, dateOfBirth)) {
        const blocked = await registerFailedAttempt();
        return NextResponse.json(
          { error: blocked ? "Too many attempts. Please try again later." : "Identity verification failed." },
          { status: blocked ? 429 : 401 },
        );
      }
    }

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
      mode: resetMode,
      employeeDocId: employeeDoc.id,
      employeeId: empData.employeeId ?? null,
      targetPhoneNumber: typeof empData.phoneNumber === "string" ? empData.phoneNumber : null,
      district: typeof empData.district === "string" ? empData.district : null,
      reason: reason || null,
      byUid: actor?.uid ?? null,
      byEmail: actor?.email ?? null,
      at: FieldValue.serverTimestamp(),
    });

    await rateLimitRef.delete().catch(() => undefined);

    return NextResponse.json({
      success: true,
      message: requiresIdentityCheck
        ? "Your PIN has been reset. Please log in with the new PIN."
        : "PIN reset successfully.",
    });
  } catch (error) {
    console.error("PIN reset error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    if (message.includes("Field officer or admin access required")) {
      return unauthorizedResponse(message, 403);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
