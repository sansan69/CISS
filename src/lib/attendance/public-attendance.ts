type FirestoreGeoPointLike = {
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
};

export type PublicAttendanceSiteOption = {
  id: string;
  siteName: string;
  clientName: string;
  clientId: string;
  district: string;
  geofenceRadiusMeters: number;
  strictGeofence: boolean;
  shiftMode: string;
  shiftPattern: string | null;
  shiftTemplates: unknown[];
  sourceCollection: "sites" | "clientLocations";
  lat?: number;
  lng?: number;
};

export type PublicAttendanceEmployee = {
  id: string;
  employeeCode?: string;
  fullName: string;
  phoneNumber?: string;
  clientName?: string;
};

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function parsePublicAttendanceCoordinates(data: Record<string, unknown>) {
  const geolocation = data.geolocation as FirestoreGeoPointLike | undefined;

  const lat =
    toFiniteNumber(geolocation?.latitude) ??
    toFiniteNumber(geolocation?.lat) ??
    toFiniteNumber(data.lat) ??
    toFiniteNumber(data.latString);

  const lng =
    toFiniteNumber(geolocation?.longitude) ??
    toFiniteNumber(geolocation?.lng) ??
    toFiniteNumber(data.lng) ??
    toFiniteNumber(data.lngString);

  if (lat === undefined || lng === undefined) {
    return undefined;
  }

  return { lat, lng };
}

export function buildPublicAttendanceSiteOption(
  id: string,
  data: Record<string, unknown>,
  sourceCollection: "sites" | "clientLocations",
): PublicAttendanceSiteOption {
  const coords = parsePublicAttendanceCoordinates(data);

  return {
    id,
    siteName:
      (typeof data.siteName === "string" && data.siteName) ||
      (typeof data.locationName === "string" && data.locationName) ||
      (typeof data.name === "string" && data.name) ||
      "",
    clientName: typeof data.clientName === "string" ? data.clientName : "",
    clientId: typeof data.clientId === "string" ? data.clientId : "",
    district: typeof data.district === "string" ? data.district : "",
    geofenceRadiusMeters: toFiniteNumber(data.geofenceRadiusMeters) ?? 150,
    strictGeofence: data.strictGeofence === true,
    shiftMode: typeof data.shiftMode === "string" ? data.shiftMode : "none",
    shiftPattern: typeof data.shiftPattern === "string" ? data.shiftPattern : null,
    shiftTemplates: Array.isArray(data.shiftTemplates) ? data.shiftTemplates : [],
    sourceCollection,
    ...(coords ?? {}),
  };
}

export function buildPublicAttendanceEmployee(
  id: string,
  data: Record<string, unknown>,
): PublicAttendanceEmployee {
  return {
    id,
    employeeCode:
      typeof data.employeeId === "string" && data.employeeId ? data.employeeId : undefined,
    fullName:
      (typeof data.fullName === "string" && data.fullName) ||
      (typeof data.name === "string" && data.name) ||
      [
        typeof data.firstName === "string" ? data.firstName : "",
        typeof data.lastName === "string" ? data.lastName : "",
      ]
        .join(" ")
        .trim(),
    phoneNumber:
      typeof data.phoneNumber === "string" && data.phoneNumber
        ? data.phoneNumber
        : undefined,
    clientName:
      typeof data.clientName === "string" && data.clientName
        ? data.clientName
        : undefined,
  };
}
