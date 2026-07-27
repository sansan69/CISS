import { NextRequest, NextResponse } from "next/server";
import { generateUploadToken } from "@/lib/server/upload-token";
import {
  checkRateLimit,
  buildRateLimitKey,
  getClientIp,
} from "@/lib/server/rate-limit";
import { requireGuard } from "@/lib/server/guard-auth";
import { verifyAttendanceVerificationToken } from "@/lib/server/attendance-verification-token";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const key = buildRateLimitKey("public-attendance-token", ip);
    const { allowed } = await checkRateLimit(key, { maxRequests: 10, windowMs: 60_000 });
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait." },
        { status: 429 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      employeeDocId?: unknown;
      siteId?: unknown;
      attemptId?: unknown;
      attendanceVerificationToken?: unknown;
    } | null;

    const employeeDocId =
      typeof body?.employeeDocId === "string" ? body.employeeDocId.trim() : "";
    const siteId = typeof body?.siteId === "string" ? body.siteId.trim() : "";
    const attemptId =
      typeof body?.attemptId === "string" ? body.attemptId.trim() : "";

    if (!employeeDocId || !siteId || !attemptId) {
      return NextResponse.json(
        { error: "employeeDocId, siteId, and attemptId are required." },
        { status: 400 },
      );
    }

    const authorization = request.headers.get("authorization") || "";
    if (authorization.startsWith("Bearer ")) {
      const guard = await requireGuard(request);
      if (guard.employeeDocId !== employeeDocId) {
        return NextResponse.json(
          { error: "You can only upload your own attendance photo." },
          { status: 403 },
        );
      }
    } else {
      const verificationToken =
        typeof body?.attendanceVerificationToken === "string"
          ? body.attendanceVerificationToken
          : "";
      const verification =
        verifyAttendanceVerificationToken(verificationToken);
      if (
        !verification ||
        verification.employeeDocId !== employeeDocId
      ) {
        return NextResponse.json(
          { error: "Guard identification has expired. Identify the guard again." },
          { status: 401 },
        );
      }
    }

    const token = generateUploadToken(employeeDocId, siteId, attemptId);

    return NextResponse.json({
      uploadToken: token,
      expiresIn: 300,
    });
  } catch (error) {
    console.error("Upload token generation error:", error);
    return NextResponse.json(
      { error: "Could not generate upload token." },
      { status: 500 },
    );
  }
}
