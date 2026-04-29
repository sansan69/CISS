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

const coordinateStatusValues = new Set<CoordinateStatus>([
  "missing",
  "geocoded",
  "verified",
  "overridden",
]);

function normalizeCoordinateStatus(value?: CoordinateStatus | string | null) {
  return typeof value === "string" && coordinateStatusValues.has(value as CoordinateStatus)
    ? (value as CoordinateStatus)
    : "missing";
}

const coordinateSourceValues = new Set<CoordinateSource>([
  "manual",
  "geocode",
  "map_pin",
  "current_location",
]);

function normalizeCoordinateSource(value?: CoordinateSource | string | null) {
  return typeof value === "string" && coordinateSourceValues.has(value as CoordinateSource)
    ? (value as CoordinateSource)
    : undefined;
}

type SyncableLocationGeoPoint =
  | {
      latitude?: number;
      longitude?: number;
      lat?: number;
      lng?: number;
      _latitude?: number;
      _longitude?: number;
    }
  | null
  | undefined;

export type SiteLocationSyncPatch = {
  siteAddress: string;
  district: string;
  geolocation?: GeoPointLike;
  latString: string;
  lngString: string;
  coordinateStatus: CoordinateStatus;
  coordinateSource?: CoordinateSource;
  placeAccuracy: string | null;
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

export function buildSiteLocationSyncPatch(location?: {
  address?: string | null;
  district?: string | null;
  geolocation?: SyncableLocationGeoPoint;
  latString?: string | null;
  lngString?: string | null;
  coordinateStatus?: CoordinateStatus | string | null;
  coordinateSource?: CoordinateSource | string | null;
  placeAccuracy?: string | null;
} | null | undefined): SiteLocationSyncPatch {
  if (!location) {
    return {
      siteAddress: "",
      district: "",
      geolocation: undefined,
      latString: "",
      lngString: "",
      coordinateStatus: "missing" as CoordinateStatus,
      coordinateSource: undefined,
      placeAccuracy: null,
    };
  }

  const latitude =
    typeof location.geolocation?.latitude === "number"
      ? location.geolocation.latitude
      : typeof location.geolocation?.lat === "number"
        ? location.geolocation.lat
        : typeof location.geolocation?._latitude === "number"
          ? location.geolocation._latitude
          : undefined;
  const longitude =
    typeof location.geolocation?.longitude === "number"
      ? location.geolocation.longitude
      : typeof location.geolocation?.lng === "number"
        ? location.geolocation.lng
        : typeof location.geolocation?._longitude === "number"
          ? location.geolocation._longitude
          : undefined;

  return {
    siteAddress: typeof location.address === "string" ? location.address : "",
    district: typeof location.district === "string" ? location.district : "",
    geolocation:
      typeof latitude === "number" && typeof longitude === "number"
        ? { latitude, longitude }
        : undefined,
    latString: typeof location.latString === "string" ? location.latString : "",
    lngString: typeof location.lngString === "string" ? location.lngString : "",
    coordinateStatus: normalizeCoordinateStatus(location.coordinateStatus),
    coordinateSource: normalizeCoordinateSource(location.coordinateSource),
    placeAccuracy: location.placeAccuracy ?? null,
  };
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
