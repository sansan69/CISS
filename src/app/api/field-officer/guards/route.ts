import { NextResponse } from "next/server";
import { hasAdminAccess, hasFieldOfficerAccess, unauthorizedResponse, verifyRequestAuth, type AppDecodedToken } from "@/lib/server/auth";
import { districtMatches } from "@/lib/districts";

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
      return foData.assignedDistricts.filter((district): district is string => typeof district === "string");
    }
  }

  return Array.isArray(decoded.assignedDistricts) ? decoded.assignedDistricts : [];
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return unauthorizedResponse("Field officer or admin access required.", 403);
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const assignedDistricts = await getAssignedDistricts(adminDb, decoded);
    const employeesSnap = await adminDb
      .collection("employees")
      .where("status", "==", "Active")
      .limit(1000)
      .get();

    const guards = employeesSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string }))
      .filter((employee) => {
        if (assignedDistricts.length === 0) return true;
        return assignedDistricts.some((district) => districtMatches(district, String(employee.district ?? "")));
      })
      .map((employee) => ({
        id: String(employee.id),
        fullName: normalizeText(employee.fullName || employee.name || "Guard"),
        employeeId: normalizeText(employee.employeeId),
        clientName: normalizeText(employee.clientName),
        district: normalizeText(employee.district),
        phoneNumber: normalizeText(employee.phoneNumber),
        status: normalizeText(employee.status || "Active"),
        profilePhotoUrl: typeof employee.profilePhotoUrl === "string" ? employee.profilePhotoUrl : null,
      }))
      .sort((left, right) => left.fullName.localeCompare(right.fullName));

    return NextResponse.json({ guards });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load guards.";
    return unauthorizedResponse(message, 401);
  }
}
