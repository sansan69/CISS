/**
 * Fields required for every new enrollment. This module is intentionally
 * browser-safe because the public enrollment form imports the policy.
 */
export const MANDATORY_NEW_ENROLLMENT_FIELDS = [
  "identityProofType",
  "identityProofNumber",
  "identityProofUrlFront",
  "identityProofUrlBack",
  "addressProofType",
  "addressProofNumber",
  "addressProofUrlFront",
  "addressProofUrlBack",
  "aadharNumber",
  "aadharCardDocument",
  "signatureUrl",
  "termsAndConditions",
  "aadhaarConsentAccepted",
] as const;
