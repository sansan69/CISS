type TimestampLike = {
  toDate?: () => Date;
  seconds?: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
};

function validDateOrNull(value: Date) {
  return Number.isFinite(value.getTime()) ? value : null;
}

export function toValidAttendanceDate(value: unknown): Date | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return validDateOrNull(value);
  }

  if (typeof value === "string" || typeof value === "number") {
    return validDateOrNull(new Date(value));
  }

  if (typeof value !== "object") return null;

  const timestamp = value as TimestampLike;
  if (typeof timestamp.toDate === "function") {
    try {
      return validDateOrNull(timestamp.toDate());
    } catch {
      return null;
    }
  }

  const seconds =
    typeof timestamp.seconds === "number"
      ? timestamp.seconds
      : typeof timestamp._seconds === "number"
        ? timestamp._seconds
        : null;
  if (seconds == null || !Number.isFinite(seconds)) return null;

  const nanoseconds =
    typeof timestamp.nanoseconds === "number"
      ? timestamp.nanoseconds
      : typeof timestamp._nanoseconds === "number"
        ? timestamp._nanoseconds
        : 0;
  if (!Number.isFinite(nanoseconds)) return null;

  return validDateOrNull(new Date(seconds * 1000 + nanoseconds / 1_000_000));
}
