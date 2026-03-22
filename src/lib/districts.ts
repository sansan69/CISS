import { KERALA_DISTRICTS } from "@/lib/constants";
import { REGION_CODE } from "@/lib/runtime-config";

export function normalizeDistrictName(value?: string | null) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function districtKey(value?: string | null) {
  return normalizeDistrictName(value).toLowerCase();
}

export function districtMatches(left?: string | null, right?: string | null) {
  const leftKey = districtKey(left);
  const rightKey = districtKey(right);
  return Boolean(leftKey) && leftKey === rightKey;
}

export function getDefaultDistrictSuggestions(regionCode?: string | null) {
  return (regionCode ?? REGION_CODE).trim().toUpperCase() === "KL"
    ? [...KERALA_DISTRICTS]
    : [];
}

export function canonicalizeDistrictName(
  value?: string | null,
  suggestions: Array<string | null | undefined> = getDefaultDistrictSuggestions(),
) {
  const normalized = normalizeDistrictName(value);
  if (!normalized) return "";

  for (const suggestion of suggestions) {
    if (districtMatches(suggestion, normalized)) {
      return normalizeDistrictName(suggestion);
    }
  }

  return normalized;
}

export function isRecognizedDistrictName(
  value?: string | null,
  suggestions: Array<string | null | undefined> = getDefaultDistrictSuggestions(),
) {
  const normalized = normalizeDistrictName(value);
  if (!normalized) return false;
  if (suggestions.length === 0) return true;

  return suggestions.some((suggestion) => districtMatches(suggestion, normalized));
}

export function mergeDistrictOptions(
  ...sources: Array<Array<string | null | undefined> | undefined>
) {
  const deduped = new Map<string, string>();

  for (const source of sources) {
    for (const raw of source ?? []) {
      const normalized = normalizeDistrictName(raw);
      const key = districtKey(normalized);
      if (!normalized || !key || deduped.has(key)) continue;
      deduped.set(key, normalized);
    }
  }

  return Array.from(deduped.values()).sort((left, right) =>
    left.localeCompare(right),
  );
}
