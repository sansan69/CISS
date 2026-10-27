import { FieldValue } from "firebase-admin/firestore";
import { db as adminDb } from "@/lib/firebaseAdmin";

/**
 * Self-queue runner for long-running Vercel serverless jobs.
 *
 * Solves the timeout problem: instead of processing all work in one HTTP
 * invocation (which hits Vercel's 10s/60s/300s wall), processes one bounded
 * chunk per invocation and re-queues itself until all chunks are done.
 *
 * Usage:
 *   const result = await runChunked({ ... }, claimFn, processFn);
 *   if (!result.done) return NextResponse.json({}, { status: 202 });
 *   return NextResponse.json({ done: true });
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SelfQueueOptions {
  /** Firestore collection for job state (e.g. "queueJobs") */
  stateCollection: string;
  /** Unique job identifier */
  jobId: string;
  /** Max wall-clock budget per invocation in milliseconds (e.g. 50_000 for 60s) */
  budgetMs: number;
  /** Full URL of this endpoint (used for re-queuing) */
  selfUrl: string;
  /** CRON_SECRET for auth on re-queue */
  cronSecret: string;
  /** Optional key for cursor tracking (defaults to "cursor") */
  cursorKey?: string;
}

export interface ChunkResult {
  /** True when no more chunks remain */
  done: boolean;
  /** Optional cursor/identifier to write to the job state for resume */
  cursor?: unknown;
  /** Number of items processed (for reporting) */
  processed?: number;
}

// ── Re-queue origin ────────────────────────────────────────────────────────────

/**
 * Environment variables consulted for the canonical application origin, in
 * priority order: an explicit server-side override, the public deployment URL
 * used by the mobile/guard-login APIs, and finally the Vercel-provided
 * production/deployment hostnames (assigned by the platform, never by a
 * request). Nothing here is derived from the incoming request.
 */
