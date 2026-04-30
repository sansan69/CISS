import { collection, getDocs, query, where, type Firestore } from "firebase/firestore";
import { districtMatches } from "@/lib/districts";
import type { Employee } from "@/types/employee";

export function filterActiveGuardsForDistricts(
  guards: Employee[],
  districts: Array<string | null | undefined>,
) {
  const districtScope = districts.filter((district): district is string =>
    Boolean(district?.trim()),
  );
  if (districtScope.length === 0) return [];

  return guards
    .filter((guard) => guard.status === "Active")
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
  firestore: Firestore,
  districts: Array<string | null | undefined>,
) {
  const districtScope = districts.filter((district): district is string =>
    Boolean(district?.trim()),
  );
  if (districtScope.length === 0) return [];

  const snap = await getDocs(
    query(collection(firestore, "employees"), where("status", "==", "Active")),
  );

  return filterActiveGuardsForDistricts(
    snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Employee)),
    districtScope,
  );
}
