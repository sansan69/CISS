export type AppMode = "control-plane" | "regional";

export const APP_MODE: AppMode =
  process.env.APP_MODE === "control-plane" ? "control-plane" : "regional";

export const REGION_CODE =
  process.env.REGION_CODE?.trim().toUpperCase() || "KL";

export const REGION_NAME =
  process.env.REGION_NAME?.trim() || "Kerala";

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
