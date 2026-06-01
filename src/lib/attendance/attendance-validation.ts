import type { ShiftTemplate } from "@/types/location";
import { DEFAULT_SHIFT_TIME_ZONE } from "@/lib/shift-utils";

export type AttendanceStateSnapshot = {
  lastAttendanceDate?: string | null;
  lastStatus?: "In" | "Out" | null;
  lastSiteId?: string | null;
  lastDutyPointId?: string | null;
  lastShiftCode?: string | null;
  openSessionId?: string | null;
  openSessionStartedAt?: unknown;
  /** When the current open session should auto-close (ISO string) */
  autoCheckoutAt?: string | null;
};

export type AttendanceShiftSnapshot = {
  code?: string | null;
  crossesMidnight?: boolean | null;
  startTime?: string | null;
  endTime?: string | null;
  hours?: number | null;
} | null;

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

function isImmediateNextDate(previousDate: string, nextDate: string) {
  const previous = parseDateKey(previousDate);
  const next = parseDateKey(nextDate);

  if (previous === null || next === null) {
    return false;
  }

  return next - previous === 24 * 60 * 60 * 1000;
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function getMinutesInTimeZone(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return at.getHours() * 60 + at.getMinutes();
  }

  return hour * 60 + minute;
}

/**
 * Calculate when an open session should auto-checkout based on shift end time.
 * Returns ISO string or null if cannot determine.
 */
export function computeAutoCheckoutTime(params: {
  sessionStartDate: string; // YYYY-MM-DD
  shift: AttendanceShiftSnapshot;
  bufferMinutes?: number;
  timeZone?: string;
}): string | null {
  const { sessionStartDate, shift, bufferMinutes = 120, timeZone = DEFAULT_SHIFT_TIME_ZONE } = params;

  if (!shift?.endTime || !shift?.startTime) return null;

  const startMin = timeToMinutes(shift.startTime);
  const endMin = timeToMinutes(shift.endTime);

  // Parse session start date as UTC midnight
  const [year, month, day] = sessionStartDate.split("-").map(Number);
  const sessionStart = Date.UTC(year, month - 1, day);

  // Determine the date when the shift ends
  const crossesMidnight = startMin >= endMin;
  const shiftEndTimestamp = crossesMidnight
    ? sessionStart + 24 * 60 * 60 * 1000
    : sessionStart;

  const endHour = Math.floor(endMin / 60);
  const endMinute = endMin % 60;

  const autoCheckout = new Date(
    shiftEndTimestamp + (endHour * 60 + endMinute + bufferMinutes) * 60 * 1000,
  );

  return autoCheckout.toISOString();
}

/**
 * Check if an open session is stale and should be auto-closed.
 * A session is stale if:
 * - It's past the computed auto-checkout time (shift end + buffer)
 * - OR it's more than 24 hours old with no shift info
 */
export function isSessionStale(params: {
  lastState: AttendanceStateSnapshot;
  now?: Date;
  maxSessionHours?: number;
}): { stale: boolean; reason: string } {
  const { lastState, now = new Date(), maxSessionHours = 24 } = params;

  if (lastState.lastStatus !== "In" || !lastState.lastAttendanceDate) {
    return { stale: false, reason: "No open session." };
  }

  // Check explicit auto-checkout time
  if (lastState.autoCheckoutAt) {
    const autoCheckoutTime = new Date(lastState.autoCheckoutAt);
    if (now > autoCheckoutTime) {
      return {
        stale: true,
        reason: `Session exceeded auto-checkout time (${autoCheckoutTime.toISOString()}).`,
      };
    }
  }

  // Fallback: session older than max hours
  const [y, m, d] = lastState.lastAttendanceDate.split("-").map(Number);
  const sessionStart = Date.UTC(y, m - 1, d);
  const hoursOpen = (now.getTime() - sessionStart) / (1000 * 60 * 60);

  if (hoursOpen > maxSessionHours) {
    return {
      stale: true,
      reason: `Session open for ${Math.round(hoursOpen)} hours (max ${maxSessionHours}h).`,
    };
  }

  return { stale: false, reason: "Session within allowed window." };
}

function getCheckoutShift(input: {
  shift: AttendanceShiftSnapshot;
  lastShift?: AttendanceShiftSnapshot;
  lastState: AttendanceStateSnapshot;
}) {
  const currentShiftCode = input.shift?.code ?? null;
  const lastShiftCode = input.lastState.lastShiftCode ?? null;

  if (
    input.lastShift?.crossesMidnight === true &&
    (!lastShiftCode || input.lastShift.code === lastShiftCode)
  ) {
    return input.lastShift;
  }

  if (currentShiftCode && lastShiftCode && currentShiftCode !== lastShiftCode) {
    return null;
  }

  return input.shift;
}

