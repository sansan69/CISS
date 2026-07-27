import { haversineDistanceMeters } from "@/lib/geo";

export const DEFAULT_LIVE_GPS_ACCURACY_LIMIT_METERS = 150;
export const LOCATION_HISTORY_INTERVAL_MS = 5 * 60 * 1000;
export const LOCATION_HISTORY_RETENTION_DAYS = 30;

export type LiveLocationZoneStatus =
  | "in_zone"
  | "out_of_zone"
  | "poor_accuracy";

export function isValidLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function resolveLiveLocation(params: {
  guardLat: number;
  guardLng: number;
  accuracyMeters: number;
  siteLat: number;
  siteLng: number;
  geofenceRadiusMeters: number;
  accuracyLimitMeters?: number;
}) {
  const accuracyLimitMeters =
    params.accuracyLimitMeters ??
    DEFAULT_LIVE_GPS_ACCURACY_LIMIT_METERS;
  const distanceFromSite = haversineDistanceMeters(
    params.guardLat,
    params.guardLng,
    params.siteLat,
    params.siteLng,
  );
  const hasReliableAccuracy =
    Number.isFinite(params.accuracyMeters) &&
    params.accuracyMeters > 0 &&
    params.accuracyMeters <= accuracyLimitMeters;
  const zoneStatus: LiveLocationZoneStatus = !hasReliableAccuracy
    ? "poor_accuracy"
    : distanceFromSite > params.geofenceRadiusMeters
      ? "out_of_zone"
      : "in_zone";

  return {
    distanceFromSite,
    hasReliableAccuracy,
    zoneStatus,
    isOutOfZone: zoneStatus === "out_of_zone",
  };
}

export function buildLocationHistoryBucketId(
  sessionId: string,
  at: Date,
) {
  const bucket = Math.floor(
    at.getTime() / LOCATION_HISTORY_INTERVAL_MS,
  );
  return `${sessionId}_${bucket}`;
}

export function buildLocationHistoryExpiry(at: Date) {
  return new Date(
    at.getTime() +
      LOCATION_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
}
