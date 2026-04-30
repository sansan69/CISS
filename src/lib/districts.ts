import { KERALA_DISTRICTS } from "@/lib/constants";
import { REGION_CODE } from "@/lib/runtime-config";

const DISTRICT_ALIASES = new Map<string, string>([
  ["trivandrum", "Thiruvananthapuram"],
  ["tvm", "Thiruvananthapuram"],
  ["trivandrum district", "Thiruvananthapuram"],
  ["thiruvananthapuram", "Thiruvananthapuram"],
  ["quilon", "Kollam"],
  ["alleppey", "Alappuzha"],
  ["cochin", "Ernakulam"],
  ["kochi", "Ernakulam"],
  ["trichur", "Thrissur"],
  ["calicut", "Kozhikode"],
]);

const DISTRICT_SEARCH_VARIANTS = new Map<string, string[]>([
  ["Thiruvananthapuram", ["Trivandrum", "TVM"]],
  ["Kollam", ["Quilon"]],
  ["Alappuzha", ["Alleppey"]],
  ["Ernakulam", ["Cochin", "Kochi"]],
  ["Thrissur", ["Trichur"]],
  ["Kozhikode", ["Calicut"]],
]);

export function normalizeDistrictName(value?: string | null) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function stripDistrictSuffix(value?: string | null) {
  return normalizeDistrictName(value)
    .replace(/\s*(?:district|dist\.?)\s*$/i, "")
    .trim();
}

function getDistrictCandidates(value?: string | null) {
  const normalized = normalizeDistrictName(value);
  if (!normalized) return [];

  const candidates = new Set<string>();
  const queue = [normalized, stripDistrictSuffix(normalized)];

  for (const segment of normalized.split(/[\/,&|;]+/)) {
    queue.push(segment, stripDistrictSuffix(segment));
  }

  for (const candidate of queue) {
    const cleaned = normalizeDistrictName(candidate);
    if (cleaned) {
      candidates.add(cleaned);
    }
  }

  return Array.from(candidates);
}

function resolveDistrictAlias(value?: string | null) {
  const candidates = getDistrictCandidates(value);
  if (candidates.length === 0) return "";

  for (const candidate of candidates) {
    const aliased = DISTRICT_ALIASES.get(candidate.toLowerCase());
    if (aliased) return aliased;
  }

  return candidates[0];
}

export function districtKey(value?: string | null) {
  return resolveDistrictAlias(value).toLowerCase();
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
  const normalized = resolveDistrictAlias(value);
  if (!normalized) return "";

  for (const suggestion of suggestions) {
    if (districtMatches(suggestion, normalized)) {
      return normalizeDistrictName(suggestion);
    }
  }

  return normalized;
}

export function canonicalizeDistrictList(
  values: Array<string | null | undefined>,
  suggestions: Array<string | null | undefined> = getDefaultDistrictSuggestions(),
) {
  return Array.from(
    new Set(
      values
        .map((value) => canonicalizeDistrictName(value, suggestions))
        .filter(Boolean),
    ),
  );
}

export function expandDistrictQueryValues(
  values: Array<string | null | undefined>,
  suggestions: Array<string | null | undefined> = getDefaultDistrictSuggestions(),
) {
  const expanded = new Set<string>();

  for (const value of values) {
    const normalized = normalizeDistrictName(value);
    if (!normalized) continue;

    expanded.add(normalized);
    const canonical = canonicalizeDistrictName(normalized, suggestions);
    if (canonical) {
      expanded.add(canonical);
      for (const variant of DISTRICT_SEARCH_VARIANTS.get(canonical) ?? []) {
        expanded.add(variant);
      }
    }
    for (const [alias, canonicalName] of DISTRICT_ALIASES.entries()) {
      if (canonicalizeDistrictName(alias, suggestions) === canonical) {
        expanded.add(alias);
        expanded.add(canonicalName);
      }
    }
  }

  return Array.from(expanded);
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
