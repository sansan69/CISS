import {
  canonicalizeDistrictName,
  districtMatches,
  inferKeralaDistrictFromText,
  isCanonicalKeralaDistrict,
  normalizeDistrictName,
} from "@/lib/districts";

export type EmployeeDistrictLike = {
  district?: unknown;
  districtName?: unknown;
  currentDistrict?: unknown;
  permanentDistrict?: unknown;
  addressDistrict?: unknown;
  locationDistrict?: unknown;
  city?: unknown;
  fullAddress?: unknown;
  address?: unknown;
};

function readText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

type EmployeeDistrictInput = EmployeeDistrictLike | Record<string, unknown>;

export function resolveEmployeeDistrict(employee: EmployeeDistrictInput): string {
  const record = employee as Record<string, unknown>;
  const candidates = [
    record.district,
    record.districtName,
    record.currentDistrict,
    record.permanentDistrict,
    record.addressDistrict,
    record.locationDistrict,
    record.city,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeDistrictName(readText(candidate));
    if (!normalized) continue;
    if (isCanonicalKeralaDistrict(normalized)) {
      return canonicalizeDistrictName(normalized) || normalized;
    }
    return normalized;
  }

  const inferred = inferKeralaDistrictFromText(
    [record.fullAddress, record.address].filter(Boolean).join(" "),
  );
  return inferred;
}

export function employeeMatchesAnyDistrict(
  employee: EmployeeDistrictInput,
  districts: Array<string | null | undefined>,
) {
  const resolvedDistrict = resolveEmployeeDistrict(employee);
  if (!resolvedDistrict) return false;
  return districts.some((district) => districtMatches(district, resolvedDistrict));
}
