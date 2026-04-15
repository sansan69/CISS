import { NextResponse } from "next/server";
import { hashPin, validatePinFormat } from "@/lib/guard/pin-utils";
import { GUARD_AUTH_EMAIL_DOMAIN } from "@/lib/runtime-config";

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
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

    if (!phoneNumber || !dateOfBirth || !pin) {
      return NextResponse.json(
        { error: "phoneNumber, dateOfBirth, and pin are required." },
        { status: 400 }
      );
    }

    if (!employeeId && !phoneNumber) {
      return NextResponse.json(
        { error: "Either employeeId or phoneNumber is required." },
        { status: 400 }
      );
    }

    // Rate limiting — max 5 attempts per hour per IP
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const rateLimitRef = adminDb.doc(`rateLimits/setup_${ip}`);
    const rateLimitSnap = await rateLimitRef.get();
    const now = Date.now();

    if (rateLimitSnap.exists) {
      const data = rateLimitSnap.data()!;
      const windowStart: number = data.windowStart ?? 0;
      const attempts: number = data.attempts ?? 0;
      const windowMs = 60 * 60 * 1000; // 1 hour

      if (now - windowStart < windowMs && attempts >= 5) {
        return NextResponse.json(
          { error: "Too many attempts. Please try again later." },
          { status: 429 }
        );
      }

      if (now - windowStart >= windowMs) {
        await rateLimitRef.set({ windowStart: now, attempts: 1 });
      } else {
        await rateLimitRef.update({ attempts: FieldValue.increment(1) });
      }
    } else {
      await rateLimitRef.set({ windowStart: now, attempts: 1 });
    }

    // Validate PIN format
    if (!validatePinFormat(pin)) {
      return NextResponse.json(
        { error: "PIN must be 4 to 6 digits." },
        { status: 400 }
      );
    }

    // Find employee by employeeId OR phoneNumber
    const employeesRef = adminDb.collection("employees");
    let empQuery;

    if (employeeId) {
      empQuery = await employeesRef
        .where("employeeId", "==", employeeId)
        .limit(1)
        .get();
    } else {
      empQuery = await employeesRef
        .where("phoneNumber", "==", normalizePhone(phoneNumber))
        .limit(1)
        .get();
    }

    if (empQuery.empty) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const empDoc = empQuery.docs[0];
    const empData = empDoc.data();
    const inputPhone = normalizePhone(phoneNumber);

    // Verify phone number if employeeId was provided
    if (employeeId && phoneNumber) {
      const storedPhone = normalizePhone(
        typeof empData.phoneNumber === "string" ? empData.phoneNumber : ""
      );

      if (storedPhone !== inputPhone) {
        return NextResponse.json(
          { error: "Identity verification failed." },
          { status: 401 }
        );
      }
    }

    // Verify date of birth (YYYY-MM-DD)
    const storedDob =
      typeof empData.dateOfBirth === "string" ? empData.dateOfBirth.trim() : "";
    const inputDob = dateOfBirth.trim();

    if (storedDob !== inputDob) {
      return NextResponse.json(
        { error: "Identity verification failed." },
        { status: 401 }
      );
    }

    // Hash PIN
    const pinHash = await hashPin(pin);

    // Firebase Auth user email
    const guardEmail = `${inputPhone}@${GUARD_AUTH_EMAIL_DOMAIN}`;
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
    });

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
