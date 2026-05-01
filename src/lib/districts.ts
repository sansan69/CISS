import { REGION_CODE } from "@/lib/runtime-config";

export const KERALA_DISTRICTS = [
  "Thiruvananthapuram",
  "Kollam",
  "Pathanamthitta",
  "Alappuzha",
  "Kottayam",
  "Idukki",
  "Ernakulam",
  "Thrissur",
  "Palakkad",
  "Malappuram",
  "Kozhikode",
  "Wayanad",
  "Kannur",
  "Kasaragod",
  "Lakshadweep",
] as const;

/**
 * Single source of truth for Kerala district identity used across:
 *   - the work-order Excel parser (district column resolution + keyword scan)
 *   - the import commit route (district canonicalisation before write)
 *   - the district backfill API (repairs legacy/empty districts)
 *   - field officer / guard scoping (canonical district lists)
 */
export interface KeralaDistrictEntry {
  canonical: string;
  aliases: string[];
  searchTerms: string[];
  keywords: string[];
}

export const KERALA_DISTRICT_INDEX: KeralaDistrictEntry[] = [
  {
    canonical: "Thiruvananthapuram",
    aliases: ["thiruvananthapuram", "trivandrum", "tvm", "trivandrum district"],
    searchTerms: ["Trivandrum", "TVM"],
    keywords: ["thiruvananthapuram", "trivandrum", "tvm", "vellayambalam", "kazhakkoottam", "neyyattinkara", "attingal"],
  },
  {
    canonical: "Kollam",
    aliases: ["kollam", "quilon"],
    searchTerms: ["Quilon"],
    keywords: ["kollam", "quilon", "punalur", "karunagappally", "paravur"],
  },
  {
    canonical: "Pathanamthitta",
    aliases: ["pathanamthitta"],
    searchTerms: [],
    keywords: ["pathanamthitta", "adoor", "thiruvalla", "ranni", "konni"],
  },
  {
    canonical: "Alappuzha",
    aliases: ["alappuzha", "alleppey"],
    searchTerms: ["Alleppey"],
    keywords: ["alappuzha", "alleppey", "cherthala", "mavelikkara", "haripad", "kayamkulam"],
  },
  {
    canonical: "Kottayam",
    aliases: ["kottayam"],
    searchTerms: [],
    keywords: ["kottayam", "changanassery", "pala", "ettumanoor", "vaikom"],
  },
  {
    canonical: "Idukki",
    aliases: ["idukki"],
    searchTerms: [],
    keywords: ["idukki", "thodupuzha", "munnar", "kattappana", "nedumkandam"],
  },
  {
    canonical: "Ernakulam",
    aliases: ["ernakulam", "cochin", "kochi"],
    searchTerms: ["Cochin", "Kochi"],
    keywords: [
      "ernakulam",
      "kochi",
      "cochin",
      "kakkanad",
      "aluva",
      "edappally",
      "kalamassery",
      "perumbavoor",
      "angamaly",
      "muvattupuzha",
      "thrippunithura",
      "tripunithura",
      "fort kochi",
      "vyttila",
    ],
  },
  {
    canonical: "Thrissur",
    aliases: ["thrissur", "trichur"],
    searchTerms: ["Trichur"],
    keywords: [
      "thrissur",
      "trichur",
      "chalakudy",
      "guruvayur",
      "kodungallur",
      "irinjalakuda",
      "kunnamkulam",
      "wadakkanchery",
    ],
  },
  {
    canonical: "Palakkad",
    aliases: ["palakkad", "palghat"],
    searchTerms: ["Palghat"],
    keywords: ["palakkad", "palghat", "ottapalam", "shornur", "mannarkkad", "alathur", "chittur"],
  },
  {
    canonical: "Malappuram",
    aliases: ["malappuram"],
    searchTerms: [],
    keywords: [
      "malappuram",
      "manjeri",
      "tirur",
      "kottakkal",
      "perinthalmanna",
      "edappal",
      "ponnani",
      "nilambur",
    ],
  },
  {
    canonical: "Kozhikode",
    aliases: ["kozhikode", "calicut"],
    searchTerms: ["Calicut"],
    keywords: [
      "kozhikode",
      "calicut",
      "vadakara",
      "koyilandy",
      "feroke",
      "balussery",
      "kuttiady",
      "thamarassery",
    ],
  },
  {
    canonical: "Wayanad",
    aliases: ["wayanad"],
    searchTerms: [],
    keywords: ["wayanad", "kalpetta", "sulthan bathery", "sultan bathery", "mananthavady"],
  },
  {
    canonical: "Kannur",
    aliases: ["kannur", "cannanore"],
    searchTerms: ["Cannanore"],
    keywords: ["kannur", "cannanore", "thalassery", "tellicherry", "payyanur", "iritty", "mattanur"],
  },
  {
    canonical: "Kasaragod",
    aliases: ["kasaragod", "kasargod"],
    searchTerms: ["Kasargod"],
    keywords: ["kasaragod", "kasargod", "kanhangad", "nileshwar", "uppala", "manjeshwar"],
  },
  {
    canonical: "Lakshadweep",
    aliases: ["lakshadweep"],
    searchTerms: [],
    keywords: ["lakshadweep", "kavaratti", "agatti", "minicoy"],
  },
];

