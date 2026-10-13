import { NextResponse } from "next/server";
import {
  guardDobMatches,
  parseGuardEmployeeIdInput,
  parseGuardPhoneInput,
} from "@/lib/guard/identity-utils";
import { hashPin, validatePinFormat } from "@/lib/guard/pin-utils";
import { GUARD_AUTH_EMAIL_DOMAIN } from "@/lib/runtime-config";
import {
  buildRateLimitKey,
  checkRateLimit,
  getClientIp,
} from "@/lib/server/rate-limit";
import crypto from "node:crypto";
export const runtime = "nodejs";

const AUTH_FAILURE_MESSAGE = "Invalid sign-in details. Please try again.";
const AUTH_RATE_LIMIT_MESSAGE =
  "Too many login attempts. Please wait and try again.";
const IDENTIFIER_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const IDENTIFIER_RATE_LIMIT_MAX = 10;
const IP_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const IP_RATE_LIMIT_MAX = 15;

function identifierFingerprint(identifier: string) {
  return crypto
    .createHash("sha256")
    .update(identifier)
    .digest("hex")
    .slice(0, 24);
}

function setupFailure() {
  return NextResponse.json(
    { error: "Could not complete PIN setup." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    // This must run before parsing a potentially expensive or malformed body.
    const ipRateResult = await checkRateLimit(
      buildRateLimitKey("guard-setup-pin-ip", getClientIp(request)),
      {
        maxRequests: IP_RATE_LIMIT_MAX,
        windowMs: IP_RATE_LIMIT_WINDOW_MS,
        failClosed: true,
      },
    );
    if (!ipRateResult.allowed) {
      return NextResponse.json(
        { error: AUTH_RATE_LIMIT_MESSAGE },
        { status: 429 },
      );
    }

    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "phoneNumber, dateOfBirth, and pin are required." },
        { status: 400 },
      );
    }
    const { employeeId, phoneNumber, dateOfBirth, pin } = body as {
      employeeId?: string;
      phoneNumber?: string;
      dateOfBirth?: string;
      pin?: string;
    };
    const suppliedEmployeeId =
      typeof employeeId === "string" ? employeeId : "";
    const normalizedEmployeeId = suppliedEmployeeId.trim()
      ? parseGuardEmployeeIdInput(suppliedEmployeeId)
      : "";
    const suppliedPhone = typeof phoneNumber === "string" ? phoneNumber : "";
    const normalizedPhone = parseGuardPhoneInput(suppliedPhone);
    const normalizedPin = String(pin ?? "").trim();

    if (
      !normalizedPhone ||
      !dateOfBirth ||
      !normalizedPin ||
      (suppliedEmployeeId.trim() && !normalizedEmployeeId)
    ) {
      return NextResponse.json(
        { error: "phoneNumber, dateOfBirth, and pin are required." },
        { status: 400 },
      );
    }

    if (!normalizedEmployeeId && !normalizedPhone) {
      return NextResponse.json(
        { error: "Either employeeId or phoneNumber is required." },
        { status: 400 },
      );
    }
    const identifiers = [
      ...(normalizedEmployeeId ? [`employee:${normalizedEmployeeId}`] : []),
      `phone:${normalizedPhone}`,
    ];
    for (const identifier of identifiers) {
      const rateLimitResult = await checkRateLimit(
        buildRateLimitKey(
          "guard-setup-pin-identifier",
          identifierFingerprint(identifier),
        ),
        {
          maxRequests: IDENTIFIER_RATE_LIMIT_MAX,
          windowMs: IDENTIFIER_RATE_LIMIT_WINDOW_MS,
          failClosed: true,
        },
      );
      if (!rateLimitResult.allowed) {
        return NextResponse.json(
          { error: AUTH_RATE_LIMIT_MESSAGE },
          { status: 429 },
        );
      }
    }

    // Validate PIN format
    if (!validatePinFormat(normalizedPin)) {
      return NextResponse.json(
        { error: "PIN must be 4 to 6 digits." },
        { status: 400 },
      );
    }

    const identityVerificationFailed = () =>
      NextResponse.json({ error: AUTH_FAILURE_MESSAGE }, { status: 401 });

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    // Resolve every supplied identifier independently. Neither identifier may
    // silently fall back to the other: doing so would let an unknown employee
    // ID be masked by a valid phone number.
    const employeesRef = adminDb.collection("employees");
    let employeeIdQuery = null;
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
    const phoneQuery = await employeesRef
      .where("phoneNumber", "==", normalizedPhone)
      .limit(1)
      .get();

    if (
      phoneQuery.empty ||
      (employeeIdQuery?.empty ?? false) ||
      (employeeIdQuery && employeeIdQuery.docs[0].id !== phoneQuery.docs[0].id)
    ) {
      return identityVerificationFailed();
    }

    const empDoc = employeeIdQuery?.docs[0] ?? phoneQuery.docs[0];
    const empData = empDoc.data();
    const employeeStatus = String(empData.status ?? "Active")
      .trim()
      .toLowerCase();
    if (employeeStatus !== "active") {
      return identityVerificationFailed();
    }

    if (!guardDobMatches(empData.dateOfBirth, dateOfBirth)) {
      return identityVerificationFailed();
    }

    if (empData.guardPin || empData.guardAuthUid) {
      return identityVerificationFailed();
    }

    // Hash before reserving so the transaction remains short. The reservation
    // and final write are compare-and-set transactions, which makes concurrent
    // setup attempts elect exactly one winner.
    const pinHash = await hashPin(normalizedPin);
    const reservationId = crypto.randomUUID();
    const reservationExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const reserved = await adminDb.runTransaction(async (transaction) => {
      const current = await transaction.get(empDoc.ref);
      if (!current.exists) return false;
      const currentData = current.data() as Record<string, unknown>;
      const currentStatus = String(currentData.status ?? "Active").trim().toLowerCase();
      const existingReservation = currentData.guardPinSetupReservation as
        | { id?: unknown; expiresAt?: { toMillis?: () => number } | Date }
        | undefined;
      const reservationExpires = existingReservation?.expiresAt instanceof Date
        ? existingReservation.expiresAt.getTime()
        : existingReservation?.expiresAt && typeof existingReservation.expiresAt.toMillis === "function"
          ? existingReservation.expiresAt.toMillis()
          : 0;
      if (
        currentStatus !== "active" ||
        !guardDobMatches(currentData.dateOfBirth, dateOfBirth) ||
        currentData.guardPin ||
        currentData.guardAuthUid ||
        (existingReservation && reservationExpires > Date.now())
      ) {
        return false;
      }
      transaction.update(empDoc.ref, {
        guardPinSetupReservation: { id: reservationId, expiresAt: reservationExpiresAt },
      });
      return true;
    });
    if (!reserved) return identityVerificationFailed();

    // Firebase Auth user email
    const guardEmail = `${normalizedPhone}@${GUARD_AUTH_EMAIL_DOMAIN}`;
    const { auth: adminAuth } = await import("@/lib/firebaseAdmin");

    let guardUid: string;
    try {
      try {
        guardUid = (await adminAuth.getUserByEmail(guardEmail)).uid;
      } catch {
        guardUid = (await adminAuth.createUser({
          email: guardEmail,
          password: crypto.randomUUID(),
          displayName: typeof empData.name === "string" ? empData.name : undefined,
        })).uid;
      }
      const finalized = await adminDb.runTransaction(async (transaction) => {
        const current = await transaction.get(empDoc.ref);
        if (!current.exists) return false;
        const currentData = current.data() as Record<string, unknown>;
        const reservation = currentData.guardPinSetupReservation as { id?: unknown } | undefined;
        if (reservation?.id !== reservationId || currentData.guardPin || currentData.guardAuthUid) {
          return false;
        }
        const uidLinks = await transaction.get(
          employeesRef.where("guardAuthUid", "==", guardUid).limit(1),
        );
        if (!uidLinks.empty && uidLinks.docs[0].id !== empDoc.id) return false;
        transaction.update(empDoc.ref, {
          guardPin: pinHash,
          guardAuthUid: guardUid,
          guardPinSetAt: FieldValue.serverTimestamp(),
          guardFailedAttempts: 0,
          guardLockoutUntil: FieldValue.delete(),
          guardPinSetupReservation: FieldValue.delete(),
        });
        return true;
      });
      if (!finalized) return identityVerificationFailed();
      await adminAuth.setCustomUserClaims(guardUid, {
        role: "guard",
        employeeId: empData.employeeId,
        employeeDocId: empDoc.id,
      });
    } catch (createErr: unknown) {
      console.error("[guard/setup-pin] failed to provision auth account", createErr);
      return setupFailure();
    }

    return NextResponse.json({
      success: true,
      message: "PIN set successfully. You can now log in.",
    });
  } catch (err: unknown) {
    console.error("[guard/setup-pin]", err);
    return setupFailure();
  }
}