function canUseOpenSessionDateForCheckout(input: {
  attendanceDate: string;
  status: "In" | "Out";
  shift: AttendanceShiftSnapshot;
  lastShift?: AttendanceShiftSnapshot;
  lastState: AttendanceStateSnapshot;
}) {
  if (input.status !== "Out") return false;

  const lastAttendanceDate = input.lastState.lastAttendanceDate ?? null;
  if (!lastAttendanceDate || lastAttendanceDate === input.attendanceDate) {
    return false;
  }

  if (!isImmediateNextDate(lastAttendanceDate, input.attendanceDate)) {
    return false;
  }

  if (input.lastState.lastStatus !== "In") {
    return false;
  }

  const checkoutShift = getCheckoutShift({
    shift: input.shift,
    lastShift: input.lastShift,
    lastState: input.lastState,
  });

  return checkoutShift?.crossesMidnight === true;
}

export function canRecordNextDayCheckout(input: {
  attendanceDate: string;
  status: "In" | "Out";
  siteId: string;
  dutyPointId?: string | null;
  shift: AttendanceShiftSnapshot;
  lastShift?: AttendanceShiftSnapshot;
  lastState: AttendanceStateSnapshot;
}) {
  if (input.status !== "Out") return false;

  const lastAttendanceDate = input.lastState.lastAttendanceDate ?? null;
  if (!lastAttendanceDate || lastAttendanceDate === input.attendanceDate) {
    return false;
  }

  if (!isImmediateNextDate(lastAttendanceDate, input.attendanceDate)) {
    return false;
  }

  if (input.lastState.lastStatus !== "In") {
    return false;
  }

  if ((input.lastState.lastSiteId ?? null) !== input.siteId) {
    return false;
  }

  if ((input.lastState.lastDutyPointId ?? null) !== (input.dutyPointId ?? null)) {
    return false;
  }

  // If lastShift is explicitly provided, use its crossesMidnight flag
  if (input.lastShift) {
    const checkoutShift = getCheckoutShift({
      shift: input.shift,
      lastShift: input.lastShift,
      lastState: input.lastState,
    });
    return checkoutShift?.crossesMidnight === true;
  }

  // When lastShift is not provided but we have lastShiftCode:
  // If the current shift code differs from lastShiftCode on consecutive dates,
  // this is an overnight shift checkout (e.g., night shift ending next morning)
  const currentShiftCode = input.shift?.code ?? null;
  const lastShiftCode = input.lastState.lastShiftCode ?? null;
  if (currentShiftCode && lastShiftCode && currentShiftCode !== lastShiftCode) {
    return true;
  }

  // Same shift code — check if it crosses midnight
  if (currentShiftCode === lastShiftCode && input.shift?.crossesMidnight) {
    return true;
  }

  return false;
}

export function resolveOperationalAttendanceDate(input: {
  attendanceDate: string;
  status: "In" | "Out";
  siteId: string;
  dutyPointId?: string | null;
  shift: AttendanceShiftSnapshot;
  lastShift?: AttendanceShiftSnapshot;
  lastState?: AttendanceStateSnapshot | null;
}) {
  const lastState = input.lastState ?? null;
  if (!lastState) {
    return input.attendanceDate;
  }

  if (
    canRecordNextDayCheckout({
      attendanceDate: input.attendanceDate,
      status: input.status,
      siteId: input.siteId,
      dutyPointId: input.dutyPointId,
      shift: input.shift,
      lastShift: input.lastShift,
      lastState,
    })
  ) {
    return lastState.lastAttendanceDate ?? input.attendanceDate;
  }

  return input.attendanceDate;
}

export function resolveAttendanceSubmissionWindow(input: {
  attendanceDate: string;
  status: "In" | "Out";
  siteId: string;
  dutyPointId?: string | null;
  shift: AttendanceShiftSnapshot;
  lastShift?: AttendanceShiftSnapshot;
  lastState?: AttendanceStateSnapshot | null;
}) {
  const lastState = input.lastState ?? null;
  const closingOpenSession =
    input.status === "Out" &&
    lastState?.lastStatus === "In" &&
    Boolean(lastState.lastAttendanceDate);

  if (!closingOpenSession) {
    return {
      attendanceDate: resolveOperationalAttendanceDate(input),
      openSessionId: null,
      closingOpenSession: false,
      contextChanged: false,
      requiresAdminReview: false,
    };
  }

  const currentDutyPointId = input.dutyPointId ?? null;
  const currentShiftCode = input.shift?.code ?? null;
  const lastSiteId = lastState.lastSiteId ?? null;
  const lastDutyPointId = lastState.lastDutyPointId ?? null;
  const lastShiftCode = lastState.lastShiftCode ?? null;
  const contextChanged =
    lastSiteId !== input.siteId ||
    lastDutyPointId !== currentDutyPointId ||
    Boolean(lastShiftCode && currentShiftCode && lastShiftCode !== currentShiftCode);

  const shouldUseOpenSessionDate =
    lastState.lastAttendanceDate === input.attendanceDate ||
    canUseOpenSessionDateForCheckout({
      attendanceDate: input.attendanceDate,
      status: input.status,
      shift: input.shift,
      lastShift: input.lastShift,
      lastState,
    });

  return {
    attendanceDate: shouldUseOpenSessionDate
      ? lastState.lastAttendanceDate ?? input.attendanceDate
      : input.attendanceDate,
    openSessionId: lastState.openSessionId ?? null,
    closingOpenSession: true,
    contextChanged,
    requiresAdminReview: contextChanged,
  };
}

