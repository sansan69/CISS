import { db } from "@/lib/firebaseAdmin";
import { Timestamp } from "firebase-admin/firestore";

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  /** When true, deny the request on limiter error instead of allowing through (fail closed). */
  failClosed?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  totalAttempts: number;
}

/**
 * Firestore-based distributed rate limiter.
 * Uses atomic transactions to enforce limits across serverless instances.
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const ref = db.collection("rateLimits").doc(key);
  const now = Timestamp.now();
  const windowStart = new Date(Date.now() - config.windowMs);

  try {
    // Retain limiter documents for one extra window after they stop mattering so
    // a Firestore TTL policy on `expireAt` can delete them. Without this the
    // collection grows forever (12,338 docs, 11,488 older than a week at the
    // 2026-10-26 audit).
    const expireAt = new Date(
      Date.now() + Math.max(config.windowMs * 2, 60 * 60 * 1000),
    );

    const result = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const data = snap.exists ? (snap.data() as Record<string, any>) : null;

      // Malformed documents (missing windowStart) previously threw and made the
      // endpoint fail open or closed. Treat them as expired instead.
      const windowStartedAt =
        data?.windowStart && typeof data.windowStart.toDate === "function"
          ? data.windowStart.toDate()
          : null;

      if (!data || !windowStartedAt || windowStartedAt < windowStart) {
        // Window expired or first request — reset
        const newData = {
          count: 1,
          windowStart: now,
          updatedAt: now,
          expireAt,
        };
        transaction.set(ref, newData);
        return {
          allowed: true,
          remaining: config.maxRequests - 1,
          resetAt: new Date(Date.now() + config.windowMs),
          totalAttempts: 1,
        };
      }

      const count = (data.count ?? 0) + 1;
      const allowed = count <= config.maxRequests;

      transaction.update(ref, {
        count,
        updatedAt: now,
        expireAt,
      });

      const resetAt = new Date(
        windowStartedAt.getTime() + config.windowMs,
      );

      return {
        allowed,
        remaining: Math.max(0, config.maxRequests - count),
        resetAt,
        totalAttempts: count,
      };
    });

    return result;
  } catch (error) {
    console.error(`[rateLimit] Transaction failed for key ${key}:`, error);
    if (config.failClosed) {
      // Fail closed — deny request on limiter error for security-critical endpoints
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + config.windowMs),
        totalAttempts: 0,
      };
    }
    // Fail open — allow request but log error
    return {
      allowed: true,
      remaining: 0,
      resetAt: new Date(Date.now() + config.windowMs),
      totalAttempts: 0,
    };
  }
}

/**
 * Build a rate-limit key from request context.
 */
export function buildRateLimitKey(
  endpoint: string,
  identifier: string,
): string {
  return `${endpoint}:${identifier}`;
}

/**
 * Get client IP from request headers.
 * Sanitizes x-forwarded-for per Vercel guidance: only the leftmost IP is the client.
 * Strips port and IPv6 brackets for consistency.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Vercel/cloud proxies append to the right; the leftmost is the original client
    const raw = forwarded.split(",")[0]?.trim() ?? "";
    // Remove port suffix (e.g. "192.168.1.1:12345" -> "192.168.1.1")
    const withoutPort = raw.replace(/:\d+$/, "");
    // Strip IPv6 brackets (e.g. "[::1]" -> "::1")
    const clean = withoutPort.replace(/^\[|\]$/g, "");
    return clean || "unknown";
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.replace(/:\d+$/, "").replace(/^\[|\]$/g, "") || "unknown";
  }
  return "unknown";
}