// Operational zones that some TCS workbooks place in the district column.
const DISTRICT_ZONE_MAP: Record<string, string> = {
  "south 2": "Ernakulam",
};

const DISTRICT_ALIASES = new Map<string, string>(
  KERALA_DISTRICT_INDEX.flatMap((entry) =>
    entry.aliases.map((alias) => [alias.toLowerCase(), entry.canonical] as const),
  ),
);

const DISTRICT_SEARCH_VARIANTS = new Map<string, string[]>(
  KERALA_DISTRICT_INDEX
    .filter((entry) => entry.searchTerms.length > 0)
    .map((entry) => [entry.canonical, [...entry.searchTerms]] as const),
);

const KEYWORD_PATTERNS: Array<{ canonical: string; pattern: RegExp }> = KERALA_DISTRICT_INDEX
  .flatMap((entry) =>
    entry.keywords.map((keyword) => ({
      canonical: entry.canonical,
      pattern: new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
    })),
  )
  .sort((left, right) => right.pattern.source.length - left.pattern.source.length);

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

/**
 * True when the input resolves (alias-aware) to one of the canonical Kerala
 * districts in `KERALA_DISTRICT_INDEX`.
 */
export function isCanonicalKeralaDistrict(value?: string | null): boolean {
  const key = districtKey(value);
  if (!key) return false;
  return KERALA_DISTRICT_INDEX.some((entry) => districtKey(entry.canonical) === key);
}

/**
 * Map operational zone labels (e.g. "South 2") to their canonical district.
 */
export function normalizeOperationalZoneLabel(value?: string | null): string {
  const normalized = normalizeDistrictName(value);
  if (!normalized) return "";
  const zoneHit = DISTRICT_ZONE_MAP[normalized.toLowerCase()];
  return zoneHit ?? normalized;
}

/**
 * Scan free-form text for any Kerala-district keyword (canonical, alias, or
 * town-level). Returns the canonical district or "" when no hit.
 */
export function inferKeralaDistrictFromText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!text.trim()) return "";
  for (const { canonical, pattern } of KEYWORD_PATTERNS) {
    if (pattern.test(text)) return canonical;
  }
  return "";
}

/**
 * Given a raw district value plus the surrounding row cells, return the best
 * canonical Kerala district. Resolution order:
 *   1. Strip operational-zone wrappers.
 *   2. If it canonicalises to a Kerala district, use that.
 *   3. Otherwise scan the row for a known keyword.
 *   4. Fall back to whatever string we had.
 */
export function resolveKeralaDistrictFromRow(
  rawDistrict: unknown,
  row: Iterable<unknown>,
): string {
  const zoneNormalized = normalizeOperationalZoneLabel(rawDistrict as string | null | undefined);
  if (zoneNormalized && isCanonicalKeralaDistrict(zoneNormalized)) {
    return canonicalizeDistrictName(zoneNormalized) || zoneNormalized;
  }
  for (const cell of row) {
    const inferred = inferKeralaDistrictFromText(cell);
    if (inferred) return inferred;
  }
  return zoneNormalized;
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