/**
 * Check if a new IN punch should be allowed given the current state.
 * Returns { ok, reason?, action? } where action can be:
 * - "block": reject the punch
 * - "autoClosePrevious": close previous session and allow
 * - "allow": proceed normally
 */
export function canRecordIn(params: {
  lastState: AttendanceStateSnapshot | null;
  attendanceDate: string;
  siteId: string;
  dutyPointId?: string | null;
  shift: AttendanceShiftSnapshot;
  employeeDocId: string;
  /** If true, allows same-day duplicate IN with auto-close of previous */
  allowAutoCloseStale?: boolean;
}): { ok: boolean; reason?: string; action: "block" | "autoClosePrevious" | "allow" } {
  const { lastState, attendanceDate, siteId, dutyPointId, allowAutoCloseStale = true } = params;

  // No previous state → always allow IN
  if (!lastState || !lastState.lastStatus) {
    return { ok: true, action: "allow" };
  }

  // Previous state was OUT → allow new IN
  if (lastState.lastStatus === "Out") {
    return { ok: true, action: "allow" };
  }

  // Previous state was IN on a different date
  if (lastState.lastAttendanceDate !== attendanceDate) {
    // Check if session is stale (should have auto-closed)
    const staleCheck = isSessionStale({ lastState });
    if (staleCheck.stale && allowAutoCloseStale) {
      return {
        ok: true,
        reason: staleCheck.reason,
        action: "autoClosePrevious",
      };
    }
    // Not stale but different date → this is an overnight shift continuing
    return { ok: true, action: "allow" };
  }

  // Previous state was IN on the SAME date
  // Check if it's a shift handoff (same duty point, different guard is handled by caller)
  if (lastState.lastSiteId === siteId && lastState.lastDutyPointId === (dutyPointId ?? null)) {
    return {
      ok: false,
      reason: "You are already clocked IN at this duty point. Please mark OUT before marking IN again.",
      action: "block",
    };
  }

  // Same date, different site/duty point → allow (guard moved to different location)
  return { ok: true, action: "allow" };
}

/**
 * Check if an OUT punch should be allowed.
 */
export function canRecordOut(params: {
  lastState: AttendanceStateSnapshot | null;
  attendanceDate: string;
  siteId: string;
  dutyPointId?: string | null;
  shift: AttendanceShiftSnapshot;
  /** If true, allows OUT even without open session (for stale session cleanup) */
  allowStaleClose?: boolean;
}): { ok: boolean; reason?: string; action: "block" | "autoCloseStale" | "allow" } {
  const { lastState, attendanceDate, siteId, dutyPointId, shift, allowStaleClose = true } = params;

  // No open session
  if (!lastState || lastState.lastStatus !== "In") {
    return {
      ok: false,
      reason: "You haven't marked IN yet. Please mark IN first before recording OUT.",
      action: "block",
    };
  }

  // Check for next-day checkout (overnight shift)
  const canNextDay = canRecordNextDayCheckout({
    attendanceDate,
    status: "Out",
    siteId,
    dutyPointId,
    shift,
    lastState,
  });

  if (canNextDay) {
    return { ok: true, action: "allow" };
  }

  // Same-date checkout
  if (lastState.lastAttendanceDate === attendanceDate) {
    if (lastState.lastSiteId !== siteId || lastState.lastDutyPointId !== (dutyPointId ?? null)) {
      // Context changed → still allow but will flag for review
      return { ok: true, action: "allow" };
    }
    return { ok: true, action: "allow" };
  }

  // Different date, not next-day eligible
  if (allowStaleClose) {
    const staleCheck = isSessionStale({ lastState });
    if (staleCheck.stale) {
      return {
        ok: true,
        reason: staleCheck.reason,
        action: "autoCloseStale",
      };
    }
  }

  return {
    ok: false,
    reason: "No open session found for today. Your last IN was on " + (lastState.lastAttendanceDate ?? "unknown date") + ".",
    action: "block",
  };
}
