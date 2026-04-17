function formatDateOnly(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

type TimestampWithToDate = { toDate: () => Date };
type TimestampWithSeconds = { seconds?: number; _seconds?: number };
type TimestampLike = TimestampWithToDate | TimestampWithSeconds;

function isTimestampLike(value: unknown): value is TimestampLike {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    typeof (value as { toDate?: unknown }).toDate === "function" ||
    typeof (value as { seconds?: unknown }).seconds === "number" ||
    typeof (value as { _seconds?: unknown })._seconds === "number"
  );
}

function hasToDate(value: TimestampLike): value is TimestampWithToDate {
  return "toDate" in value && typeof value.toDate === "function";
}

function hasSeconds(value: TimestampLike): value is TimestampWithSeconds {
  return "seconds" in value || "_seconds" in value;
}

export function normalizeGuardPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function normalizeGuardDob(value: unknown): string {
  if (!value) {
    return "";
  }

  if (value instanceof Date) {
    return formatDateOnly(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    return formatDateOnly(new Date(trimmed));
  }

  if (isTimestampLike(value)) {
    if (hasToDate(value)) {
      return formatDateOnly(value.toDate());
    }

    if (!hasSeconds(value)) {
      return "";
    }

    const seconds =
      typeof value.seconds === "number"
        ? value.seconds
        : typeof value._seconds === "number"
          ? value._seconds
          : null;

    if (seconds !== null) {
      return formatDateOnly(new Date(seconds * 1000));
    }
  }

  return "";
}
