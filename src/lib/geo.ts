export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface LocationValidationResult {
  isValid: boolean;
  accuracyMeters: number;
  isMockLocationSuspected: boolean;
  isHighAccuracyRequired: boolean;
  warnings: string[];
}

const GPS_ACCURACY_LIMIT_METERS = 150;

export async function validateLocation(
  coords: GeolocationCoordinates,
  siteGeofenceRadiusMeters?: number,
  strictGeofence?: boolean
): Promise<LocationValidationResult> {
  const warnings: string[] = [];
  let isMockLocationSuspected = false;

  const isHighAccuracyRequired = strictGeofence === true;
  const accuracyLimit = isHighAccuracyRequired 
    ? GPS_ACCURACY_LIMIT_METERS 
    : GPS_ACCURACY_LIMIT_METERS * 2;
  
  if (coords.accuracy > accuracyLimit) {
    warnings.push(`GPS accuracy is ${coords.accuracy.toFixed(0)}m (limit: ${accuracyLimit}m)`);
  }

  if (typeof window !== 'undefined') {
    const isMock = await detectMockLocation();
    if (isMock) {
      isMockLocationSuspected = true;
      warnings.push("Mock location detected");
    }
  }

  return {
    isValid: warnings.length === 0 && !isMockLocationSuspected,
    accuracyMeters: coords.accuracy,
    isMockLocationSuspected,
    isHighAccuracyRequired,
    warnings,
  };
}

async function detectMockLocation(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  
  if ((navigator as any).webdriver === true) {
    return true;
  }

  const ua = navigator.userAgent.toLowerCase();
  const emulators = ['genymotion', 'bluestacks', 'nox', 'm emulator'];
  if (emulators.some(e => ua.includes(e))) {
    return true;
  }

  return false;
}