const APP_ORIGIN_ENV_KEYS = [
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

let warnedMissingOrigin = false;

function configuredOrigin(value: string | undefined): string | null {
  const configured = value?.trim();
  if (!configured) return null;
  // Vercel system variables carry a bare hostname; everything else may carry
  // a scheme and path. Assume https for bare hostnames, then reject anything
  // that is still not an https origin without credentials.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(configured)
    ? configured
    : `https://${configured}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical origin used for self re-queuing from configuration.
 *
 * The origin must never come from the incoming request: `Host` is
 * attacker-controllable on many deployments, and the re-queue forwards
 * `Authorization: Bearer $CRON_SECRET`, so a spoofed `Host` would hand the cron
 * secret to an arbitrary server. Only an absolute https origin without
 * credentials is accepted.
 *
 * @returns the origin (e.g. `https://cisskerala.site`) or `null` when no usable
 * origin is configured.
 */
export function resolveConfiguredAppOrigin(
  env: Record<string, string | undefined> = process.env,
): string | null {
  for (const key of APP_ORIGIN_ENV_KEYS) {
    const origin = configuredOrigin(env[key]);
    if (origin) return origin;
  }
  return null;
}

// ── Runner ─────────────────────────────────────────────────────────────────────

/**
 * Claim, process, and optionally re-queue chunks until the budget is exhausted
 * or all work is done.
 *
 * @returns `{ done: boolean; processed: number; status: string }`
 */
export async function runChunked<T>(
  opts: SelfQueueOptions,
  claim: (
    tx: FirebaseFirestore.Transaction,
    cursor: unknown,
  ) => Promise<{ chunk: T | null; cursor: unknown }>,
  process: (chunk: T) => Promise<ChunkResult>,
  startTime: number = Date.now(),
): Promise<{ done: boolean; processed: number; status: string }> {
  const { stateCollection, jobId, budgetMs, selfUrl, cronSecret } = opts;
  const cursorKey = opts.cursorKey ?? "cursor";
  const processingKey = `${cursorKey}Processing`;
  const leaseMs = Math.max(budgetMs * 2, 120_000);
  const maxChunks = 20; // Hard safety limit per invocation
  let totalProcessed = 0;

  const stateRef = adminDb.collection(stateCollection).doc(jobId);

  for (let i = 0; i < maxChunks; i++) {
    // Check budget after the first chunk
    if (i > 0 && Date.now() - startTime >= budgetMs) break;

    let chunk: T | null;
    let claimedCursor: unknown;
    let nextCursor: unknown;
    const leaseId = crypto.randomUUID();

    try {
      const result = await adminDb.runTransaction(async (tx) => {
        const stateSnap = await tx.get(stateRef);
        const currentCursor = stateSnap.get(cursorKey) ?? null;
        const processing = stateSnap.get(processingKey) as
          | { leaseId?: string; startedAt?: string }
          | undefined;

        if (processing?.startedAt) {
          const leaseAge = Date.now() - new Date(processing.startedAt).getTime();
          if (Number.isFinite(leaseAge) && leaseAge < leaseMs) {
            return {
              busy: true,
              chunk: null,
              cursor: currentCursor,
              claimedCursor: currentCursor,
            };
          }
        }

        const { chunk: c, cursor: nc } = await claim(tx, currentCursor);
        if (c === null) {
          return {
            busy: false,
            chunk: null,
            cursor: nc,
            claimedCursor: currentCursor,
          };
        }

        // Mark this chunk as leased, but do not advance the durable cursor
        // until processing succeeds. Otherwise a throw in process() can skip
        // the claimed work permanently.
        tx.set(stateRef, {
          lastHeartbeatAt: FieldValue.serverTimestamp(),
          [processingKey]: {
            leaseId,
            startedAt: new Date().toISOString(),
            cursor: currentCursor,
            nextCursor: nc,
          },
        }, { merge: true });

        return {
          busy: false,
          chunk: c,
          cursor: nc,
          claimedCursor: currentCursor,
        };
      });

      if (result.busy) {
        break;
      }

      chunk = result.chunk;
      nextCursor = result.cursor;
      claimedCursor = result.claimedCursor;
    } catch (error) {
      // Transaction conflict — treat as empty chunk; next cron pass retries
      console.error(`[self-queue] Transaction failed for ${jobId}:`, error);
      return { done: false, processed: totalProcessed, status: "retry-later" };
    }

    if (chunk === null) {
      // No more work — mark done and clear cursor
      await stateRef.set({
        done: true,
        completedAt: FieldValue.serverTimestamp(),
        [`${cursorKey}`]: null,
        [processingKey]: null,
        lastHeartbeatAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { done: true, processed: totalProcessed, status: "completed" };
    }

    let result: ChunkResult;
    try {
      result = await process(chunk);
    } catch (error) {
      await stateRef.set({
        lastHeartbeatAt: FieldValue.serverTimestamp(),
        lastError:
          error instanceof Error ? error.message : String(error),
        [processingKey]: null,
      }, { merge: true });
      throw error;
    }

    totalProcessed += result.processed ?? 0;
    const cursorToCommit =
      Object.prototype.hasOwnProperty.call(result, "cursor")
        ? result.cursor
        : nextCursor;

    await adminDb.runTransaction(async (tx) => {
      const stateSnap = await tx.get(stateRef);
      const currentCursor = stateSnap.get(cursorKey) ?? null;
      const processing = stateSnap.get(processingKey) as
        | { leaseId?: string }
        | undefined;

      if (processing?.leaseId !== leaseId) {
        throw new Error(
          `[self-queue] Lease changed before cursor commit for ${jobId}`,
        );
      }
      if (currentCursor !== claimedCursor) {
        throw new Error(
          `[self-queue] Cursor changed before commit for ${jobId}`,
        );
      }

      tx.set(stateRef, {
        lastHeartbeatAt: FieldValue.serverTimestamp(),
        [`${cursorKey}`]: cursorToCommit,
        [processingKey]: null,
        lastError: null,
      }, { merge: true });
    });

    if (!result.done) {
      // Claim said there's more work but chunk isn't the last — keep going
      continue;
    }
  }

  // Budget exhausted or max chunks hit — re-queue.
  // The destination is the configured canonical origin; when it is missing the
  // invocation returns without re-querying and the next cron pass resumes.
  if (cronSecret) {
    const origin = resolveConfiguredAppOrigin();
    if (!origin) {
      if (!warnedMissingOrigin) {
        warnedMissingOrigin = true;
        console.warn(
          "[self-queue] No configured APP_URL/NEXT_PUBLIC_APP_URL; skipping re-queue. The next cron pass will resume.",
        );
      }
    } else if (selfUrl && isAllowedSelfUrl(selfUrl, origin)) {
      try {
        await fetch(selfUrl, {
          headers: { authorization: `Bearer ${cronSecret}` },
          signal: AbortSignal.timeout(10_000),
        }).catch(() => {
          // Re-queue fire-and-forget — next cron pass will re-claim
          console.warn("[self-queue] Re-queue fetch failed; next cron pass will resume");
        });
      } catch {
        // Ignore re-queue failures
      }
    }
  }

  return { done: false, processed: totalProcessed, status: "re-queued" };
}

/**
 * Guard the re-queue destination: it must be an absolute https URL on the
 * configured origin, or the CRON_SECRET would be sent somewhere else.
 */
function isAllowedSelfUrl(selfUrl: string, origin: string): boolean {
  try {
    const target = new URL(selfUrl);
    return (
      target.protocol === "https:" &&
      !target.username &&
      !target.password &&
      target.origin === new URL(origin).origin
    );
  } catch {
    return false;
  }
}

/**
 * Build the self URL for re-queuing.
 *
 * The origin is taken from configuration (see `resolveConfiguredAppOrigin`),
 * never from the request URL — the first argument is retained only so existing
 * call sites keep their signature and is intentionally ignored. When no origin
 * is configured this returns an empty string, which the runner treats as "do
 * not re-queue"; the next cron pass picks the work up instead.
 */
export function buildSelfUrl(
  _requestUrl: string,
  pathname: string,
): string {
  const origin = resolveConfiguredAppOrigin();
  if (!origin) {
    if (!warnedMissingOrigin) {
      warnedMissingOrigin = true;
      console.warn(
        "[self-queue] No configured APP_URL/NEXT_PUBLIC_APP_URL; self re-queue disabled.",
      );
    }
    return "";
  }
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${origin}${path}`;
}
