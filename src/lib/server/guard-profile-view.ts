import { normalizeText } from "@/lib/server/mobile-api-utils";
import { resolveEmployeeDistrict } from "@/lib/employees/visibility";
import { canonicalizeDistrictList } from "@/lib/districts";
import { employeeMatchesAnyDistrict } from "@/lib/employees/visibility";
import {
  hasAdminAccess,
  hasClientAccess,
  hasFieldOfficerAccess,
  type AppDecodedToken,
} from "@/lib/server/auth";
import { matchesClientScope, resolveClientScope } from "@/lib/server/client-access";

type TimestampLike = { toDate?: () => Date };

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && typeof (value as TimestampLike).toDate === "function") {
    return (value as TimestampLike).toDate!().toISOString();
  }
  return null;
}

function documentUrl(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "url" in (value as Record<string, unknown>)) {
    const url = (value as Record<string, unknown>).url;
    return typeof url === "string" && url.trim() ? url.trim() : null;
  }
  return null;
}

function completionStatus(value: unknown, fallback: boolean): "missing" | "complete" {
  return value === "complete" || (value === undefined && fallback) ? "complete" : "missing";
}

/**
 * Shape exposed to field officers and client users. Keep this allowlist
 * deliberately free of Aadhaar, bank, payroll and internal authentication
 * fields. Identity/address proof metadata is included because the client
 * workflow is intended to review those documents. The original storage URLs
 * are deliberately omitted; viewers use the scoped streaming endpoint.
 */
export function serializeGuardProfileView(
  docId: string,
  data: Record<string, unknown>,
) {
  const fullName = normalizeText(
    data.fullName || data.name || [data.firstName, data.lastName].filter(Boolean).join(" "),
  ) || "Guard";
  const firstName = normalizeText(data.firstName) || fullName.split(/\s+/)[0] || "Guard";
  const lastName = normalizeText(data.lastName) || fullName.split(/\s+/).slice(1).join(" ");
  const identityFront = documentUrl(
    data.identityProofUrlFront ?? data.idProofDocumentUrlFront ?? data.idProofDocumentUrl,
  );
  const identityBack = documentUrl(data.identityProofUrlBack ?? data.idProofDocumentUrlBack);
  const addressFront = documentUrl(data.addressProofUrlFront ?? data.addressProofFrontUrl);
  const addressBack = documentUrl(data.addressProofUrlBack ?? data.addressProofBackUrl);
  const completion = (data.documentCompletion || {}) as Record<string, unknown>;

  return {
    id: docId,
    employeeId: normalizeText(data.employeeId || data.employeeCode || data.guardId || docId),
    employeeCode: normalizeText(data.employeeCode || data.guardId || data.employeeId),
    firstName,
    lastName,
    fullName,
    dateOfBirth: serializeDate(data.dateOfBirth),
    gender: normalizeText(data.gender),
    fatherName: normalizeText(data.fatherName),
    motherName: normalizeText(data.motherName),
    maritalStatus: normalizeText(data.maritalStatus),
    spouseName: normalizeText(data.spouseName),
    educationalQualification: normalizeText(data.educationalQualification),
    otherQualification: normalizeText(data.otherQualification),
    nationality: normalizeText(data.nationality),
    identificationMark: normalizeText(data.identificationMark),
    heightCm: typeof data.heightCm === "number" ? data.heightCm : null,
    weightKg: typeof data.weightKg === "number" ? data.weightKg : null,
    clientName: normalizeText(data.clientName),
    resourceIdNumber: normalizeText(data.resourceIdNumber),
    jobDesignation: normalizeText(data.jobDesignation || data.lngJobDesignation),
    district: resolveEmployeeDistrict(data),
    joiningDate: serializeDate(data.joiningDate),
    exitDate: serializeDate(data.exitDate),
    status: normalizeText(data.status || "Active") || "Active",
    phoneNumber: normalizeText(data.phoneNumber || data.mobileNumber || data.phone),
    emailAddress: normalizeText(data.emailAddress || data.email),
    fullAddress: normalizeText(data.fullAddress || data.address),
    address: normalizeText(data.fullAddress || data.address),
    siteName: normalizeText(data.siteName || data.assignedSiteName),
    profilePictureUrl: documentUrl(data.profilePictureUrl ?? data.profilePhotoUrl),
    qrCodeUrl: documentUrl(data.qrCodeUrl),
    identityProofType: normalizeText(data.identityProofType || data.idProofType),
    identityProofNumber: normalizeText(data.identityProofNumber || data.idProofNumber),
    addressProofType: normalizeText(data.addressProofType),
    addressProofNumber: normalizeText(data.addressProofNumber),
    documentAvailability: {
      identityFront: Boolean(identityFront),
      identityBack: Boolean(identityBack),
      addressFront: Boolean(addressFront),
      addressBack: Boolean(addressBack),
    },
    documentCompletion: {
      identity: completionStatus(completion.identity, Boolean(identityFront)),
      address: completionStatus(completion.address, Boolean(addressFront)),
      signature: completionStatus(completion.signature, Boolean(data.signatureUrl ?? data.signature)),
    },
    enrollmentPolicy: {
      version: (data.enrollmentPolicy as Record<string, unknown> | undefined)?.version === "three-proof-v1"
        ? "three-proof-v1"
        : "legacy",
    },
  };
}

export type GuardProfileView = ReturnType<typeof serializeGuardProfileView>;

export async function assertGuardProfileScope(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
  employee: Record<string, unknown>,
) {
  if (hasAdminAccess(decoded) || ["hr", "accounts", "compliance"].includes(decoded.role || "")) {
    return;
  }

  if (hasFieldOfficerAccess(decoded)) {
    const snapshot = await adminDb
      .collection("fieldOfficers")
      .where("uid", "==", decoded.uid)
      .limit(1)
      .get();
    const stored = snapshot.empty ? undefined : snapshot.docs[0]?.data()?.assignedDistricts;
    const source = Array.isArray(stored) ? stored : decoded.assignedDistricts;
    const districts = canonicalizeDistrictList(
      Array.isArray(source)
        ? source.filter((district): district is string => typeof district === "string")
        : [],
    );
    if (districts.length > 0 && employeeMatchesAnyDistrict(employee, districts)) return;
    throw new Error("This guard is outside your assigned districts.");
  }

  if (hasClientAccess(decoded)) {
    const scope = await resolveClientScope(adminDb, decoded);
    if (scope && matchesClientScope(employee, scope)) return;
    throw new Error("This guard is outside your client scope.");
  }

  throw new Error("Guard profile access required.");
}
