import type { GuardLocation } from "@/types/guard-location";

export type GuardLocationHealth =
  | "live"
  | "out_of_zone"
  | "poor_accuracy"
  | "delayed"
  | "stale";

export function guardLocationUpdatedAt(location: GuardLocation): Date | null {
  const value = location.updatedAt;
  if (!value) return null;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function getGuardLocationHealth(
  location: GuardLocation,
  now = new Date(),
): GuardLocationHealth {
  const updatedAt = guardLocationUpdatedAt(location);
  if (!updatedAt) return "stale";

  const ageMs = Math.max(0, now.getTime() - updatedAt.getTime());
  if (ageMs > 10 * 60 * 1000) return "stale";
  if (ageMs > 5 * 60 * 1000) return "delayed";
  if (location.zoneStatus === "poor_accuracy" || location.gpsReliable === false) {
    return "poor_accuracy";
  }
  if (location.zoneStatus === "out_of_zone" || location.isOutOfZone) {
    return "out_of_zone";
  }
  return "live";
}

export function guardLocationHealthLabel(health: GuardLocationHealth) {
  switch (health) {
    case "out_of_zone":
      return "Outside site zone";
    case "poor_accuracy":
      return "Weak GPS accuracy";
    case "delayed":
      return "Update delayed";
    case "stale":
      return "Tracking stale";
    default:
      return "Live and in zone";
  }
}
