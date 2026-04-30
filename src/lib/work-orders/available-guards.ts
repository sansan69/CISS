import { districtMatches } from "@/lib/districts";
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
    .filter((guard) =>
      districtScope.some((district) => districtMatches(district, guard.district)),
    )
    .sort((left, right) =>
      (left.fullName || left.employeeId || "").localeCompare(
        right.fullName || right.employeeId || "",
      ),
    );
}

export async function fetchActiveGuardsForDistricts(
  districts: Array<string | null | undefined>,
) {
  const districtScope = districts.filter((district): district is string =>
    Boolean(district?.trim()),
  );
  if (districtScope.length === 0) return [];

  const params = new URLSearchParams();
  districtScope.forEach((district) => params.append("district", district));
  const { authorizedFetch } = await import("@/lib/api-client");
  const response = await authorizedFetch(`/api/field-officer/guards?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Could not load guards.");
  }
  const payload = (await response.json()) as { guards?: Employee[] };
  return filterActiveGuardsForDistricts(payload.guards ?? [], districtScope);
}
