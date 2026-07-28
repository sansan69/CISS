import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  buildRateLimitKey,
  checkRateLimit,
  getClientIp,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);

    const ipLimit = await checkRateLimit(
      buildRateLimitKey("employee-lookup-ip", ip),
      { maxRequests: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, failClosed: true },
    );
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429 },
      );
    }

    const body = (await request.json()) as { phoneNumber?: string };
    const phone = String(body.phoneNumber || "").trim().replace(/\D/g, "");

    if (!/^\d{10}$/.test(phone)) {
      return NextResponse.json(
        { error: "A valid 10-digit phone number is required." },
        { status: 400 },
      );
    }

    const phoneFingerprint = crypto.createHash("sha256").update(phone).digest("hex").slice(0, 24);
    const phoneLimit = await checkRateLimit(
      buildRateLimitKey("employee-lookup-phone", phoneFingerprint),
      { maxRequests: 3, windowMs: RATE_LIMIT_WINDOW_MS, failClosed: true },
    );
    if (!phoneLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests for this phone number. Please wait and try again." },
        { status: 429 },
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const snapshot = await adminDb
      .collection("employees")
      .where("phoneNumber", "==", phone)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ found: false });
    }

    return NextResponse.json({ found: true });
  } catch (error: any) {
    console.error("Employee lookup failed:", error);
    return NextResponse.json(
      { error: "Could not verify phone number. Please try again." },
      { status: 500 },
    );
  }
}
