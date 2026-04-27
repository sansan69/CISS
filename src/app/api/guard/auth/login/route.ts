import { NextResponse } from "next/server";
import { verifyPin } from "@/lib/guard/pin-utils";

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  return (
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.includes("[::1]")
  );
}

async function isCustomTokenAccepted(token: string): Promise<boolean> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) return false;

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        returnSecureToken: true,
      }),
    },
  );

  return response.ok;
}

async function fallbackToProductionLogin(
  body: Record<string, unknown>,
): Promise<Response> {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://cisskerala.site";

  return fetch(`${baseUrl.replace(/\/$/, "")}/api/guard/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phoneNumber, employeeId, pin } = body as {
      phoneNumber?: string;
      employeeId?: string;
      pin?: string;
    };

    if ((!phoneNumber && !employeeId) || !pin) {
      return NextResponse.json(
        { error: "phoneNumber or employeeId, and pin are required." },
        { status: 400 }
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const now = Date.now();
    const windowMs = 5 * 60 * 1000;

    // Rate limiting keyed by phoneNumber or employeeId
    const rateLimitKey = phoneNumber ? normalizePhone(phoneNumber) : `eid_${employeeId}`;
    const rateLimitRef = adminDb.doc(`rateLimits/login_${rateLimitKey}`);
    const rateLimitSnap = await rateLimitRef.get();

    if (rateLimitSnap.exists) {
      const data = rateLimitSnap.data()!;
      const windowStart: number = data.windowStart ?? 0;
      const attempts: number = data.attempts ?? 0;

      if (now - windowStart < windowMs && attempts >= 5) {
        return NextResponse.json(
          { error: "Too many login attempts. Please wait 5 minutes." },
          { status: 429 }
        );
      }

      if (now - windowStart >= windowMs) {
        await rateLimitRef.set({ windowStart: now, attempts: 1 });
      } else {
        await rateLimitRef.set(
          {
            windowStart,
            attempts: FieldValue.increment(1),
          },
          { merge: true },
        );
      }
    } else {
      await rateLimitRef.set({ windowStart: now, attempts: 1 });
    }

    // Find employee by phone number or employeeId
    const employeesRef = adminDb.collection("employees");
    let empQuery;

    if (employeeId) {
      empQuery = await employeesRef
        .where("employeeId", "==", employeeId)
        .limit(1)
        .get();
    } else {
      const normalizedPhone = normalizePhone(phoneNumber!);
      empQuery = await employeesRef
        .where("phoneNumber", "==", normalizedPhone)
        .limit(1)
        .get();
    }

    if (empQuery.empty) {
      return NextResponse.json(
        { error: "Employee not found." },
        { status: 404 }
      );
    }

    const empDoc = empQuery.docs[0];
    const empData = empDoc.data();

    // Check lockout
    if (empData.guardLockoutUntil) {
      const lockoutUntil =
        empData.guardLockoutUntil?.toMillis?.() ??
        Number(empData.guardLockoutUntil);
      if (now < lockoutUntil) {
        const secondsRemaining = Math.ceil((lockoutUntil - now) / 1000);
        return NextResponse.json(
          {
            error: `Account locked. Try again in ${secondsRemaining} seconds.`,
            lockedUntil: lockoutUntil,
          },
          { status: 429 }
        );
      }
    }

    // Check PIN is set
    if (!empData.guardPin || !empData.guardAuthUid) {
      return NextResponse.json(
        { error: "PIN not set. Please complete setup first." },
        { status: 400 }
      );
    }

    // Verify PIN
    const pinValid = await verifyPin(pin, empData.guardPin as string);

    if (!pinValid) {
      // Increment failed attempts
      const failedAttempts = ((empData.guardFailedAttempts as number) ?? 0) + 1;
      const updates: Record<string, unknown> = {
        guardFailedAttempts: failedAttempts,
      };

      if (failedAttempts >= 10) {
        // Lock for 15 minutes
        const lockUntil = new Date(now + 15 * 60 * 1000);
        updates.guardLockoutUntil = lockUntil;
      }

      await empDoc.ref.update(updates);

      return NextResponse.json({ error: "Incorrect PIN." }, { status: 401 });
    }

    // Success — reset failed attempts
    await empDoc.ref.update({
      guardFailedAttempts: 0,
      guardLastLogin: FieldValue.serverTimestamp(),
      guardLockoutUntil: FieldValue.delete(),
    });

    // Create custom token
    const { auth: adminAuth, customTokenAuth } = await import("@/lib/firebaseAdmin");
    const tokenIssuer = customTokenAuth ?? adminAuth;
    const customToken = await tokenIssuer.createCustomToken(
      empData.guardAuthUid as string,
      {
        role: "guard",
        employeeId: empData.employeeId,
        employeeDocId: empDoc.id,
      }
    );

    if (isLocalHost(request.headers.get("host"))) {
      const tokenAccepted = await isCustomTokenAccepted(customToken);
      if (!tokenAccepted) {
        const fallbackResponse = await fallbackToProductionLogin({
          phoneNumber,
          employeeId,
          pin,
        });
        const fallbackData = await fallbackResponse.json();
        return NextResponse.json(fallbackData, { status: fallbackResponse.status });
      }
    }

    return NextResponse.json({
      token: customToken,
      employeeName: empData.name ?? "",
    });
  } catch (err: unknown) {
    console.error("[guard/login]", err);
    const msg = err instanceof Error ? err.message : "Internal server error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
