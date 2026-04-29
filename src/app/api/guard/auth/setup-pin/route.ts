import { NextResponse } from "next/server";
import {
  guardDobMatches,
  normalizeGuardPhone,
} from "@/lib/guard/identity-utils";
import { hashPin, validatePinFormat } from "@/lib/guard/pin-utils";
import { GUARD_AUTH_EMAIL_DOMAIN } from "@/lib/runtime-config";

function buildSetupRateLimitKey(
  phoneNumber: string,
  employeeId: string | undefined,
  ip: string,
) {
  const phoneKey = normalizeGuardPhone(phoneNumber);
  if (phoneKey) {
    return `setup_${phoneKey}`;
  }

  const employeeKey = String(employeeId ?? "").trim();
  if (employeeKey) {
    return `setup_employee_${employeeKey}`;
  }

  return `setup_${ip}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { employeeId, phoneNumber, dateOfBirth, pin } = body as {
      employeeId?: string;
      phoneNumber?: string;
      dateOfBirth?: string;
      pin?: string;
    };
    const normalizedEmployeeId = String(employeeId ?? "").trim();
    const normalizedPhone = normalizeGuardPhone(String(phoneNumber ?? ""));
    const normalizedPin = String(pin ?? "").trim();

    if (!normalizedPhone || !dateOfBirth || !normalizedPin) {
      return NextResponse.json(
        { error: "phoneNumber, dateOfBirth, and pin are required." },
        { status: 400 }
      );
    }

    if (!normalizedEmployeeId && !normalizedPhone) {
      return NextResponse.json(
        { error: "Either employeeId or phoneNumber is required." },
        { status: 400 }
      );
    }
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const rateLimitRef = adminDb.doc(
      `rateLimits/${buildSetupRateLimitKey(normalizedPhone, normalizedEmployeeId, ip)}`,
    );
    const now = Date.now();
    const registerFailedAttempt = async () => {
      const rateLimitSnap = await rateLimitRef.get();
      const windowMs = 60 * 60 * 1000;

      if (!rateLimitSnap.exists) {
        await rateLimitRef.set({ windowStart: now, attempts: 1 });
        return false;
      }

      const data = rateLimitSnap.data()!;
      const windowStart: number = data.windowStart ?? 0;
      const attempts: number = data.attempts ?? 0;
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

    // Validate PIN format
    if (!validatePinFormat(normalizedPin)) {
      return NextResponse.json(
        { error: "PIN must be 4 to 6 digits." },
        { status: 400 }
      );
    }

    // Find employee by employeeId OR phoneNumber
    const employeesRef = adminDb.collection("employees");
    let empQuery;

    if (normalizedEmployeeId) {
      empQuery = await employeesRef
        .where("employeeId", "==", normalizedEmployeeId)
        .limit(1)
        .get();
    } else {
      empQuery = await employeesRef
        .where("phoneNumber", "==", normalizedPhone)
        .limit(1)
        .get();
    }

    if (empQuery.empty) {
      const blocked = await registerFailedAttempt();
      return NextResponse.json(
        { error: blocked ? "Too many attempts. Please try again later." : "Employee not found." },
        { status: blocked ? 429 : 404 },
      );
    }

    const empDoc = empQuery.docs[0];
    const empData = empDoc.data();

    // Verify phone number if employeeId was provided
    if (normalizedEmployeeId && normalizedPhone) {
      const storedPhone = normalizeGuardPhone(
        typeof empData.phoneNumber === "string" ? empData.phoneNumber : ""
      );

      if (storedPhone !== normalizedPhone) {
        const blocked = await registerFailedAttempt();
        return NextResponse.json(
          { error: blocked ? "Too many attempts. Please try again later." : "Identity verification failed." },
          { status: blocked ? 429 : 401 }
        );
      }
    }

    if (!guardDobMatches(empData.dateOfBirth, dateOfBirth)) {
      const blocked = await registerFailedAttempt();
      return NextResponse.json(
        { error: blocked ? "Too many attempts. Please try again later." : "Identity verification failed." },
        { status: blocked ? 429 : 401 }
      );
    }

    // Hash PIN
    const pinHash = await hashPin(normalizedPin);

    // Firebase Auth user email
    const guardEmail = `${normalizedPhone}@${GUARD_AUTH_EMAIL_DOMAIN}`;
    const { auth: adminAuth } = await import("@/lib/firebaseAdmin");

    let guardUid: string;

    // If guardAuthUid already exists, just update the pin; otherwise create new user
    if (empData.guardAuthUid) {
      guardUid = empData.guardAuthUid as string;
      // Update custom claims to ensure they are current
      try {
        await adminAuth.setCustomUserClaims(guardUid, {
          role: "guard",
          employeeId: empData.employeeId,
          employeeDocId: empDoc.id,
        });
      } catch {
        // If the user was deleted from Auth, recreate
        try {
          const newUser = await adminAuth.createUser({
            email: guardEmail,
            password: crypto.randomUUID(),
            displayName: typeof empData.name === "string" ? empData.name : undefined,
          });
          guardUid = newUser.uid;
          await adminAuth.setCustomUserClaims(guardUid, {
            role: "guard",
            employeeId: empData.employeeId,
            employeeDocId: empDoc.id,
          });
        } catch (createErr: unknown) {
          const msg = createErr instanceof Error ? createErr.message : "Unknown error";
          return NextResponse.json(
            { error: `Failed to create auth account: ${msg}` },
            { status: 500 }
          );
        }
      }
    } else {
      // Create new Firebase Auth user
      try {
        // Check if email already exists
        let existingUid: string | null = null;
        try {
          const existing = await adminAuth.getUserByEmail(guardEmail);
          existingUid = existing.uid;
        } catch {
          // user does not exist — normal path
        }

        if (existingUid) {
          guardUid = existingUid;
        } else {
          const newUser = await adminAuth.createUser({
            email: guardEmail,
            password: crypto.randomUUID(),
            displayName: typeof empData.name === "string" ? empData.name : undefined,
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
        return NextResponse.json(
          { error: `Failed to create auth account: ${msg}` },
          { status: 500 }
        );
      }
    }

    // Update employee doc
    await empDoc.ref.update({
      guardPin: pinHash,
      guardAuthUid: guardUid,
      guardPinSetAt: FieldValue.serverTimestamp(),
      guardFailedAttempts: 0,
      guardLockoutUntil: FieldValue.delete(),
    });

    await rateLimitRef.delete().catch(() => undefined);

    return NextResponse.json({
      success: true,
      message: "PIN set successfully. You can now log in.",
    });
  } catch (err: unknown) {
    console.error("[guard/setup-pin]", err);
    const msg = err instanceof Error ? err.message : "Internal server error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
