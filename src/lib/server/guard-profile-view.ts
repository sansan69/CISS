import { normalizeText } from "@/lib/server/mobile-api-utils";
import { resolveEmployeeDistrict } from "@/lib/employees/visibility";
import { canonicalizeDistrictList } from "@/lib/districts";
import { employeeMatchesAnyDistrict } from "@/lib/employees/visibility";
import { documentReference, normalizeEmployeeDocumentFields } from "@/lib/employee-document-fields";
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
  const documentFields = normalizeEmployeeDocumentFields(data);
  const identityFront = documentFields.identityProofUrlFront;
  const identityBack = documentFields.identityProofUrlBack;
  const addressFront = documentFields.addressProofUrlFront;
  const addressBack = documentFields.addressProofUrlBack;
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
    profilePictureUrl: documentFields.profilePictureUrl,
    qrCodeUrl: documentReference(data.qrCodeUrl) ?? null,
    identityProofType: normalizeText(documentFields.identityProofType),
    identityProofNumber: normalizeText(documentFields.identityProofNumber),
    addressProofType: normalizeText(documentFields.addressProofType),
    addressProofNumber: normalizeText(documentFields.addressProofNumber),
    documentAvailability: {
      identityFront: Boolean(identityFront),
      identityBack: Boolean(identityBack),
      addressFront: Boolean(addressFront),
      addressBack: Boolean(addressBack),
    },
    documentCompletion: {
      identity: completionStatus(completion.identity, Boolean(identityFront)),
      address: completionStatus(completion.address, Boolean(addressFront)),
      signature: completionStatus(completion.signature, Boolean(documentFields.signatureUrl)),
    },
    enrollmentPolicy: {
      version: (data.enrollmentPolicy as Record<string, unknown> | undefined)?.version === "three-proof-v1"
        ? "three-proof-v1"
        : "legacy",
    },
  };
}

export type GuardProfileView = ReturnType<typeof serializeGuardProfileView>;

/**
 * Field officers need the enrollment and deployment record for guards they
 * supervise. Aadhaar remains deliberately excluded because it is managed by
 * the separate encrypted, consent-controlled Aadhaar workflow.
 */
export function serializeFieldOfficerGuardProfileView(
  docId: string,
  data: Record<string, unknown>,
) {
  const profile = serializeGuardProfileView(docId, data);
  const documents = normalizeEmployeeDocumentFields(data);

  return {
    ...profile,
    regionCode: normalizeText(data.regionCode),
    regionName: normalizeText(data.regionName),
    department: normalizeText(data.department),
    panNumber: normalizeText(data.panNumber),
    serviceBookNumber: normalizeText(data.serviceBookNumber),
    armsLicenseNumber: normalizeText(data.armsLicenseNumber),
    passportCountryName: normalizeText(data.passportCountryName),
    legacyUniqueId: normalizeText(data.legacyUniqueId),
    epfUanNumber: normalizeText(data.epfUanNumber),
    esicNumber: normalizeText(data.esicNumber),
    bankName: normalizeText(data.bankName),
    bankAccountNumber: normalizeText(data.bankAccountNumber),
    ifscCode: normalizeText(data.ifscCode),
    branchName: normalizeText(data.branchName),
    documentAvailability: {
      ...profile.documentAvailability,
      profilePicture: Boolean(documents.profilePictureUrl),
      signature: Boolean(documents.signatureUrl),
      bank: Boolean(documents.bankPassbookStatementUrl),
      panCard: Boolean(documents.panCardDocumentUrl),
      serviceBook: Boolean(documents.serviceBookDocumentUrl),
      armsLicense: Boolean(documents.armsLicenseDocumentUrl),
      passport: Boolean(documents.passportDocumentUrl),
      policeClearance: Boolean(documents.policeClearanceCertificateUrl),
    },
  };
}

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
