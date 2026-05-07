import type { DutyPoint, ShiftTemplate } from "@/types/location";
import type {
  GuardPatrolActivityRow,
  PatrolActivityType,
  PatrolPoint,
  PatrolSettings,
} from "@/types/patrol";
import { patrolPointSchema, patrolSettingsSchema } from "@/types/patrol";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseTimeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function dateToIstKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export function resolvePatrolSettings(value: unknown): PatrolSettings {
  return patrolSettingsSchema.parse(value ?? {});
}

export function normalizePatrolPoints(points: unknown): PatrolPoint[] {
  if (!Array.isArray(points)) return [];
  return points
    .map((point, index) => {
      const candidate =
        point && typeof point === "object"
          ? {
              ...(point as Record<string, unknown>),
              id:
                normalizeText((point as Record<string, unknown>).id) ||
                `patrol-point-${index + 1}`,
              name:
                normalizeText((point as Record<string, unknown>).name) ||
                `Patrol Point ${index + 1}`,
              order:
                typeof (point as Record<string, unknown>).order === "number"
                  ? (point as Record<string, unknown>).order
                  : index,
            }
          : null;
      if (!candidate) return null;
      const parsed = patrolPointSchema.safeParse(candidate);
      return parsed.success ? parsed.data : null;
    })
    .filter((point): point is PatrolPoint => point !== null)
    .filter((point) => point.active !== false)
    .sort((left, right) => left.order - right.order);
}

export function resolveDutyPointPatrolPoints(dutyPoint?: Partial<DutyPoint> | null) {
  return normalizePatrolPoints(dutyPoint?.patrolPoints);
}

export function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (typeof (value as { seconds?: unknown }).seconds === "number") {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }
  if (typeof (value as { _seconds?: unknown })._seconds === "number") {
    return new Date((value as { _seconds: number })._seconds * 1000).toISOString();
  }
  return null;
}

export function parseDate(value: unknown): Date | null {
  const iso = serializeDate(value);
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isNightShiftTemplate(shift?: Partial<ShiftTemplate> | null) {
  if (!shift) return false;
  if (shift.crossesMidnight === true) return true;
  const code = normalizeText(shift.code).toLowerCase();
  const label = normalizeText(shift.label).toLowerCase();
  return code.includes("night") || label.includes("night");
}

export function isWithinNightWindow(at: Date, settings: PatrolSettings) {
  const totalMinutes = at.getHours() * 60 + at.getMinutes();
  const start = parseTimeToMinutes(settings.nightWindowStart);
  const end = parseTimeToMinutes(settings.nightWindowEnd);
  if (start == null || end == null) return false;
  return start >= end
    ? totalMinutes >= start || totalMinutes < end
    : totalMinutes >= start && totalMinutes < end;
}

export function computeHourlyNightPatrolState(args: {
  settings: PatrolSettings;
  checkedInAt: Date | null;
  lastHourlyActivityAt: Date | null;
  shift?: Partial<ShiftTemplate> | null;
  now?: Date;
}) {
  const { settings, checkedInAt, lastHourlyActivityAt, shift } = args;
  const now = args.now ?? new Date();
  const hourlyEnabled =
    settings.enabled &&
    settings.hourlyNightPhotoEnabled &&
    isNightShiftTemplate(shift) &&
    checkedInAt instanceof Date &&
    isWithinNightWindow(now, settings);

  if (!hourlyEnabled || !checkedInAt) {
    return {
      enabled: false,
      dueNow: false,
      nextDueAt: null as Date | null,
      overdueMinutes: 0,
      lastSubmittedAt: lastHourlyActivityAt,
    };
  }

  const baseline = lastHourlyActivityAt && lastHourlyActivityAt > checkedInAt
    ? lastHourlyActivityAt
    : checkedInAt;
  const nextDueAt = new Date(baseline.getTime() + settings.hourlyIntervalMinutes * 60 * 1000);
  const dueNow = nextDueAt.getTime() <= now.getTime();
  const overdueMinutes = dueNow
    ? Math.max(0, Math.floor((now.getTime() - nextDueAt.getTime()) / 60000))
    : 0;

  return {
    enabled: true,
    dueNow,
    nextDueAt,
    overdueMinutes,
    lastSubmittedAt: lastHourlyActivityAt,
  };
}

export function toGuardPatrolActivityRow(
  id: string,
  value: Record<string, unknown>,
): GuardPatrolActivityRow {
  const type = normalizeText(value.type) === "hourly_photo" ? "hourly_photo" : "patrol";
  return {
    id,
    type,
    clientId: normalizeText(value.clientId),
    clientName: normalizeText(value.clientName),
    siteId: normalizeText(value.siteId),
    siteName: normalizeText(value.siteName),
    district: normalizeText(value.district),
    guardName: normalizeText(value.guardName || value.employeeName),
    employeeId: normalizeText(value.employeeId),
    employeeDocId: normalizeText(value.employeeDocId),
    dutyPointId: normalizeText(value.dutyPointId) || undefined,
    dutyPointName: normalizeText(value.dutyPointName) || undefined,
    shiftCode: normalizeText(value.shiftCode) || undefined,
    shiftLabel: normalizeText(value.shiftLabel) || undefined,
    patrolPointId: normalizeText(value.patrolPointId) || undefined,
    patrolPointName: normalizeText(value.patrolPointName) || undefined,
    patrolPointDescription: normalizeText(value.patrolPointDescription) || undefined,
    photoUrl: typeof value.photoUrl === "string" ? value.photoUrl : null,
    notes: normalizeText(value.notes) || undefined,
    source: normalizeText(value.source) || "unknown",
    activityAt: serializeDate(value.activityAt),
    activityDate: normalizeText(value.activityDate) || dateToIstKey(new Date()),
    createdAt: serializeDate(value.createdAt),
  };
}

export function buildPatrolActivityPayload(args: {
  type: PatrolActivityType;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  district: string;
  employeeId: string;
  employeeDocId: string;
  guardName: string;
  dutyPointId?: string | null;
  dutyPointName?: string | null;
  shiftCode?: string | null;
  shiftLabel?: string | null;
  patrolPointId?: string | null;
  patrolPointName?: string | null;
  patrolPointDescription?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
  source: string;
  activityAt?: Date | null;
}) {
  const activityAt = args.activityAt ?? new Date();
  return {
    type: args.type,
    clientId: args.clientId,
    clientName: args.clientName,
    siteId: args.siteId,
    siteName: args.siteName,
    district: args.district,
    employeeId: args.employeeId,
    employeeDocId: args.employeeDocId,
    guardName: args.guardName,
    dutyPointId: normalizeText(args.dutyPointId) || null,
    dutyPointName: normalizeText(args.dutyPointName) || null,
    shiftCode: normalizeText(args.shiftCode) || null,
    shiftLabel: normalizeText(args.shiftLabel) || null,
    patrolPointId: normalizeText(args.patrolPointId) || null,
    patrolPointName: normalizeText(args.patrolPointName) || null,
    patrolPointDescription: normalizeText(args.patrolPointDescription) || null,
    photoUrl: args.photoUrl ?? null,
    notes: normalizeText(args.notes) || null,
    source: normalizeText(args.source) || "unknown",
    activityAt,
    activityDate: dateToIstKey(activityAt),
    hourBucketKey: `${dateToIstKey(activityAt)}-${String(activityAt.getHours()).padStart(2, "0")}`,
  };
}
