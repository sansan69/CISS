import type { Firestore } from "firebase-admin/firestore";

import type { EnrollmentFormConfig, EnrollmentFormFieldConfig } from "@/types/region";
import { DEFAULT_ENROLLMENT_FORM_CONFIG } from "@/lib/region-wizard";

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
      return snap.data() as EnrollmentFormConfig;
    }
    return DEFAULT_ENROLLMENT_FORM_CONFIG;
  } catch {
    return DEFAULT_ENROLLMENT_FORM_CONFIG;
  }
}

export function getEnabledFields(
  config: EnrollmentFormConfig,
  clientName?: string,
): EnrollmentFormFieldConfig[] {
  const allFields: EnrollmentFormFieldConfig[] = [];

  for (const section of Object.values(config.sections)) {
    for (const field of section.fields) {
      if (!field.enabled) continue;

      let resolved = { ...field };

      if (clientName && config.clientOverrides?.[clientName]) {
        const overrides = config.clientOverrides[clientName];
        for (const [sectionKey, fieldOverrides] of Object.entries(overrides)) {
          const override = fieldOverrides[field.key as keyof typeof fieldOverrides];
          if (override) {
            resolved = { ...resolved, ...override };
          }
        }
      }

      allFields.push(resolved);
    }
  }

  return allFields.sort((a, b) => a.order - b.order);
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

export function getDefaultEnrollmentConfig(): EnrollmentFormConfig {
  return JSON.parse(JSON.stringify(DEFAULT_ENROLLMENT_FORM_CONFIG));
}
