import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/firebaseAdmin";
import { parseQrContent, verifyQrToken } from "@/lib/qr/qr-token";
import {
  buildRateLimitKey,
  checkRateLimit,
  getClientIp,
} from "@/lib/server/rate-limit";
import { requireGuard } from "@/lib/server/guard-auth";
import { verifyRequestAuth } from "@/lib/server/auth";
import {
  generateAttendanceVerificationProof,
  type AttendanceIdentificationMethod,
} from "@/lib/server/attendance-verification-token";
import { registerAttendanceProof } from "@/lib/server/attendance-proofs";
import { normalizeClientNameKey, OPERATIONAL_CLIENT_NAME } from "@/lib/constants";

export const runtime = "nodejs";

const requestSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("qr"), value: z.string().trim().min(1).max(4096) }),
  z.object({
    method: z.literal("phone"),
    value: z.string().trim().min(6).max(32),
  }),
  z.object({
    method: z.literal("employeeId"),
    value: z.string().trim().min(1).max(160),
    phoneNumber: z.string().trim().max(32).optional(),
  }),
  z.object({
    method: z.literal("resourceId"),
    value: z.string().trim().min(1).max(160),
  }),
  z.object({ method: z.literal("authenticated") }),
]);

type EmployeeDocument = FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

type AttendanceActor = { uid: string };

/**
 * Resolve the signed-in guard performing the identification, if any.
 *
 * Returns null for a genuinely anonymous kiosk request, the actor for a valid
 * guard token, and the string "invalid" when a token is present but unusable or
 * belongs to a non-guard role. Callers must not treat "invalid" as anonymous.
 */
async function tryIdentifyActor(
  request: Request,
): Promise<AttendanceActor | null | "invalid"> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  try {
    const decoded = await verifyRequestAuth(request);
    // Only guards can be the accountable actor for an assisted mark. A valid
    // non-guard session (e.g. an admin at a shared kiosk) is treated as an
    // anonymous kiosk request: it may scan a signed badge but cannot use the
    // weaker identifiers.
    if (decoded.role !== "guard") return null;
    return { uid: decoded.uid };
  } catch {
    return "invalid";
  }
}

async function findByEmployeeId(employeeId: string) {
  const current = await db
    .collection("employees")
    .where("employeeId", "==", employeeId)
    .limit(2)
    .get();
  if (!current.empty) return current.docs;

  const previous = await db
    .collection("employees")
    .where("previousEmployeeIds", "array-contains", employeeId)
    .limit(2)
    .get();
  return previous.docs;
}

async function findByPhone(phoneInput: string) {
  const normalizedPhone = digits(phoneInput);
  if (normalizedPhone.length !== 10) return [];

  const results = new Map<string, EmployeeDocument>();
  for (const field of ["phoneNumber", "phone", "mobile"] as const) {
    const snapshot = await db
      .collection("employees")
      .where(field, "==", normalizedPhone)
      .limit(2)
      .get();
    for (const doc of snapshot.docs) results.set(doc.id, doc);
  }
  return Array.from(results.values());
}

async function findByResourceId(resourceId: string) {
  return db
    .collection("employees")
    .where("resourceIdNumber", "==", resourceId.trim())
    .limit(2)
    .get();
}

function attendanceHint(state: Record<string, unknown> | undefined) {
  if (!state) return null;
  return {
    lastAttendanceDate:
      typeof state.lastAttendanceDate === "string"
        ? state.lastAttendanceDate
        : null,
    lastStatus:
      state.lastStatus === "In" || state.lastStatus === "Out"
        ? state.lastStatus
        : null,
    lastSiteId: typeof state.lastSiteId === "string" ? state.lastSiteId : null,
    lastDutyPointId:
      typeof state.lastDutyPointId === "string"
        ? state.lastDutyPointId
        : null,
    lastShiftCode:
      typeof state.lastShiftCode === "string" ? state.lastShiftCode : null,
    openSessionId:
      typeof state.openSessionId === "string" ? state.openSessionId : null,
    recommendedStatus: state.lastStatus === "In" ? "Out" : "In",
  };
}

