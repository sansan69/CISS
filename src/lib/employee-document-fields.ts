/**
 * Employee documents have been written by several enrollment/import flows over
 * time. Keep the aliases in one place so every profile surface can recognize
 * the same stored document instead of reporting it as missing.
 */

export type EmployeeDocumentFields = {
  profilePictureUrl?: string;
  signatureUrl?: string;
  identityProofType?: string;
  identityProofNumber?: string;
  identityProofUrlFront?: string;
  identityProofUrlBack?: string;
  addressProofType?: string;
  addressProofNumber?: string;
  addressProofUrlFront?: string;
  addressProofUrlBack?: string;
};

export function documentReference(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "url" in (value as Record<string, unknown>)) {
    const url = (value as Record<string, unknown>).url;
    if (typeof url === "string" && url.trim()) return url.trim();
  }
  return undefined;
}

function firstDocumentReference(...values: unknown[]): string | undefined {
  for (const value of values) {
    const reference = documentReference(value);
    if (reference) return reference;
  }
  return undefined;
}

function firstStringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = stringValue(value);
    if (normalized) return normalized;
  }
  return undefined;
}

export function normalizeEmployeeDocumentFields(
  data: Record<string, unknown>,
): EmployeeDocumentFields {
  return {
    profilePictureUrl: firstDocumentReference(
      data.profilePictureUrl,
      data.profilePhotoUrl,
      data.profilePhoto,
    ),
    signatureUrl: firstDocumentReference(
      data.signatureUrl,
      data.signature,
      data.signatureDocumentUrl,
    ),
    identityProofType: firstStringValue(data.identityProofType, data.idProofType),
    identityProofNumber: firstStringValue(data.identityProofNumber, data.idProofNumber),
    identityProofUrlFront: firstDocumentReference(
      data.identityProofUrlFront,
      data.idProofFrontUrl,
      data.idProofFront,
      data.idProofDocumentUrlFront,
      data.idProofDocumentUrl,
      data.identityProofDocumentUrlFront,
    ),
    identityProofUrlBack: firstDocumentReference(
      data.identityProofUrlBack,
      data.idProofBackUrl,
      data.idProofBack,
      data.idProofDocumentUrlBack,
      data.identityProofDocumentUrlBack,
    ),
    addressProofType: firstStringValue(
      data.addressProofType,
      data.addressProofTypeLegacy,
    ),
    addressProofNumber: firstStringValue(
      data.addressProofNumber,
      data.addressProofNumberLegacy,
    ),
    addressProofUrlFront: firstDocumentReference(
      data.addressProofUrlFront,
      data.addressProofFrontUrl,
      data.addressProofFront,
      data.addressProofDocumentUrlFront,
    ),
    addressProofUrlBack: firstDocumentReference(
      data.addressProofUrlBack,
      data.addressProofBackUrl,
      data.addressProofBack,
      data.addressProofDocumentUrlBack,
    ),
  };
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
