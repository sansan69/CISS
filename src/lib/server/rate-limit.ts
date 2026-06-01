import { db } from "@/lib/firebaseAdmin";
import { Timestamp } from "firebase-admin/firestore";

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
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
    const result = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const data = snap.exists ? (snap.data() as Record<string, any>) : null;

      if (!data || data.windowStart.toDate() < windowStart) {
        // Window expired or first request — reset
        const newData = {
          count: 1,
          windowStart: now,
          updatedAt: now,
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
      });

      const resetAt = new Date(
        data.windowStart.toDate().getTime() + config.windowMs,
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
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}
