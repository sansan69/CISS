import type { Firestore } from "firebase-admin/firestore";

import type {
  EnrollmentFormConfig,
  EnrollmentFormFieldConfig,
  EnrollmentFormSectionConfig,
} from "@/types/region";
import { DEFAULT_ENROLLMENT_FORM_CONFIG } from "@/lib/region-wizard";
import { MANDATORY_NEW_ENROLLMENT_FIELDS } from "@/lib/enrollment-policy";
import { getEnabledFields } from "@/lib/enrollment-config-client";

export { MANDATORY_NEW_ENROLLMENT_FIELDS } from "@/lib/enrollment-policy";
export { getEnabledFields } from "@/lib/enrollment-config-client";

function isFieldConfig(value: unknown): value is EnrollmentFormFieldConfig {
  if (!value || typeof value !== "object") return false;
  const field = value as Record<string, unknown>;
  return (
    typeof field.key === "string" &&
    typeof field.label === "string" &&
    typeof field.enabled === "boolean" &&
    typeof field.required === "boolean" &&
    typeof field.order === "number" &&
    Number.isFinite(field.order)
  );
}

function isSectionConfig(value: unknown): value is EnrollmentFormSectionConfig {
  if (!value || typeof value !== "object") return false;
  const section = value as Record<string, unknown>;
  return typeof section.label === "string" && Array.isArray(section.fields) && section.fields.every(isFieldConfig);
}

function cloneField(field: EnrollmentFormFieldConfig): EnrollmentFormFieldConfig {
  return { ...field };
}

/**
 * Merges older Firestore configuration documents with the current field
 * catalogue. This keeps newly introduced mandatory fields visible even when
 * an installation saved an older configuration before those fields existed.
 */
export function normalizeEnrollmentFormConfig(value: unknown): EnrollmentFormConfig {
  const stored = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const storedSections = stored.sections && typeof stored.sections === "object"
    ? stored.sections as Record<string, unknown>
    : {};
  const sections: Record<string, EnrollmentFormSectionConfig> = {};

  for (const [sectionKey, defaultSection] of Object.entries(DEFAULT_ENROLLMENT_FORM_CONFIG.sections)) {
    const candidate = storedSections[sectionKey];
    const storedSection = isSectionConfig(candidate) ? candidate : undefined;
    const fields = storedSection ? storedSection.fields.map(cloneField) : [];
    const knownKeys = new Set(fields.map((field) => field.key));
    for (const field of defaultSection.fields) {
      if (!knownKeys.has(field.key)) fields.push(cloneField(field));
    }
    sections[sectionKey] = {
      label: storedSection?.label || defaultSection.label,
      fields,
    };
  }

  // Preserve valid custom sections configured by an administrator.
  for (const [sectionKey, candidate] of Object.entries(storedSections)) {
    if (sections[sectionKey] || !isSectionConfig(candidate)) continue;
    sections[sectionKey] = {
      label: candidate.label,
      fields: candidate.fields.map(cloneField),
    };
  }

  // Aadhaar number belongs with the restricted Aadhaar upload controls. Older
  // configurations placed it under general details, which made the public
  // step tracker and the actual form disagree.
  for (const [sectionKey, section] of Object.entries(sections)) {
    if (sectionKey === "documents") continue;
    section.fields = section.fields.filter((field) => field.key !== "aadharNumber");
  }

  const mandatory = new Set<string>(MANDATORY_NEW_ENROLLMENT_FIELDS);
  for (const section of Object.values(sections)) {
    for (const field of section.fields) {
      if (mandatory.has(field.key)) {
        field.enabled = true;
        field.required = true;
      }
    }
  }

  const storedOverrides = stored.clientOverrides && typeof stored.clientOverrides === "object"
    ? stored.clientOverrides as NonNullable<EnrollmentFormConfig["clientOverrides"]>
    : {};
  const defaultOverrides = DEFAULT_ENROLLMENT_FORM_CONFIG.clientOverrides || {};
  const clientOverrides: NonNullable<EnrollmentFormConfig["clientOverrides"]> = {};
  for (const clientName of new Set([...Object.keys(defaultOverrides), ...Object.keys(storedOverrides)])) {
    const defaultClient = defaultOverrides[clientName] || {};
    const storedClient = storedOverrides[clientName] || {};
    clientOverrides[clientName] = {};
    for (const sectionName of new Set([...Object.keys(defaultClient), ...Object.keys(storedClient)])) {
      clientOverrides[clientName]![sectionName] = {
        ...(defaultClient[sectionName] || {}),
        ...(storedClient[sectionName] || {}),
      };
    }
  }
  return Object.keys(clientOverrides).length ? { sections, clientOverrides } : { sections };
}

