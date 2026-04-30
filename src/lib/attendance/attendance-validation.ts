export type AttendanceStateSnapshot = {
  lastAttendanceDate?: string | null;
  lastStatus?: "In" | "Out" | null;
  lastSiteId?: string | null;
  lastDutyPointId?: string | null;
  lastShiftCode?: string | null;
};

export type AttendanceShiftSnapshot = {
  code?: string | null;
  crossesMidnight?: boolean | null;
} | null;

export function canRecordNextDayCheckout(input: {
  attendanceDate: string;
  status: "In" | "Out";
  siteId: string;
  dutyPointId?: string | null;
  shift: AttendanceShiftSnapshot;
  lastState: AttendanceStateSnapshot;
}) {
  if (input.status !== "Out") return false;
  if (!input.shift?.crossesMidnight) return false;

  const lastAttendanceDate = input.lastState.lastAttendanceDate ?? null;
  if (!lastAttendanceDate || lastAttendanceDate === input.attendanceDate) {
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

  const currentShiftCode = input.shift.code ?? null;
  const lastShiftCode = input.lastState.lastShiftCode ?? null;
  if (currentShiftCode && lastShiftCode && currentShiftCode !== lastShiftCode) {
    return false;
  }

  return true;
}
