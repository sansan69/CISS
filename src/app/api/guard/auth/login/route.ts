import { NextResponse } from "next/server";
import {
  parseGuardEmployeeIdInput,
  parseGuardPhoneInput,
} from "@/lib/guard/identity-utils";
import { buildFailedPinAttemptUpdate } from "@/lib/guard/login-attempt-utils";
import {
  hashPin,
  validatePinFormat,
  verifyDummyPin,
  verifyPinWithMetadata,
} from "@/lib/guard/pin-utils";
import {
  checkRateLimit,
  getClientIp,
  buildRateLimitKey,
} from "@/lib/server/rate-limit";
import crypto from "node:crypto";
import { mirrorGuardPin } from "@/lib/server/guard-credentials";
export const runtime = "nodejs";

const AUTH_FAILURE_MESSAGE = "Invalid sign-in details. Please try again.";
const IDENTIFIER_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const IDENTIFIER_RATE_LIMIT_MAX = 10;

function identifierFingerprint(identifier: string) {
  return crypto
    .createHash("sha256")
    .update(identifier)
    .digest("hex")
    .slice(0, 24);
}

function authenticationFailure() {
  return NextResponse.json({ error: AUTH_FAILURE_MESSAGE }, { status: 401 });
}

function getLockoutUntil(value: unknown): number | null {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  if (value && typeof value === "object" && "toMillis" in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") {
      return toMillis.call(value) as number;
    }
  }

  return null;
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
  request: Request,
  body: Record<string, unknown>,
): Promise<Response | null> {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://cisskerala.site";
  const target = new URL(`${baseUrl.replace(/\/$/, "")}/api/guard/auth/login`);

  // Never re-enter this same server: in local development NEXT_PUBLIC_APP_URL
  // often points at the dev host, which turned one login into a request storm.
  try {
    if (new URL(request.url).origin === target.origin) return null;
  } catch {
    return null;
  }

  return fetch(target.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export async function POST(request: Request) {
  try {
    // IP-based rate limiting (independent of per-user lockout) bounds enumeration/credential-stuffing
    const ip = getClientIp(request);
    const ipRateKey = buildRateLimitKey("guard-login", ip);
    const ipRateResult = await checkRateLimit(ipRateKey, {
      maxRequests: 20,
      windowMs: 60 * 1000, // 20 requests per minute per IP
      failClosed: true, // Fail closed for security-critical endpoint
    });
    if (!ipRateResult.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Please wait and try again." },
        { status: 429 },
      );
    }

    const body = await request.json();
    const { phoneNumber, employeeId, pin } = body as {
      phoneNumber?: string;
      employeeId?: string;
      pin?: string;
    };
    const suppliedPhone = typeof phoneNumber === "string" ? phoneNumber : "";
    const suppliedEmployeeId =
      typeof employeeId === "string" ? employeeId : "";
    const normalizedPhone = suppliedPhone.trim()
      ? parseGuardPhoneInput(suppliedPhone)
      : "";
    const normalizedEmployeeId = suppliedEmployeeId.trim()
      ? parseGuardEmployeeIdInput(suppliedEmployeeId)
      : "";
    const normalizedPin = String(pin ?? "").trim();

    if (
      (suppliedPhone.trim() && !normalizedPhone) ||
      (suppliedEmployeeId.trim() && !normalizedEmployeeId) ||
      (!normalizedPhone && !normalizedEmployeeId) ||
      !normalizedPin
    ) {
      return NextResponse.json(
        { error: "phoneNumber or employeeId, and pin are required." },
        { status: 400 },
      );
    }

    if (!validatePinFormat(normalizedPin)) {
      return NextResponse.json(
        { error: "PIN must be 4 to 6 digits." },
        { status: 400 },
      );
    }

    const identifiers = [
      ...(normalizedEmployeeId ? [`employee:${normalizedEmployeeId}`] : []),
      ...(normalizedPhone ? [`phone:${normalizedPhone}`] : []),
    ];
    for (const identifier of identifiers) {
      const identifierRateResult = await checkRateLimit(
        buildRateLimitKey(
          "guard-login-identifier",
          identifierFingerprint(identifier),
        ),
        {
          maxRequests: IDENTIFIER_RATE_LIMIT_MAX,
          windowMs: IDENTIFIER_RATE_LIMIT_WINDOW_MS,
          failClosed: true,
        },
      );
      if (!identifierRateResult.allowed) {
        return NextResponse.json(
          { error: "Too many login attempts. Please wait and try again." },
          { status: 429 },
        );
      }
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const now = Date.now();

    // Resolve supplied identifiers independently. A request that includes both
    // must refer to one employee; selecting by either would permit identity mixups.
    const employeesRef = adminDb.collection("employees");
    let employeeIdQuery;

    if (normalizedEmployeeId) {
      employeeIdQuery = await employeesRef
        .where("employeeId", "==", normalizedEmployeeId)
        .limit(1)
        .get();

      if (employeeIdQuery.empty) {
        employeeIdQuery = await employeesRef
          .where("legacyUniqueId", "==", normalizedEmployeeId)
          .limit(1)
          .get();
      }
    }

    let phoneQuery;
    if (normalizedPhone) {
      phoneQuery = await employeesRef
        .where("phoneNumber", "==", normalizedPhone)
        .limit(1)
        .get();
    }

    if (
      employeeIdQuery &&
      phoneQuery &&
      (!employeeIdQuery.empty && !phoneQuery.empty
        ? employeeIdQuery.docs[0].id !== phoneQuery.docs[0].id
        : employeeIdQuery.empty !== phoneQuery.empty)
    ) {
      await verifyDummyPin(normalizedPin);
      return authenticationFailure();
    }

    const empQuery = employeeIdQuery ?? phoneQuery;
    if (!empQuery || empQuery.empty) {
      await verifyDummyPin(normalizedPin);
      return authenticationFailure();
    }

    const empDoc = empQuery.docs[0];
    const loginResult = await adminDb.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(empDoc.ref);
      if (!currentSnapshot.exists) {
        return { authenticated: false, useDummyKdf: true };
      }

      const currentData = currentSnapshot.data() as Record<string, unknown>;
      const employeeStatus = String(currentData.status ?? "Active")
        .trim()
        .toLowerCase();
      const lockoutUntil = getLockoutUntil(currentData.guardLockoutUntil);
      if (
        employeeStatus !== "active" ||
        (lockoutUntil !== null && now < lockoutUntil) ||
        typeof currentData.guardPin !== "string" ||
        !currentData.guardAuthUid
      ) {
        return { authenticated: false, useDummyKdf: true };
      }

      const verification = await verifyPinWithMetadata(
        normalizedPin,
        currentData.guardPin,
      );
      if (!verification.valid) {
        transaction.update(
          empDoc.ref,
          buildFailedPinAttemptUpdate(currentData.guardFailedAttempts, now),
        );
        return {
          authenticated: false,
          useDummyKdf: !verification.performedMemoryHardWork,
        };
      }

      const migratedPin = verification.needsMigration
        ? await hashPin(normalizedPin)
        : undefined;
      transaction.update(empDoc.ref, {
        guardFailedAttempts: 0,
        guardLastLogin: FieldValue.serverTimestamp(),
        guardLockoutUntil: FieldValue.delete(),
        ...(migratedPin ? { guardPin: migratedPin } : {}),
      });
      return { authenticated: true, data: currentData, migratedPin };
    });

    if (!loginResult.authenticated || !loginResult.data) {
      if (loginResult.useDummyKdf) {
        await verifyDummyPin(normalizedPin);
      }
      return authenticationFailure();
    }

    // Keep the server-only credential store in step while `employees.guardPin`
    // is still the authoritative copy (migration phase 1).
    if (loginResult.migratedPin) {
      await mirrorGuardPin(adminDb, empDoc.id, loginResult.migratedPin);
    }

    // Create custom token
    const { auth: adminAuth, customTokenAuth } =
      await import("@/lib/firebaseAdmin");
    const tokenIssuer = customTokenAuth ?? adminAuth;
    const customToken = await tokenIssuer.createCustomToken(
      loginResult.data.guardAuthUid as string,
      {
        role: "guard",
        employeeId: loginResult.data.employeeId,
        employeeDocId: empDoc.id,
      },
    );

    if (isLocalHost(request.headers.get("host"))) {
      const tokenAccepted = await isCustomTokenAccepted(customToken);
      if (!tokenAccepted) {
        const fallbackResponse = await fallbackToProductionLogin(request, {
          phoneNumber: normalizedPhone || undefined,
          employeeId: normalizedEmployeeId || undefined,
          pin: normalizedPin,
        });
        if (fallbackResponse) {
          const fallbackData = await fallbackResponse.json();
          return NextResponse.json(fallbackData, {
            status: fallbackResponse.status,
          });
        }
      }
    }

    return NextResponse.json({
      token: customToken,
      employeeName: loginResult.data.name ?? "",
    });
  } catch (err: unknown) {
    console.error("[guard/login]", err);
    return NextResponse.json(
      { error: "Could not complete sign-in." },
      { status: 500 },
    );
  }
}
