import { NextRequest, NextResponse } from "next/server";
import { generateUploadToken } from "@/lib/server/upload-token";
import {
  checkRateLimit,
  buildRateLimitKey,
  getClientIp,
} from "@/lib/server/rate-limit";

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
      employeeId?: unknown;
      siteId?: unknown;
    } | null;

    const employeeId = typeof body?.employeeId === "string" ? body.employeeId.trim() : "";
    const siteId = typeof body?.siteId === "string" ? body.siteId.trim() : "";

    if (!employeeId || !siteId) {
      return NextResponse.json(
        { error: "employeeId and siteId are required." },
        { status: 400 },
      );
    }

    const token = generateUploadToken(employeeId, siteId);

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
