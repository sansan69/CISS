import type {
  ShiftTemplate,
  SiteShiftMode,
  SiteShiftPattern,
} from "@/types/location";

export const SHIFT_PATTERN_LABELS: Record<SiteShiftPattern, string> = {
  "2x12": "2 shifts / 12 hours",
  "3x8": "3 shifts / 8 hours",
};

export function buildShiftTemplates(pattern?: SiteShiftPattern | null): ShiftTemplate[] {
  if (pattern === "2x12") {
    return [
      {
        code: "day",
        label: "Day Shift",
        startTime: "08:00",
        endTime: "20:00",
        hours: 12,
        crossesMidnight: false,
      },
      {
        code: "night",
        label: "Night Shift",
        startTime: "20:00",
        endTime: "08:00",
        hours: 12,
        crossesMidnight: true,
      },
    ];
  }

  if (pattern === "3x8") {
    return [
      {
        code: "morning",
        label: "Morning Shift",
        startTime: "06:00",
        endTime: "14:00",
        hours: 8,
        crossesMidnight: false,
      },
      {
        code: "evening",
        label: "Evening Shift",
        startTime: "14:00",
        endTime: "22:00",
        hours: 8,
        crossesMidnight: false,
      },
      {
        code: "night",
        label: "Night Shift",
        startTime: "22:00",
        endTime: "06:00",
        hours: 8,
        crossesMidnight: true,
      },
    ];
  }

  return [];
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function resolveSiteShift(
  shiftMode?: SiteShiftMode,
  shiftTemplates?: ShiftTemplate[] | null,
  at: Date = new Date(),
) {
  if (shiftMode !== "fixed" || !shiftTemplates?.length) {
    return null;
  }

  const totalMinutes = at.getHours() * 60 + at.getMinutes();

  for (const shift of shiftTemplates) {
    const start = timeToMinutes(shift.startTime);
    const end = timeToMinutes(shift.endTime);
    const inShift = shift.crossesMidnight
      ? totalMinutes >= start || totalMinutes < end
      : totalMinutes >= start && totalMinutes < end;

    if (inShift) {
      return shift;
    }
  }

  return null;
}

export function getNextShift(
  shiftMode?: SiteShiftMode,
  shiftTemplates?: ShiftTemplate[] | null,
  currentShiftCode?: string | null,
) {
  if (shiftMode !== "fixed" || !shiftTemplates?.length) {
    return null;
  }

  const index = shiftTemplates.findIndex((shift) => shift.code === currentShiftCode);
  if (index === -1) {
    return shiftTemplates[0] ?? null;
  }
  return shiftTemplates[(index + 1) % shiftTemplates.length] ?? null;
}
