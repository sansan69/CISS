import type {
  CoordinateSource,
  CoordinateStatus,
  GeoPointLike,
} from "@/types/location";

export const coordinateStatusLabels: Record<CoordinateStatus, string> = {
  missing: "Missing",
  geocoded: "Geocoded",
  verified: "Verified",
  overridden: "Manually overridden",
};

export const coordinateSourceLabels: Record<CoordinateSource, string> = {
  manual: "Manual",
  geocode: "Geocoded",
  map_pin: "Map pin",
  current_location: "Current location",
};

export function formatCoordinate(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

export function hasValidCoordinates(geolocation?: GeoPointLike | null) {
  const lat = geolocation?.latitude;
  const lng = geolocation?.longitude;
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

export function deriveCoordinateStatus(input: {
  geolocation?: GeoPointLike | null;
  coordinateStatus?: CoordinateStatus | null;
}): CoordinateStatus {
  if (input.coordinateStatus) return input.coordinateStatus;
  return hasValidCoordinates(input.geolocation) ? "verified" : "missing";
}

export function deriveCoordinateSource(input: {
  geolocation?: GeoPointLike | null;
  coordinateSource?: CoordinateSource | null;
}): CoordinateSource | undefined {
  if (input.coordinateSource) return input.coordinateSource;
  return hasValidCoordinates(input.geolocation) ? "manual" : undefined;
}

export function parseGeoString(value: string) {
  const [latText, lngText] = value.split(",").map((part) => part.trim());
  const lat = Number.parseFloat(latText);
  const lng = Number.parseFloat(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function buildLocationIdentity(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => (part ?? "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("::");
}

export function buildGoogleMapsLink(
  latitude?: number | null,
  longitude?: number | null,
  label?: string,
) {
  if (typeof latitude !== "number" || typeof longitude !== "number") return "";
  const query = label?.trim()
    ? `${latitude},${longitude} (${label})`
    : `${latitude},${longitude}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function buildOsmEmbedUrl(latitude?: number | null, longitude?: number | null) {
  if (typeof latitude !== "number" || typeof longitude !== "number") return "";
  const offset = 0.01;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${longitude - offset}%2C${latitude - offset}%2C${longitude + offset}%2C${latitude + offset}&layer=mapnik&marker=${latitude}%2C${longitude}`;
}
