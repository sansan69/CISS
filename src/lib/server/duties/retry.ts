/**
 * Duty writes run inside Firestore transactions. Transactions abort when their
 * read set changes underneath them (a supervisor saves the same roster twice,
 * or another centre commits while we are writing), and Firestore reports that
 * as `ABORTED` / lock timeout. Those failures are transient: the same request
 * succeeds a moment later, so they must never be reported as a hard failure to
 * the person assigning guards.
 */

const CONTENTION_CODES = new Set(["10", "4", "14", "8"]); // ABORTED, DEADLINE_EXCEEDED, UNAVAILABLE, RESOURCE_EXHAUSTED

const CONTENTION_MESSAGE = /ABORTED|lock timeout|contention|transaction (?:was )?aborted|DEADLINE_EXCEEDED|UNAVAILABLE|RESOURCE_EXHAUSTED|too (?:much|many) contention/i;

/** True when [error] is a transient contention/unavailability failure worth retrying. */
export function isContentionError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : typeof candidate?.code === "number" ? String(candidate.code) : "";
  const message = typeof candidate?.message === "string" ? candidate.message : "";
  if (CONTENTION_CODES.has(code)) return true;
  return CONTENTION_MESSAGE.test(message);
}

export type ContentionRetryOptions = {
  /** Total attempts, including the first one. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs [run] again when it fails with a contention error, backing off with
 * jitter so parallel supervisors do not retry in lockstep.
 */
export async function retryOnContention<T>(
  run: () => Promise<T>,
  options: ContentionRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 4));
  const baseDelay = Math.max(0, options.baseDelayMs ?? 120);
  const maxDelay = Math.max(baseDelay, options.maxDelayMs ?? 1500);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isContentionError(error) || attempt === attempts - 1) throw error;
      const ceiling = Math.min(maxDelay, baseDelay * 2 ** attempt);
      await sleep(Math.round(ceiling * (0.5 + random() * 0.5)));
    }
  }
  throw lastError;
}