export async function fetchEnrollmentConfig(adminDb?: Firestore): Promise<EnrollmentFormConfig> {
  if (!adminDb) {
    try {
      const { getApp } = await import("firebase-admin/app");
      const admin = await import("firebase-admin/firestore");
      adminDb = admin.getFirestore(getApp());
    } catch {
      return DEFAULT_ENROLLMENT_FORM_CONFIG;
    }
  }

  try {
    const snap = await adminDb.collection("enrollmentFormConfig").doc("global").get();
    if (snap.exists) {
      return normalizeEnrollmentFormConfig(snap.data());
    }
    return normalizeEnrollmentFormConfig(DEFAULT_ENROLLMENT_FORM_CONFIG);
  } catch {
    return normalizeEnrollmentFormConfig(DEFAULT_ENROLLMENT_FORM_CONFIG);
  }
}

export function getEnabledSections(
  config: EnrollmentFormConfig,
): Array<{ key: string; label: string; fields: EnrollmentFormFieldConfig[] }> {
  return Object.entries(config.sections)
    .map(([key, section]) => ({
      key,
      label: section.label,
      fields: section.fields
        .filter((f) => f.enabled)
        .sort((a, b) => a.order - b.order),
    }))
    .filter((s) => s.fields.length > 0);
}

export function validateEnrollmentField(
  field: EnrollmentFormFieldConfig,
  value: unknown,
): string | null {
  if (!field.enabled) return null;
  if (field.required && (value === undefined || value === null || value === "")) {
    return `${field.label} is required`;
  }
  return null;
}

const SUBMISSION_FIELD_ALIASES: Record<string, string> = {
  termsAndConditions: "termsAccepted",
  guardUndertakingAccepted: "guardUndertakingAccepted",
  profilePicture: "profilePictureUrl",
  identityProofFront: "identityProofUrlFront",
  identityProofBack: "identityProofUrlBack",
  addressProofFront: "addressProofUrlFront",
  addressProofBack: "addressProofUrlBack",
  signature: "signatureUrl",
  bankPassbookStatement: "bankPassbookStatementUrl",
  serviceBookDocument: "serviceBookDocumentUrl",
  armsLicenseDocument: "armsLicenseDocumentUrl",
  passportDocument: "passportDocumentUrl",
  aadharCardDocument: "aadharCardDocumentUrl",
  aadharCardDocumentBack: "aadharCardDocumentBackUrl",
  panCardDocument: "panCardDocumentUrl",
  policeClearanceCertificate: "policeClearanceCertificateUrl",
  qualificationCertificate: "qualificationCertificateUrl",
};

function getSubmissionValue(payload: Record<string, unknown>, key: string) {
  return payload[key] ?? payload[SUBMISSION_FIELD_ALIASES[key]];
}

export function validateEnrollmentSubmissionAgainstConfig(
  config: EnrollmentFormConfig,
  payload: Record<string, unknown>,
  clientName?: string,
): string[] {
  const configuredFields = getEnabledFields(config, clientName);
  const mandatoryFields = MANDATORY_NEW_ENROLLMENT_FIELDS.map((key, index) => ({
    key,
    label:
      key === "aadharNumber"
        ? "Aadhaar number"
        : key === "profilePicture"
          ? "Profile picture"
          : key === "aadharCardDocument"
            ? "Aadhaar front copy"
            : key === "aadharCardDocumentBack"
              ? "Aadhaar back copy"
            : key === "bankPassbookStatement"
              ? "Bank passbook/statement"
              : key === "emailAddress"
                ? "Email address"
                : key === "aadhaarConsentAccepted"
                  ? "Aadhaar consent"
                  : key === "termsAndConditions"
                    ? "Terms and declaration"
                    : key === "guardUndertakingAccepted"
                      ? "Guard undertaking consent"
                    : key,
    enabled: true,
    required: true,
    order: Number.MAX_SAFE_INTEGER - MANDATORY_NEW_ENROLLMENT_FIELDS.length + index,
  }));
  const fields = [
    ...configuredFields.map((field) => {
      const mandatory = mandatoryFields.find((candidate) => candidate.key === field.key);
      return mandatory
        ? { ...field, enabled: true, required: true, label: mandatory.label }
        : field;
    }),
    ...mandatoryFields.filter(
      (mandatory) => !configuredFields.some((configured) => configured.key === mandatory.key),
    ),
  ];
  return fields
    .map((field) => validateEnrollmentField(field, getSubmissionValue(payload, field.key)))
    .filter((message): message is string => Boolean(message));
}

export function getDefaultEnrollmentConfig(): EnrollmentFormConfig {
  return normalizeEnrollmentFormConfig(DEFAULT_ENROLLMENT_FORM_CONFIG);
}
