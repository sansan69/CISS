export type AppMode = "control-plane" | "regional";

const publicAppMode = process.env.NEXT_PUBLIC_APP_MODE?.trim();
const privateAppMode = process.env.APP_MODE?.trim();
export const APP_MODE: AppMode =
  (publicAppMode || privateAppMode) === "control-plane" ? "control-plane" : "regional";

export const REGION_CODE =
  (
    process.env.NEXT_PUBLIC_REGION_CODE?.trim() ||
    process.env.REGION_CODE?.trim() ||
    "KL"
  ).toUpperCase();

export const REGION_NAME =
  process.env.NEXT_PUBLIC_REGION_NAME?.trim() ||
  process.env.REGION_NAME?.trim() ||
  "Kerala";

// In control-plane mode, require REGION_CODE and REGION_NAME to be set explicitly
if (isControlPlaneMode()) {
  const hasRegionCode = process.env.NEXT_PUBLIC_REGION_CODE?.trim() || process.env.REGION_CODE?.trim();
  const hasRegionName = process.env.NEXT_PUBLIC_REGION_NAME?.trim() || process.env.REGION_NAME?.trim();
  if (!hasRegionCode) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "REGION_CODE is required in control-plane mode. Set NEXT_PUBLIC_REGION_CODE or REGION_CODE.",
      );
    }
    console.warn("REGION_CODE not set in control-plane mode — defaulting to KL");
  }
  if (!hasRegionName) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "REGION_NAME is required in control-plane mode. Set NEXT_PUBLIC_REGION_NAME or REGION_NAME.",
      );
    }
    console.warn("REGION_NAME not set in control-plane mode — defaulting to Kerala");
  }
}

export const GUARD_AUTH_EMAIL_DOMAIN =
  process.env.GUARD_AUTH_EMAIL_DOMAIN?.trim() ||
  (REGION_CODE === "KL"
    ? "guard.cisskerala.app"
    : `guard.${REGION_CODE.toLowerCase()}.ciss-regional.app`);

export function isControlPlaneMode() {
  return APP_MODE === "control-plane";
}

export function isRegionalMode() {
  return APP_MODE === "regional";
}
