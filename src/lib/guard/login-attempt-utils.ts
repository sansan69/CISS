export const GUARD_PIN_LOCKOUT_THRESHOLD = 10;
export const GUARD_PIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export function buildFailedPinAttemptUpdate(
  currentAttempts: unknown,
  now: number,
) {
  const previousAttempts =
    typeof currentAttempts === "number" && Number.isFinite(currentAttempts)
      ? Math.max(0, currentAttempts)
      : 0;
  const guardFailedAttempts = previousAttempts + 1;

  return {
    guardFailedAttempts,
    ...(guardFailedAttempts >= GUARD_PIN_LOCKOUT_THRESHOLD
      ? {
          guardLockoutUntil: new Date(
            now + GUARD_PIN_LOCKOUT_WINDOW_MS,
          ),
        }
      : {}),
  };
}
