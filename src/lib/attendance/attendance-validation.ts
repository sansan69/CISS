export type AttendanceStateSnapshot = {
  lastAttendanceDate?: string | null;
  lastStatus?: "In" | "Out" | null;
  lastSiteId?: string | null;
  lastDutyPointId?: string | null;
  lastShiftCode?: string | null;
  openSessionId?: string | null;
  openSessionStartedAt?: unknown;
};

export type AttendanceShiftSnapshot = {
  code?: string | null;
  crossesMidnight?: boolean | null;
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

  const checkoutShift = getCheckoutShift({
    shift: input.shift,
    lastShift: input.lastShift,
    lastState: input.lastState,
  });

  if (!checkoutShift?.crossesMidnight) {
    return false;
  }

  return true;
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
