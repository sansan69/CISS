import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import {
  createEnrollmentDraftToken,
  ENROLLMENT_DRAFT_TTL_MS,
  hashEnrollmentDraftToken,
} from "@/lib/server/enrollment-draft";
import {
  buildRateLimitKey,
  checkRateLimit,
  getClientIp,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rateLimit = await checkRateLimit(
      buildRateLimitKey("enrollment-draft", ip),
      { maxRequests: 5, windowMs: 60 * 60 * 1000, failClosed: true },
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many enrollment attempts. Please wait and try again." },
        { status: 429 },
      );
    }

    const body = (await request.json()) as { phoneNumber?: unknown };
    const phoneNumber = String(body.phoneNumber ?? "").replace(/\D/g, "");
    if (!/^\d{10}$/.test(phoneNumber)) {
      return NextResponse.json(
        { error: "A valid 10-digit phone number is required." },
        { status: 400 },
      );
    }

    const { db } = await import("@/lib/firebaseAdmin");
    const draftRef = db.collection("enrollments").doc();
    const token = createEnrollmentDraftToken();
    const now = Date.now();

    await draftRef.create({
      status: "draft",
      phoneNumber,
      tokenHash: hashEnrollmentDraftToken(token),
      uploadCount: 0,
      createdAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(now + ENROLLMENT_DRAFT_TTL_MS),
    });

    return NextResponse.json({
      draftId: draftRef.id,
      uploadToken: token,
      expiresAt: new Date(now + ENROLLMENT_DRAFT_TTL_MS).toISOString(),
    });
  } catch (error) {
    console.error("Enrollment draft creation failed:", error);
    return NextResponse.json(
      { error: "Could not start enrollment. Please try again." },
      { status: 500 },
    );
  }
}
