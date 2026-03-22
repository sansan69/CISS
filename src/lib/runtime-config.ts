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
