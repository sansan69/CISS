import { NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { buildPublicAttendanceSiteOption } from "@/lib/attendance/public-attendance";
import { checkRateLimit, getClientIp, buildRateLimitKey } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // IP-based rate limiting
    const ip = getClientIp(request);
    const rateKey = buildRateLimitKey("public-attendance", ip);
    const rateResult = await checkRateLimit(rateKey, {
      maxRequests: 30,
      windowMs: 60 * 1000, // 30 requests per minute per IP
      failClosed: false,     // Fail open for public endpoints
    });
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "60",
          },
        },
      );
    }

    const [sitesSnapshot, clientLocSnapshot] = await Promise.all([
      db.collection('sites').get(),
      db.collection('clientLocations').get(),
    ]);

    const options = [
      ...sitesSnapshot.docs.map((doc) =>
        buildPublicAttendanceSiteOption(doc.id, doc.data() as Record<string, unknown>, 'sites'),
      ),
      ...clientLocSnapshot.docs.map((doc) =>
        buildPublicAttendanceSiteOption(doc.id, doc.data() as Record<string, unknown>, 'clientLocations'),
      ),
    ];

    return NextResponse.json(
      { options },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (error) {
    const { log } = await import("@/lib/server/log");
    log("error", "public-attendance", "Error loading duty centers", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Could not load duty centers.' },
      { status: 500 }
    );
  }
}