async function buildResponse(
  employeeDoc: EmployeeDocument,
  method: AttendanceIdentificationMethod,
  actorUid: string | null,
) {
  const employee = employeeDoc.data() as Record<string, unknown>;
  if (employee.status && employee.status !== "Active") {
    return NextResponse.json(
      { error: "This guard account is not active. Please contact your supervisor." },
      { status: 403 },
    );
  }

  const stateDocument = await db
    .collection("attendanceState")
    .doc(employeeDoc.id)
    .get();
  const state = stateDocument.exists
    ? (stateDocument.data() as Record<string, unknown>)
    : undefined;

  let verificationToken: string | null = null;
  if (method !== "authenticated") {
    const proof = generateAttendanceVerificationProof({
      employeeDocId: employeeDoc.id,
      method,
      actorUid,
    });
    // The proof is single-use; if its nonce cannot be registered we fail closed
    // rather than hand out a replayable credential.
    const registered = await registerAttendanceProof(proof.payload);
    if (!registered) {
      return NextResponse.json(
        { error: "Attendance verification is temporarily unavailable. Try again." },
        { status: 503 },
      );
    }
    verificationToken = proof.token;
  }

  return NextResponse.json({
    found: true,
    authenticated: method === "authenticated",
    assisted: actorUid != null,
    verificationToken,
    employee: {
      id: employeeDoc.id,
      employeeCode:
        typeof employee.employeeId === "string" ? employee.employeeId : "",
      fullName:
        String(
          employee.fullName ||
            employee.name ||
            [employee.firstName, employee.lastName].filter(Boolean).join(" "),
        ).trim() || "Guard",
      clientName:
        typeof employee.clientName === "string" ? employee.clientName : undefined,
      attendanceHint: attendanceHint(state),
    },
  });
}

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(
      await request.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Choose QR code, phone number, or employee ID." },
        { status: 400 },
      );
    }

    const input = parsed.data;
    if (input.method === "authenticated") {
      const guard = await requireGuard(request);
      const employeeDoc = await db
        .collection("employees")
        .doc(guard.employeeDocId)
        .get();
      if (!employeeDoc.exists) {
        return NextResponse.json(
          { error: "Guard employee record not found." },
          { status: 404 },
        );
      }
      return buildResponse(employeeDoc as EmployeeDocument, "authenticated", guard.uid);
    }

    // Assisted marking: guard B identifies guard A from B's own signed-in phone.
    // The actor is optional for the shared-device kiosk, but a kiosk may only
    // use a signed QR badge — the weaker identifiers (employee ID, phone,
    // resource ID) require an accountable signed-in guard.
    const actor = await tryIdentifyActor(request);
    if (actor === "invalid") {
      return NextResponse.json(
        { error: "Your session is invalid. Sign in again." },
        { status: 401 },
      );
    }
    if (input.method !== "qr" && !actor) {
      return NextResponse.json(
        {
          error:
            "Sign in to mark attendance by employee ID, phone number, or resource ID. Without sign-in, scan the guard's QR badge.",
        },
        { status: 401 },
      );
    }

    const ip = getClientIp(request);
    const rateLimit = await checkRateLimit(
      buildRateLimitKey(`attendance-identify-${input.method}`, ip),
      { maxRequests: 15, windowMs: 60_000, failClosed: true },
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many identification attempts. Please wait and try again." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    let method: Exclude<AttendanceIdentificationMethod, "authenticated"> =
      input.method;
    let matches: EmployeeDocument[] = [];

    if (input.method === "employeeId") {
      matches = await findByEmployeeId(input.value);
      if (input.phoneNumber) {
        const normalizedPhone = digits(input.phoneNumber);
        matches = matches.filter((doc) => {
          const data = doc.data() as Record<string, unknown>;
          return [data.phoneNumber, data.phone, data.mobile].some(
            (value) => digits(value) === normalizedPhone,
          );
        });
      }
    } else if (input.method === "phone") {
      matches = await findByPhone(input.value);
    } else if (input.method === "resourceId") {
      const snapshot = await findByResourceId(input.value);
      matches = snapshot.docs;
    } else {
      const qr = parseQrContent(input.value);
      if (!qr.employeeId) {
        return NextResponse.json(
          { error: "This QR code does not contain a valid employee ID." },
          { status: 400 },
        );
      }
      // A QR badge is a credential only when it carries the signed token. A
      // tokenless QR must not fall through to a free identity proof for any
      // employee ID printed in the text (the previous fail-open behaviour).
      if (
        !qr.token ||
        !qr.phoneNumber ||
        !(await verifyQrToken(qr.employeeId, qr.phoneNumber, qr.token))
      ) {
        return NextResponse.json(
          { error: "This QR code is invalid or has been altered." },
          { status: 401 },
        );
      }
      matches = await findByEmployeeId(qr.employeeId);
      const qrPhone = digits(qr.phoneNumber);
      matches = matches.filter((doc) => {
        const data = doc.data() as Record<string, unknown>;
        return [data.phoneNumber, data.phone, data.mobile].some(
          (value) => digits(value) === qrPhone,
        );
      });
      method = "qr";
    }

    if (matches.length !== 1) {
      return NextResponse.json(
        {
          error:
            matches.length > 1
              ? "Multiple guard records match. Please contact your supervisor."
              : "No active guard could be identified with those details.",
        },
        { status: matches.length > 1 ? 409 : 404 },
      );
    }

    // Resource ID is a TCS-only identifier. Enforce it against the matched
    // employee's client rather than trusting the client UI.
    if (method === "resourceId") {
      const matched = matches[0].data() as Record<string, unknown>;
      const clientName =
        typeof matched.clientName === "string" ? matched.clientName : "";
      if (
        normalizeClientNameKey(clientName) !==
        normalizeClientNameKey(OPERATIONAL_CLIENT_NAME)
      ) {
        return NextResponse.json(
          {
            error:
              "Resource ID identification is available only for TCS guards. Use the QR badge or employee ID instead.",
          },
          { status: 403 },
        );
      }
    }

    // Bound how many identity proofs can be minted for one employee. IP-only
    // limiting is bypassable by rotating the client address, so a leaked or
    // guessed identifier must not be usable for unbounded anonymous proofs.
    const employeeLimit = await checkRateLimit(
      buildRateLimitKey("attendance-identify-employee", matches[0].id),
      { maxRequests: 10, windowMs: 10 * 60_000, failClosed: true },
    );
    if (!employeeLimit.allowed) {
      return NextResponse.json(
        {
          error:
            "Too many identification attempts for this guard. Please wait and try again.",
        },
        { status: 429, headers: { "Retry-After": "600" } },
      );
    }

    return buildResponse(matches[0], method, actor?.uid ?? null);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not identify guard.";
    const status =
      message.includes("Guard access required") ||
      message.includes("bearer token")
        ? 401
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
