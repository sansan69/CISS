import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import {
  parseCapturedAt,
  persistGuardLocationSample,
  resolveGuardTrackingIdentity,
  resolveGuardTrackingSession,
  toGuardLocationSample,
} from "@/lib/guard-tracking-persist";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
import {
  buildRateLimitKey,
  checkRateLimit,
} from "@/lib/server/rate-limit";
export const runtime = "nodejs";

const MAX_SAMPLES_PER_REQUEST = 200;
const BATCH_MAX_CAPTURE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const batchSchema = z.object({
  samples: z.array(z.unknown()),
});

const BATCH_RATE_LIMIT = {
  maxRequests: 120,
  windowMs: 10 * 60 * 1000,
  failClosed: true,
} as const;

export async function POST(request: Request) {
  try {
    const guard = await requireGuard(request);
    const rateLimit = await checkRateLimit(
      buildRateLimitKey("guard-tracking-batch", guard.uid),
      BATCH_RATE_LIMIT,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Location updates are arriving too quickly. Please wait." },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.ceil(BATCH_RATE_LIMIT.windowMs / 1000),
            ),
          },
        },
      );
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid tracking batch payload." },
        { status: 400 },
      );
    }

    const parsed = batchSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "A samples array is required." },
        { status: 400 },
      );
    }

    const rawSamples = parsed.data.samples;
    const limited = rawSamples.slice(0, MAX_SAMPLES_PER_REQUEST);
    let rejected = rawSamples.length - limited.length;

    // Verify the open IN session once for the whole batch; a missing session is
    // a batch-level failure so the client keeps its buffered samples.
    const identityResult = await resolveGuardTrackingIdentity(guard);
    if (!identityResult.ok) {
      return NextResponse.json(
        { error: identityResult.error },
        { status: identityResult.status },
      );
    }
    const sessionResult = await resolveGuardTrackingSession(
      guard,
      identityResult.value,
    );
    if (!sessionResult.ok) {
      return NextResponse.json(
        { error: sessionResult.error },
        { status: sessionResult.status },
      );
    }
    const context = { ...identityResult.value, ...sessionResult.value };

    const now = Timestamp.now();
    const nowDate = now.toDate();
    let accepted = 0;

    for (const raw of limited) {
      const sample = toGuardLocationSample(raw);
      if (!sample) {
        rejected += 1;
        continue;
      }

      const capturedAt = parseCapturedAt(
        sample.capturedAt,
        BATCH_MAX_CAPTURE_AGE_MS,
      );
      const result = await persistGuardLocationSample({
        guard,
        sample,
        now,
        context,
        bucketAt: capturedAt ?? nowDate,
        trackingSource: "guard_batch",
        captureDriftMs: BATCH_MAX_CAPTURE_AGE_MS,
      });

      if (result.ok) {
        accepted += 1;
      } else {
        rejected += 1;
      }
    }

    return NextResponse.json({ accepted, rejected });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid tracking batch payload." },
        { status: 400 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Could not save tracking batch.";
    if (
      message.includes("Missing bearer token") ||
      message.includes("Guard access required")
    ) {
      return unauthorizedResponse(message);
    }
    console.error("[mobile/tracking/batch]", error);
    return NextResponse.json(
      { error: "Tracking batch could not be saved. Please try again." },
      { status: 500 },
    );
  }
}
