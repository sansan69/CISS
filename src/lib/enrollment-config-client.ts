import { isLngClientName, normalizeClientNameKey } from "@/lib/constants";
import type {
  EnrollmentFormConfig,
  EnrollmentFormFieldConfig,
} from "@/types/region";

export function getEnabledFields(
  config: EnrollmentFormConfig,
  clientName?: string,
): EnrollmentFormFieldConfig[] {
  const allFields: EnrollmentFormFieldConfig[] = [];
  const normalizedClientName = normalizeClientNameKey(clientName);
  const clientOverrideEntry = Object.entries(config.clientOverrides ?? {}).find(
    ([configuredName]) =>
      normalizeClientNameKey(configuredName) === normalizedClientName ||
      (isLngClientName(configuredName) && isLngClientName(clientName)),
  );
  const clientOverrides = clientOverrideEntry?.[1];

  for (const [sectionKey, section] of Object.entries(config.sections)) {
    for (const field of section.fields) {
      const override = clientOverrides?.[sectionKey]?.[field.key];
      const resolved = override ? { ...field, ...override } : { ...field };

      // Apply the client override before filtering. Otherwise a field disabled
      // in the global form can never be enabled for a specific client.
      if (!resolved.enabled) continue;
      allFields.push(resolved);
    }
  }

  return allFields.sort((a, b) => a.order - b.order);
}
