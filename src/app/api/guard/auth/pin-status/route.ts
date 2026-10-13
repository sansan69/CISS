import {
  parseGuardEmployeeIdInput,
  parseGuardPhoneInput,
} from "@/lib/guard/identity-utils";
import {
  buildRateLimitKey,
  checkRateLimit,
  getClientIp,
} from "@/lib/server/rate-limit";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 60_000;
const IP_RATE_LIMIT_MAX = 15;
const IDENTIFIER_RATE_LIMIT_MAX = 5;
const NEUTRAL_MESSAGE = "Continue to sign in or set up your PIN.";

function identifierFingerprint(identifier: string) {
  return crypto
    .createHash("sha256")
    .update(identifier)
    .digest("hex")
    .slice(0, 24);
}

function neutralResponse() {
  return { message: NEUTRAL_MESSAGE };
}

export async function POST(request: NextRequest) {
  try {
    // This protects malformed and invalid-JSON traffic as well as successful
    // lookups. `checkRateLimit` converts limiter failures to denial here.
    const ip = getClientIp(request);
    const ipLimit = await checkRateLimit(
      buildRateLimitKey("guard-pin-status-ip", ip),
      {
        maxRequests: IP_RATE_LIMIT_MAX,
        windowMs: RATE_LIMIT_WINDOW_MS,
        failClosed: true,
      },
    );
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429 },
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }

    if (
      !parsedBody ||
      typeof parsedBody !== "object" ||
      Array.isArray(parsedBody)
    ) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }

    const body = parsedBody as { phoneNumber?: string; employeeId?: string };
    if (
      body.phoneNumber !== undefined &&
      typeof body.phoneNumber !== "string"
    ) {
      return NextResponse.json(
        { error: "A valid 8 to 15 digit phone number is required." },
        { status: 400 },
      );
    }
    const suppliedPhone =
      typeof body.phoneNumber === "string" ? body.phoneNumber : "";
    const phone = suppliedPhone.trim()
      ? parseGuardPhoneInput(suppliedPhone)
      : "";
    const suppliedEmployeeId = body.employeeId;
    const employeeId =
      suppliedEmployeeId === undefined
        ? ""
        : parseGuardEmployeeIdInput(suppliedEmployeeId);

    if (suppliedPhone.trim() && !phone) {
      return NextResponse.json(
        { error: "A valid 8 to 15 digit phone number is required." },
        { status: 400 },
      );
    }

    if (employeeId === null) {
      return NextResponse.json(
        { error: "A valid employee ID is required." },
        { status: 400 },
      );
    }

    if (!phone && !employeeId) {
      return NextResponse.json(
        { error: "Phone number or employee ID is required." },
        { status: 400 },
      );
    }

    const identifiers = [
      ...(employeeId ? [`employee:${employeeId}`] : []),
      ...(phone ? [`phone:${phone}`] : []),
    ];
    for (const identifier of identifiers) {
      const identifierLimit = await checkRateLimit(
        buildRateLimitKey(
          "guard-pin-status-identifier",
          identifierFingerprint(identifier),
        ),
        {
          maxRequests: IDENTIFIER_RATE_LIMIT_MAX,
          windowMs: RATE_LIMIT_WINDOW_MS,
          failClosed: true,
        },
      );
      if (!identifierLimit.allowed) {
        return NextResponse.json(
          { error: "Too many requests. Please wait a moment and try again." },
          { status: 429 },
        );
      }
    }

    return NextResponse.json(neutralResponse());
  } catch (error: any) {
    console.error("PIN status check failed:", error);
    return NextResponse.json(
      { error: "Could not check PIN status." },
      { status: 500 },
    );
  }
}
