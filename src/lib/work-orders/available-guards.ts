import { employeeMatchesAnyDistrict } from "@/lib/employees/visibility";
import type { Employee } from "@/types/employee";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isActiveStatus(value: unknown) {
  return normalizeText(value).toLowerCase() === "active";
}

export function filterActiveGuardsForDistricts(
  guards: Employee[],
  districts: Array<string | null | undefined>,
) {
  const districtScope = districts.filter((district): district is string =>
    Boolean(district?.trim()),
  );
  if (districtScope.length === 0) return [];

  return guards
    .filter((guard) => isActiveStatus(guard.status))
    .filter((guard) => employeeMatchesAnyDistrict(guard, districtScope))
    .sort((left, right) =>
      (left.fullName || left.employeeId || "").localeCompare(
        right.fullName || right.employeeId || "",
      ),
    );
}

export async function fetchActiveGuardsForDistricts(
  districts: Array<string | null | undefined>,
  options: { allowEmptyScope?: boolean } = {},
) {
  const districtScope = districts.filter((district): district is string =>
    Boolean(district?.trim()),
  );
  // When the caller (admin assign dialog with an unknown site district) opts
  // into an empty scope, fall through to the API which returns all active
  // guards for admins. Field officers keep the strict empty-scope short-circuit.
  if (districtScope.length === 0 && !options.allowEmptyScope) {
    return [];
  }

  const params = new URLSearchParams();
  districtScope.forEach((district) => params.append("district", district));
  const { authorizedFetch } = await import("@/lib/api-client");
  const url = `/api/field-officer/guards${params.toString() ? `?${params.toString()}` : ""}`;
  const response = await authorizedFetch(url);
  if (!response.ok) {
    throw new Error("Could not load guards.");
  }
  const payload = (await response.json()) as { guards?: Employee[] };
  if (districtScope.length === 0) {
    // No scope to filter against — admin path returns whatever the API gave.
    return (payload.guards ?? []).slice().sort((left, right) =>
      (left.fullName || left.employeeId || "").localeCompare(
        right.fullName || right.employeeId || "",
      ),
    );
  }
  return filterActiveGuardsForDistricts(payload.guards ?? [], districtScope);
}
