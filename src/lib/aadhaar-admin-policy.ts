export const AADHAAR_ADMIN_EMAIL = "admin@cisskerala.app";

type AadhaarAdministratorIdentity = {
  email?: string | null;
  emailVerified?: boolean;
  role?: string | null;
  admin?: boolean;
};

/**
 * Client-side checks improve navigation and messaging only. The API repeats
 * this policy against a verified Firebase token before accepting Aadhaar data.
 */
export function isDesignatedAadhaarAdministrator(
  identity: AadhaarAdministratorIdentity,
) {
  return (
    identity.email?.trim().toLowerCase() === AADHAAR_ADMIN_EMAIL &&
    identity.emailVerified === true &&
    (identity.admin === true || identity.role === "admin")
  );
}
