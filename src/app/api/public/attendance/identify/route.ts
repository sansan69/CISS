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
import {
  generateAttendanceVerificationToken,
  type AttendanceIdentificationMethod,
} from "@/lib/server/attendance-verification-token";

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
  }),
  z.object({ method: z.literal("authenticated") }),
]);

type EmployeeDocument = FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
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

  return NextResponse.json({
    found: true,
    authenticated: method === "authenticated",
    verificationToken:
      method === "authenticated"
        ? null
        : generateAttendanceVerificationToken({
            employeeDocId: employeeDoc.id,
            method,
          }),
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
      return buildResponse(employeeDoc as EmployeeDocument, "authenticated");
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
    } else if (input.method === "phone") {
      matches = await findByPhone(input.value);
    } else {
      const qr = parseQrContent(input.value);
      if (!qr.employeeId) {
        return NextResponse.json(
          { error: "This QR code does not contain a valid employee ID." },
          { status: 400 },
        );
      }
      if (
        qr.token &&
        (!qr.phoneNumber ||
          !(await verifyQrToken(qr.employeeId, qr.phoneNumber, qr.token)))
      ) {
        return NextResponse.json(
          { error: "This QR code is invalid or has been altered." },
          { status: 401 },
        );
      }
      matches = await findByEmployeeId(qr.employeeId);
      if (qr.phoneNumber) {
        const qrPhone = digits(qr.phoneNumber);
        matches = matches.filter((doc) => {
          const data = doc.data() as Record<string, unknown>;
          return [data.phoneNumber, data.phone, data.mobile].some(
            (value) => digits(value) === qrPhone,
          );
        });
      }
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

    return buildResponse(matches[0], method);
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
