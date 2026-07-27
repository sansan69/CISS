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
  /** When the current open session should auto-close. */
  autoCheckoutAt?: unknown;
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

function parseISTDateStart(value: string) {
  const parsed = Date.parse(`${value}T00:00:00+05:30`);
  return Number.isNaN(parsed) ? null : parsed;
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

function addDays(dateKey: string, days: number) {
  const parsed = parseDateKey(dateKey);
  if (parsed === null) return null;
  return new Date(parsed + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function getZonedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

function zonedDateTimeToDate(
  dateKey: string,
  time: string,
  timeZone: string,
) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const desiredUtc = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  let candidate = new Date(desiredUtc);

  // Resolve the timezone offset from Intl instead of hard-coding IST. Two
  // passes also handle timezones whose offset changes near the requested date.
  for (let index = 0; index < 2; index += 1) {
    const displayed = getZonedParts(candidate, timeZone);
    const displayedUtc = Date.UTC(
      displayed.year,
      displayed.month - 1,
      displayed.day,
      displayed.hour,
      displayed.minute,
    );
    candidate = new Date(candidate.getTime() + desiredUtc - displayedUtc);
  }

  return candidate;
}

export function computeShiftInterval(params: {
  operationalDate: string;
  shift: AttendanceShiftSnapshot;
  bufferMinutes?: number;
  timeZone?: string;
}) {
  const {
    operationalDate,
    shift,
    bufferMinutes = 120,
    timeZone = DEFAULT_SHIFT_TIME_ZONE,
  } = params;
  if (!shift?.startTime || !shift.endTime) return null;

  const startMinutes = timeToMinutes(shift.startTime);
  const endMinutes = timeToMinutes(shift.endTime);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
    return null;
  }

  const crossesMidnight = endMinutes <= startMinutes;
  const endDate = crossesMidnight
    ? addDays(operationalDate, 1)
    : operationalDate;
  if (!endDate) return null;

  const shiftStartsAt = zonedDateTimeToDate(
    operationalDate,
    shift.startTime,
    timeZone,
  );
  const shiftEndsAt = zonedDateTimeToDate(endDate, shift.endTime, timeZone);
  if (!shiftStartsAt || !shiftEndsAt) return null;

  return {
    operationalDate,
    crossesMidnight,
    shiftStartsAt: shiftStartsAt.toISOString(),
    shiftEndsAt: shiftEndsAt.toISOString(),
    autoCheckoutAt: new Date(
      shiftEndsAt.getTime() + bufferMinutes * 60 * 1000,
    ).toISOString(),
  };
}

export function resolveShiftOperationalDate(params: {
  punchAt: Date;
  shift: AttendanceShiftSnapshot;
  status: "In" | "Out";
  openSessionOperationalDate?: string | null;
  timeZone?: string;
}) {
  if (params.status === "Out" && params.openSessionOperationalDate) {
    return params.openSessionOperationalDate;
  }

  const timeZone = params.timeZone ?? DEFAULT_SHIFT_TIME_ZONE;
  const parts = getZonedParts(params.punchAt, timeZone);
  const currentDate = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  if (!params.shift?.startTime || !params.shift.endTime) return currentDate;

  const startMinutes = timeToMinutes(params.shift.startTime);
  const endMinutes = timeToMinutes(params.shift.endTime);
  const punchMinutes = parts.hour * 60 + parts.minute;
  const crossesMidnight = endMinutes <= startMinutes;

  if (crossesMidnight && punchMinutes < endMinutes) {
    return addDays(currentDate, -1) ?? currentDate;
  }
  return currentDate;
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
  return (
    computeShiftInterval({
      operationalDate: params.sessionStartDate,
      shift: params.shift,
      bufferMinutes: params.bufferMinutes,
      timeZone: params.timeZone,
    })?.autoCheckoutAt ?? null
  );
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
    const value = lastState.autoCheckoutAt as {
      toDate?: () => Date;
      seconds?: number;
    };
    const autoCheckoutTime =
      typeof value.toDate === "function"
        ? value.toDate()
        : typeof value.seconds === "number"
          ? new Date(value.seconds * 1000)
          : new Date(String(lastState.autoCheckoutAt));
    if (!Number.isNaN(autoCheckoutTime.getTime()) && now > autoCheckoutTime) {
      return {
        stale: true,
        reason: `Session exceeded auto-checkout time (${autoCheckoutTime.toISOString()}).`,
      };
    }
  }

  // Fallback: session older than max hours
  const sessionStart = parseISTDateStart(lastState.lastAttendanceDate);
  if (sessionStart === null) {
    return { stale: false, reason: "Invalid attendance date." };
  }
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

  const currentShiftCode = input.shift?.code ?? null;
  const lastShiftCode = input.lastState.lastShiftCode ?? null;
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

  return {
    // OUT always closes the exact open session and keeps the operational date
    // established by its IN punch. The current clock/shift must not reclassify it.
    attendanceDate: lastState.lastAttendanceDate ?? input.attendanceDate,
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

  if (lastState.lastAttendanceDate === attendanceDate) {
    return {
      ok: false,
      reason:
        lastState.lastSiteId === siteId &&
        lastState.lastDutyPointId === (dutyPointId ?? null)
          ? "You are already marked IN here. Mark OUT before starting another shift."
          : "You already have an open attendance session. Mark OUT before changing site or duty point.",
      action: "block",
    };
  }

  const staleCheck = isSessionStale({ lastState });
  if (staleCheck.stale && allowAutoCloseStale) {
    return {
      ok: true,
      reason: staleCheck.reason,
      action: "autoClosePrevious",
    };
  }

  return {
    ok: false,
    reason:
      lastState.lastSiteId === siteId &&
      lastState.lastDutyPointId === (dutyPointId ?? null)
        ? "You are already marked IN here. Mark OUT before starting another shift."
        : "You already have an open attendance session. Mark OUT before changing site or duty point.",
    action: "block",
  };
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
  const { lastState } = params;

  // No open session
  if (!lastState || lastState.lastStatus !== "In") {
    return {
      ok: false,
      reason: "You haven't marked IN yet. Please mark IN first before recording OUT.",
      action: "block",
    };
  }

  // OUT closes the exact open session. The stored session owns
  // operational date, shift, site, and duty-point context.
  return { ok: true, action: "allow" };
}
