export function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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

export function sortByDateDesc<T>(
  rows: T[],
  pick: (row: T) => unknown,
) {
  return [...rows].sort((left, right) => {
    const leftIso = serializeDate(pick(left));
    const rightIso = serializeDate(pick(right));
    const leftMs = leftIso ? new Date(leftIso).getTime() : 0;
    const rightMs = rightIso ? new Date(rightIso).getTime() : 0;
    return rightMs - leftMs;
  });
}

export function formatDateLabel(value: unknown) {
  const iso = serializeDate(value);
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return normalizeText(value);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export function toInt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}
