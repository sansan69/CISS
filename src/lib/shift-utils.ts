import type {
  DutyPoint,
  DutyPointCoverageMode,
  DutyPointHours,
  ShiftTemplate,
  SiteShiftMode,
  SiteShiftPattern,
} from "@/types/location";

export const SHIFT_PATTERN_LABELS: Record<SiteShiftPattern, string> = {
  "2x12": "2 shifts / 12 hours",
  "3x8": "3 shifts / 8 hours",
};

export const DUTY_POINT_COVERAGE_LABELS: Record<DutyPointCoverageMode, string> = {
  day: "Day only",
  night: "Night only",
  roundClock: "Round the clock",
};

export const DUTY_POINT_HOURS_LABELS: Record<DutyPointHours, string> = {
  "8": "8 hours",
  "12": "12 hours",
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

export function buildDutyPointShiftTemplates(
  coverageMode: DutyPointCoverageMode = "roundClock",
  dutyHours: DutyPointHours = "12",
): ShiftTemplate[] {
  if (coverageMode === "roundClock") {
    return buildShiftTemplates(dutyHours === "8" ? "3x8" : "2x12");
  }

  if (coverageMode === "day" && dutyHours === "8") {
    return [
      {
        code: "day",
        label: "Day Shift",
        startTime: "08:00",
        endTime: "16:00",
        hours: 8,
        crossesMidnight: false,
      },
    ];
  }

  if (coverageMode === "night" && dutyHours === "8") {
    return [
      {
        code: "night",
        label: "Night Shift",
        startTime: "20:00",
        endTime: "04:00",
        hours: 8,
        crossesMidnight: true,
      },
    ];
  }

  if (coverageMode === "day") {
    return [
      {
        code: "day",
        label: "Day Shift",
        startTime: "08:00",
        endTime: "20:00",
        hours: 12,
        crossesMidnight: false,
      },
    ];
  }

  return [
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

function slugifyDutyPointId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "duty-point";
}

export function normalizeDutyPoint(input: Partial<DutyPoint>, fallbackIndex = 0): DutyPoint {
  const name = String(input.name ?? "").trim() || `Duty Point ${fallbackIndex + 1}`;
  const coverageMode = input.coverageMode ?? "roundClock";
  const dutyHours = input.dutyHours ?? "12";
  const shiftMode = input.shiftMode ?? "fixed";
  const shiftTemplates =
    Array.isArray(input.shiftTemplates) && input.shiftTemplates.length > 0
      ? input.shiftTemplates
      : shiftMode === "fixed"
        ? buildDutyPointShiftTemplates(coverageMode, dutyHours)
        : [];

  return {
    id: String(input.id ?? "").trim() || slugifyDutyPointId(name),
    name,
    code: String(input.code ?? "").trim() || undefined,
    active: input.active !== false,
    coverageMode,
    dutyHours,
    shiftMode,
    shiftTemplates,
    geofenceRadiusMeters:
      typeof input.geofenceRadiusMeters === "number" && Number.isFinite(input.geofenceRadiusMeters)
        ? input.geofenceRadiusMeters
        : undefined,
    notes: String(input.notes ?? "").trim() || undefined,
  };
}

export function resolveSiteDutyPoints(site: {
  dutyPoints?: Partial<DutyPoint>[] | null;
  shiftMode?: SiteShiftMode;
  shiftPattern?: SiteShiftPattern | null;
  shiftTemplates?: ShiftTemplate[] | null;
}) {
  if (Array.isArray(site.dutyPoints) && site.dutyPoints.length > 0) {
    return site.dutyPoints
      .map((point, index) => normalizeDutyPoint(point, index))
      .filter((point) => point.active !== false);
  }

  if (site.shiftMode === "fixed") {
    return [
      normalizeDutyPoint({
        id: "main-duty",
        name: "Main Duty",
        active: true,
        coverageMode: site.shiftPattern === "3x8" ? "roundClock" : "roundClock",
        dutyHours: site.shiftPattern === "3x8" ? "8" : "12",
        shiftMode: "fixed",
        shiftTemplates:
          Array.isArray(site.shiftTemplates) && site.shiftTemplates.length > 0
            ? site.shiftTemplates
            : buildShiftTemplates(site.shiftPattern ?? "2x12"),
      }),
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

export function resolveShiftByCode(
  shiftMode?: SiteShiftMode,
  shiftTemplates?: ShiftTemplate[] | null,
  shiftCode?: string | null,
) {
  if (shiftMode !== "fixed" || !shiftTemplates?.length || !shiftCode) {
    return null;
  }

  return shiftTemplates.find((shift) => shift.code === shiftCode) ?? null;
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
