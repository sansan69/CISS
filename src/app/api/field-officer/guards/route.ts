import { NextResponse } from "next/server";
import { hasAdminAccess, hasFieldOfficerAccess, unauthorizedResponse, verifyRequestAuth, type AppDecodedToken } from "@/lib/server/auth";
import {
  canonicalizeDistrictList,
  districtMatches,
  getDistrictFirestoreQueryValues,
} from "@/lib/districts";
import { employeeMatchesAnyDistrict, resolveEmployeeDistrict } from "@/lib/employees/visibility";
export const runtime = "nodejs";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

    const employeeDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    if (isAdmin && districtScope.length === 0) {
      const snapshot = await adminDb.collection("employees").get();
      snapshot.docs.forEach((doc) => employeeDocs.set(doc.id, doc));
    } else {
      // Firestore supports at most 30 values in an `in` query. Query only the
      // officer's canonical district scope and merge chunks by document ID.
      const queryValues = Array.from(
        new Set(districtScope.flatMap((district) => getDistrictFirestoreQueryValues(district))),
      );
      const chunks: string[][] = [];
      for (let index = 0; index < queryValues.length; index += 30) {
        chunks.push(queryValues.slice(index, index + 30));
      }
      const districtFields = [
        "district",
        "districtName",
        "currentDistrict",
        "permanentDistrict",
        "addressDistrict",
        "locationDistrict",
        "city",
      ];
      const snapshots = await Promise.all(
        districtFields.flatMap((field) =>
          chunks.map((districts) =>
            adminDb.collection("employees").where(field, "in", districts).get(),
          ),
        ),
      );
      snapshots.forEach((snapshot) => {
        snapshot.docs.forEach((doc) => employeeDocs.set(doc.id, doc));
      });
    }

    const guards = Array.from(employeeDocs.values())
      .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string }))
      .filter((employee) => normalizeText(employee.status || "Active").toLowerCase() === "active")
      .filter((employee) => {
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
        status: normalizeText(employee.status || "Active"),
        joiningDate:
          typeof employee.joiningDate === "string"
            ? employee.joiningDate
            : typeof (employee.joiningDate as { toDate?: unknown } | undefined)?.toDate === "function"
              ? ((employee.joiningDate as { toDate: () => Date }).toDate()).toISOString()
              : "",
        resourceIdNumber: normalizeText(employee.resourceIdNumber),
        address: normalizeText(employee.address),
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
