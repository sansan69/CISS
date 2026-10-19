import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import {
  parseCapturedAt,
  persistGuardLocationSample,
  resolveGuardTrackingIdentity,
  resolveGuardTrackingSession,
  resolveGuardTrackingSessionById,
  resolveGuardTrackingSessionForCapture,
  loadGuardTrackingSessionCandidates,
  validateGuardTrackingSessionCapture,
  type GuardTrackingSessionResult,
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

    const identityResult = await resolveGuardTrackingIdentity(guard);
    if (!identityResult.ok) {
      return NextResponse.json(
        { error: identityResult.error },
        { status: identityResult.status },
      );
    }
    const identity = identityResult.value;
    const needsLegacyCandidates = limited.some((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
      const sample = raw as Record<string, unknown>;
      return !sample.attendanceSessionId && typeof sample.capturedAt === "string";
    });
    const sessionCandidates = needsLegacyCandidates
      ? await loadGuardTrackingSessionCandidates(guard, identity)
      : [];
    const sessionContextCache = new Map<string, Promise<GuardTrackingSessionResult>>();
    const resolveCachedSession = async (sessionId: string, siteId: string, capturedAtMs: number | null) => {
      const key = `${sessionId}:${siteId}`;
      let pending = sessionContextCache.get(key);
      if (!pending) {
        pending = resolveGuardTrackingSessionById(guard, identity, sessionId, siteId, capturedAtMs, nowDate.getTime());
        sessionContextCache.set(key, pending);
      }
      const resolved = await pending;
      if (!resolved.ok) {
        sessionContextCache.delete(key);
        return resolved;
      }
      const invalidCapture = validateGuardTrackingSessionCapture(
        resolved.value,
        sessionId === identity.openSessionId,
        capturedAtMs,
        nowDate.getTime(),
      );
      return invalidCapture ?? resolved;
    };

    const now = Timestamp.now();
    const nowDate = now.toDate();
    let accepted = 0;
    // Per-sample outcomes so the client can retire a permanently rejected
    // breadcrumb and keep retrying a transient one, instead of committing the
    // whole chunk on any 2xx and silently losing the rejected rows.
    const results: Array<{
      index: number;
      accepted: boolean;
      code?: string;
      retryable: boolean;
    }> = [];

    for (let index = 0; index < limited.length; index++) {
      const raw = limited[index];
      const sample = toGuardLocationSample(raw);
      if (!sample) {
        rejected += 1;
        results.push({
          index,
          accepted: false,
          code: "invalid_sample",
          retryable: false,
        });
        continue;
      }

      const capturedAt = parseCapturedAt(sample.capturedAt, BATCH_MAX_CAPTURE_AGE_MS);
      let sessionId = sample.attendanceSessionId || identity.openSessionId;
      let sessionResult;
      if (sample.attendanceSessionId) {
        sessionResult = await resolveCachedSession(sessionId, sample.siteId, capturedAt?.getTime() ?? null);
      } else if (capturedAt) {
        const inferred = await resolveGuardTrackingSessionForCapture(
          guard, identity, sample.siteId, capturedAt.getTime(), sessionCandidates, nowDate.getTime(),
        );
        if (inferred.ok) {
          sessionId = inferred.sessionId;
          sessionResult = await resolveCachedSession(sessionId, sample.siteId, capturedAt.getTime());
        } else {
          sessionResult = inferred;
        }
      } else if (sessionId && identity.activeSiteId === sample.siteId) {
        sessionResult = await resolveGuardTrackingSession(guard, identity);
      } else {
        sessionResult = { ok: false as const, status: 409, error: "Live location sharing requires an open IN session." };
      }
      const result = sessionResult.ok
        ? await persistGuardLocationSample({
        guard,
        sample,
        now,
        context: {
          ...identity,
          activeSiteId: sample.siteId,
          openSessionId: sessionId,
          ...sessionResult.value,
        },
        bucketAt: capturedAt ?? nowDate,
        trackingSource: "guard_batch",
        captureDriftMs: BATCH_MAX_CAPTURE_AGE_MS,
      })
        : sessionResult;

      if (result.ok) {
        accepted += 1;
        results.push({ index, accepted: true, retryable: false });
      } else {
        rejected += 1;
        results.push({
          index,
          accepted: false,
          code: result.status >= 500 ? "transient" : "rejected_by_rule",
          retryable: result.status >= 500,
        });
      }
    }

    return NextResponse.json({ accepted, rejected, results });
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
