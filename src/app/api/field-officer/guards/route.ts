import { NextResponse } from "next/server";
import { hasAdminAccess, hasFieldOfficerAccess, unauthorizedResponse, verifyRequestAuth, type AppDecodedToken } from "@/lib/server/auth";
import { canonicalizeDistrictList, districtMatches } from "@/lib/districts";
import { employeeMatchesAnyDistrict, resolveEmployeeDistrict } from "@/lib/employees/visibility";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isActiveStatus(value: unknown) {
  return normalizeText(value).toLowerCase() === "active";
}

async function getAssignedDistricts(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
) {
  const foSnapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(1)
    .get();

  if (!foSnapshot.empty) {
    const foData = foSnapshot.docs[0].data();
    if (Array.isArray(foData.assignedDistricts)) {
      return canonicalizeDistrictList(
        foData.assignedDistricts.filter((district): district is string => typeof district === "string"),
      );
    }
  }

  return Array.isArray(decoded.assignedDistricts)
    ? canonicalizeDistrictList(decoded.assignedDistricts.filter((district): district is string => typeof district === "string"))
    : [];
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return unauthorizedResponse("Field officer or admin access required.", 403);
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const requestedDistricts = new URL(request.url)
      .searchParams
      .getAll("district")
      .map(normalizeText)
      .filter(Boolean);
    const assignedDistricts = await getAssignedDistricts(adminDb, decoded);
    const isAdmin = hasAdminAccess(decoded);
    const districtScope = requestedDistricts.length > 0
      ? requestedDistricts.filter((district) =>
          isAdmin || assignedDistricts.some((assigned) => districtMatches(assigned, district)),
        )
      : assignedDistricts;

    if (!isAdmin && districtScope.length === 0) {
      return NextResponse.json({ guards: [] });
    }

    // Load every employee. The previous `.limit(1000)` was unbounded by
    // ordering, so a workforce past the cap could silently exclude guards in
    // the requested district. Status/district matching has to run in memory
    // anyway because both are case-insensitive and alias-aware.
    const employeesSnap = await adminDb.collection("employees").get();

    const guards = employeesSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string }))
      .filter((employee) => {
        if (!isActiveStatus(employee.status)) return false;
        if (districtScope.length === 0) return true;
        return employeeMatchesAnyDistrict(employee, districtScope);
      })
      .map((employee) => ({
        id: String(employee.id),
        fullName: normalizeText(employee.fullName || employee.name || "Guard"),
        employeeId: normalizeText(employee.employeeId),
        clientName: normalizeText(employee.clientName),
        district: resolveEmployeeDistrict(employee),
        gender: normalizeText(employee.gender),
        phoneNumber: normalizeText(employee.phoneNumber),
        status: "Active",
        profilePictureUrl:
          typeof employee.profilePictureUrl === "string"
            ? employee.profilePictureUrl
            : typeof employee.profilePhotoUrl === "string"
              ? employee.profilePhotoUrl
              : null,
      }))
      .sort((left, right) => left.fullName.localeCompare(right.fullName));

    return NextResponse.json({ guards });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load guards.";
    return unauthorizedResponse(message, 401);
  }
}
