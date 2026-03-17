"use client";

import { useCallback } from 'react';

/**
 * Haptic feedback patterns (milliseconds).
 * navigator.vibrate is supported on Android Chrome / Samsung browser.
 * iOS Safari does not expose the Vibration API in PWAs; calls are a silent no-op.
 */
const PATTERNS: Record<string, VibratePattern> = {
  /** Subtle tap — icon toggle, expand/collapse, selection change */
  light:     8,
  /** Soft selection — row tap, checkbox/radio toggle */
  selection: [6, 30, 6],
  /** Navigation — page change, modal open, drawer open */
  medium:    20,
  /** Task complete — save, assign, confirm */
  success:   [10, 60, 20],
  /** Caution — opening a destructive confirmation */
  warning:   [20, 40, 20],
  /** Destructive / failure — delete confirmed, error state */
  error:     [30, 40, 30, 40, 30],
};

type HapticPattern = keyof typeof PATTERNS;

/**
 * useHaptics — returns a `haptic(type)` function that fires native
 * device vibration. Falls back silently on unsupported devices.
 *
 * Usage:
 *   const { haptic } = useHaptics();
 *   <Button onClick={() => { haptic('success'); doSave(); }}>Save</Button>
 */
export function useHaptics() {
  const haptic = useCallback((pattern: HapticPattern = 'light') => {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(PATTERNS[pattern]);
  }, []);

  return { haptic };
}
