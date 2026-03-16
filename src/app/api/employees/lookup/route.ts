import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Simple in-memory rate limiter: max 10 lookups per IP per minute.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  entry.count += 1;
  return true;
}

// Periodically clean up stale rate limit entries to prevent memory growth.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (now > entry.resetAt) rateLimitMap.delete(ip);
    }
  }, RATE_LIMIT_WINDOW_MS * 5);
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    if (!checkRateLimit(ip)) {
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

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const snapshot = await adminDb
      .collection("employees")
      .where("phoneNumber", "==", phone)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ found: false });
    }

    const doc = snapshot.docs[0];
    const data = doc.data() as Record<string, unknown>;

    // Return only the minimum fields needed for the public landing page.
    return NextResponse.json({
      found: true,
      id: doc.id,
      fullName: data.fullName ?? "",
      employeeId: data.employeeId ?? "",
    });
  } catch (error: any) {
    console.error("Employee lookup failed:", error);
    return NextResponse.json(
      { error: "Could not verify phone number. Please try again." },
      { status: 500 },
    );
  }
}
