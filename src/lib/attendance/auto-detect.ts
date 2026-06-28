/**
 * Auto-detect attendance parameters to reduce user choices.
 * Uses GPS position, time of day, and last attendance state
 * to pre-fill everything — site, shift, IN/OUT status.
 */

export type AutoDetectSite = {
  id: string;
  siteName: string;
  clientName: string;
  district: string;
  lat: number;
  lng: number;
  geofenceRadiusMeters?: number;
  strictGeofence?: boolean;
  shiftTemplates?: Array<{
    code: string;
    label: string;
    startTime: string;
    endTime: string;
    crossesMidnight?: boolean;
  }>;
};

export type AttendanceHint = {
  lastStatus?: "In" | "Out" | null;
  lastAttendanceDate?: string | null;
  lastShiftCode?: string | null;
};

/**
 * Find the nearest site within geofence radius from current GPS position.
 * Returns null if no site is within range.
 */
export function findNearestSite(
  sites: AutoDetectSite[],
  lat: number,
  lng: number,
): AutoDetectSite | null {
  let best: AutoDetectSite | null = null;
  let bestDist = Infinity;

  for (const site of sites) {
    if (!site.lat || !site.lng) continue;
    const dist = haversineDistance(lat, lng, site.lat, site.lng);
    const radius = site.geofenceRadiusMeters || 150;
    if (dist <= radius && dist < bestDist) {
      bestDist = dist;
      best = site;
    }
  }

  return best;
}

/**
 * Haversine distance between two GPS coordinates in meters.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Auto-detect the shift by matching current time against shift templates.
 * Returns the best-matching shift, or null if no templates.
 */
export function detectShift(
  shiftTemplates: AutoDetectSite["shiftTemplates"],
  now: Date,
  lastShiftCode?: string | null,
): {
  code: string;
  label: string;
  startTime: string;
  endTime: string;
} | null {
  if (!shiftTemplates?.length) return null;

  const punchMinutes = now.getHours() * 60 + now.getMinutes();

  let best: (typeof shiftTemplates)[0] | null = null;
  let bestScore = Infinity;

  for (const shift of shiftTemplates) {
    const [sh, sm] = shift.startTime.split(":").map(Number);
    const [eh, em] = shift.endTime.split(":").map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;

    const forwardDistance = (start - punchMinutes + 1440) % 1440;
    const timeInShift = (punchMinutes - start + 1440) % 1440;
    const duration = end >= start ? end - start : 1440 - start + end;

    let score: number;
    if (forwardDistance <= 120) {
      // Within 2 hours before shift start — early arrival
      score = forwardDistance;
    } else if (timeInShift <= 60) {
      // Within 1 hour after shift start — on time
      score = timeInShift + 0.5;
    } else if (timeInShift < duration) {
      // Well into the shift
      score = timeInShift + 120;
    } else {
      continue;
    }

    if (score < bestScore) {
      bestScore = score;
      best = shift;
    }
  }

  return best;
}

/**
 * Auto-detect IN vs OUT based on last attendance status.
 * If last was IN → OUT (guard is checking out).
 * If last was OUT or unknown → IN (guard is checking in).
 */
export function detectInOrOut(hint: AttendanceHint | null): "In" | "Out" {
  if (hint?.lastStatus === "In") return "Out";
  return "In";
}

/**
 * Determine whether a shift crosses midnight based on start/end times.
 */
export function shiftCrossesMidnight(
  startTime: string,
  endTime: string,
): boolean {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return sh * 60 + sm >= eh * 60 + em;
}
