import { isLngClientName, normalizeClientNameKey } from "@/lib/constants";

export const CLIENT_ENROLLMENT_PROFILES = ["standard", "tcs", "lng-petronet"] as const;
export type ClientEnrollmentProfile = (typeof CLIENT_ENROLLMENT_PROFILES)[number];

export function resolveClientEnrollmentProfile(
  storedProfile: unknown,
  clientName?: string | null,
): ClientEnrollmentProfile {
  if (CLIENT_ENROLLMENT_PROFILES.includes(storedProfile as ClientEnrollmentProfile)) {
    return storedProfile as ClientEnrollmentProfile;
  }
  if (isLngClientName(clientName)) return "lng-petronet";
  if (normalizeClientNameKey(clientName) === "tcs") return "tcs";
  return "standard";
}
