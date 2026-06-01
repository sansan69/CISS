import type {
  DutyPoint,
  DutyPointCoverageMode,
  DutyPointHours,
  ShiftTemplate,
  SiteShiftMode,
  SiteShiftPattern,
} from "@/types/location";
import { normalizePatrolPoints } from "@/lib/patrol";

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

export const DEFAULT_SHIFT_TIME_ZONE = "Asia/Kolkata";

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

  const dutyPoint: DutyPoint = {
    id: String(input.id ?? "").trim() || slugifyDutyPointId(name),
    name,
    active: input.active !== false,
    coverageMode,
    dutyHours,
    shiftMode,
    shiftTemplates,
    patrolPoints: normalizePatrolPoints(input.patrolPoints),
  };

  const code = String(input.code ?? "").trim();
  if (code) {
    dutyPoint.code = code;
  }

  if (
    typeof input.geofenceRadiusMeters === "number" &&
    Number.isFinite(input.geofenceRadiusMeters)
  ) {
    dutyPoint.geofenceRadiusMeters = input.geofenceRadiusMeters;
  }

  const notes = String(input.notes ?? "").trim();
  if (notes) {
    dutyPoint.notes = notes;
  }

  return dutyPoint;
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

export function resolveSiteShift(
  shiftMode?: SiteShiftMode,
  shiftTemplates?: ShiftTemplate[] | null,
  at: Date = new Date(),
  timeZone = DEFAULT_SHIFT_TIME_ZONE,
) {
  if (shiftMode !== "fixed" || !shiftTemplates?.length) {
    return null;
  }

  const totalMinutes = getMinutesInTimeZone(at, timeZone);

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

/**
 * Resolve the shift a guard is reporting for based on punch time and attendance status.
 *
 * This is DIFFERENT from `resolveSiteShift()` which answers "what shift is currently active?".
 * This function answers "which shift is the guard reporting for?" considering early/late
 * arrivals, shift handoff windows, and the guard's open session state.
 *
 * Industry-standard rules applied:
 * - IN punches: match to nearest shift start within tolerance (early arrival window)
 * - OUT punches: use the shift from the open IN session
 * - Handoff window: during the last ~2h of a shift, a new IN is assumed for the NEXT shift
 *   (prevents guards punching in at 06:45 being assigned to night shift ending at 08:00)
 */
export function resolveAttendanceShift({
  shiftTemplates,
  punchAt,
  status,
  explicitShiftCode,
  lastShiftCode,
  timeZone = DEFAULT_SHIFT_TIME_ZONE,
  toleranceMinutesBefore = 120,
  toleranceMinutesAfter = 60,
  handoffWindowMinutes = 120,
}: {
  shiftTemplates: ShiftTemplate[];
  punchAt: Date;
  status: "In" | "Out";
  explicitShiftCode?: string | null;
  lastShiftCode?: string | null;
  timeZone?: string;
  toleranceMinutesBefore?: number;
  toleranceMinutesAfter?: number;
  handoffWindowMinutes?: number;
}): ShiftTemplate | null {
  // 1. Explicit shift selection always wins
  if (explicitShiftCode) {
    return resolveShiftByCode("fixed", shiftTemplates, explicitShiftCode);
  }

  // 2. OUT punches use the shift from the open session
  if (status === "Out" && lastShiftCode) {
    return resolveShiftByCode("fixed", shiftTemplates, lastShiftCode);
  }

  if (!shiftTemplates.length) return null;

  const punchMinutes = getMinutesInTimeZone(punchAt, timeZone);
  let bestShift: ShiftTemplate | null = null;
  let bestScore = Infinity;

  for (const shift of shiftTemplates) {
    const start = timeToMinutes(shift.startTime);
    const duration = shift.hours * 60;

    // Minutes until this shift starts (0–1439)
    const forwardDistance = (start - punchMinutes + 24 * 60) % (24 * 60);

    // Minutes since this shift started (0–1439)
    const timeInShift = (punchMinutes - start + 24 * 60) % (24 * 60);

    let score: number;

    if (forwardDistance > 0 && forwardDistance <= toleranceMinutesBefore) {
      // Punch is before shift start — early arrival
      score = forwardDistance;
    } else if (timeInShift <= toleranceMinutesAfter) {
      // Punch is at or right after shift start — late arrival
      score = timeInShift + 0.5;
    } else if (timeInShift < duration - handoffWindowMinutes) {
      // Punch is well into the shift — guard is working this shift
      score = timeInShift + toleranceMinutesBefore;
    } else {
      // Punch is in the tail-end handoff window.
      // A new IN here is almost certainly for the NEXT shift.
      continue;
    }

    if (score < bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }

  return bestShift;
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
