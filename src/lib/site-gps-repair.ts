import type { CoordinateStatus } from "@/types/location";

export type SiteGpsState = "missing_coords" | "invalid_coords" | "missing_status" | "ok";

type CoordinateInput = {
  coordinateStatus?: CoordinateStatus | string | null;
  geolocation?: {
    latitude?: number | null;
    longitude?: number | null;
    lat?: number | null;
    lng?: number | null;
    _latitude?: number | null;
    _longitude?: number | null;
  } | null;
  latString?: string | number | null;
  lngString?: string | number | null;
};

const INDIA_BOUNDS = {
  latMin: 6,
  latMax: 37,
  lngMin: 68,
  lngMax: 98,
} as const;

const GPS_READY_STATUSES = new Set<CoordinateStatus>(["geocoded", "verified", "overridden"]);

const STATE_NORMALIZATION_MAP: Record<string, string> = {
  "tamil nadu": "Tamil Nadu",
  "tamilnadu": "Tamil Nadu",
  "tamill nadu": "Tamil Nadu",
  "tamilnadu state": "Tamil Nadu",
  "pondicherry": "Puducherry",
  "orissa": "Odisha",
};

function readCoordinatePart(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeCoordinateStatus(status?: string | null) {
  const normalized = status?.trim() as CoordinateStatus | undefined;
  return normalized && GPS_READY_STATUSES.has(normalized) ? normalized : null;
}

export function extractSiteCoordinates(input: CoordinateInput) {
  const lat =
    readCoordinatePart(input?.geolocation?.latitude) ??
    readCoordinatePart(input?.geolocation?.lat) ??
    readCoordinatePart(input?.geolocation?._latitude) ??
    readCoordinatePart(input?.latString);
  const lng =
    readCoordinatePart(input?.geolocation?.longitude) ??
    readCoordinatePart(input?.geolocation?.lng) ??
    readCoordinatePart(input?.geolocation?._longitude) ??
    readCoordinatePart(input?.lngString);

  if (lat == null || lng == null) return null;
  return { lat, lng };
}

export function isWithinIndiaBounds(lat: number, lng: number) {
  return (
    lat >= INDIA_BOUNDS.latMin &&
    lat <= INDIA_BOUNDS.latMax &&
    lng >= INDIA_BOUNDS.lngMin &&
    lng <= INDIA_BOUNDS.lngMax
  );
}

export function normalizeIndianStateName(state?: string | null) {
  const trimmed = state?.trim();
  if (!trimmed) return undefined;

  const collapsed = trimmed.replace(/\s+/g, " ").toLowerCase();
  return STATE_NORMALIZATION_MAP[collapsed] ?? trimmed;
}

export function classifySiteGpsState(input: CoordinateInput): SiteGpsState {
  const coordinates = extractSiteCoordinates(input);
  if (!coordinates) return "missing_coords";
  if (!isWithinIndiaBounds(coordinates.lat, coordinates.lng)) return "invalid_coords";
  if (!normalizeCoordinateStatus(input.coordinateStatus)) return "missing_status";
  return "ok";
}

export function hasUsableSiteGps(input: CoordinateInput) {
  return classifySiteGpsState(input) === "ok";
}
