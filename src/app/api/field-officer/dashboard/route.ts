import { NextResponse } from "next/server";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  unauthorizedResponse,
  verifyRequestAuth,
  type AppDecodedToken,
} from "@/lib/server/auth";
import { canonicalizeDistrictList, districtMatches } from "@/lib/districts";
import { employeeMatchesAnyDistrict } from "@/lib/employees/visibility";

type FieldOfficerProfile = {
  name: string;
  stateCode: string;
  assignedDistricts: string[];
};

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (typeof (value as { seconds?: unknown }).seconds === "number") {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }
  return null;
}

async function getFieldOfficerProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
): Promise<FieldOfficerProfile> {
  let name = decoded.name ?? decoded.email ?? "Field Officer";
  let stateCode = decoded.stateCode ?? "KL";
  let assignedDistricts = Array.isArray(decoded.assignedDistricts) ? decoded.assignedDistricts : [];

  const foSnapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(1)
    .get();

  if (!foSnapshot.empty) {
    const foData = foSnapshot.docs[0].data();
    name = typeof foData.name === "string" ? foData.name : name;
    stateCode = typeof foData.stateCode === "string" ? foData.stateCode : stateCode;
    assignedDistricts = Array.isArray(foData.assignedDistricts)
      ? canonicalizeDistrictList(
          foData.assignedDistricts.filter((district): district is string => typeof district === "string"),
        )
      : assignedDistricts;
  }

  return { name, stateCode, assignedDistricts };
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return unauthorizedResponse("Field officer or admin access required.", 403);
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const profile = await getFieldOfficerProfile(adminDb, decoded);
    const assignedDistricts = profile.assignedDistricts;

    const [employeesSnap, workOrdersSnap, visitReportsSnap, trainingReportsSnap] = await Promise.all([
      adminDb.collection("employees").where("status", "==", "Active").get(),
      adminDb.collection("workOrders").orderBy("date", "desc").limit(500).get(),
      adminDb.collection("foVisitReports").where("fieldOfficerId", "==", decoded.uid).limit(50).get(),
      adminDb.collection("foTrainingReports").where("fieldOfficerId", "==", decoded.uid).limit(50).get(),
    ]);

    const employees = employeesSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string }))
      .filter((employee) => {
        if (assignedDistricts.length === 0) return true;
        return employeeMatchesAnyDistrict(employee, assignedDistricts);
      });

    const workOrders = workOrdersSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string }))
      .filter((row) => {
        if (assignedDistricts.length === 0) return true;
        return assignedDistricts.some((district) => districtMatches(district, String(row.district ?? "")));
      })
      .filter((row) => normalizeText(row.recordStatus || "active").toLowerCase() === "active")
      .map((row) => ({
        id: String(row.id),
        siteName: normalizeText(row.siteName || "Site"),
        examName: normalizeText(row.examName || row.examCode || "Duty"),
        district: normalizeText(row.district),
        date: serializeDate(row.date),
        totalManpower: Number(row.totalManpower ?? Number(row.maleGuardsRequired ?? 0) + Number(row.femaleGuardsRequired ?? 0)),
        assignedCount: Array.isArray(row.assignedGuards) ? row.assignedGuards.length : 0,
      }))
      .filter((row) => row.date)
      .sort((left, right) => new Date(left.date ?? 0).getTime() - new Date(right.date ?? 0).getTime())
      .slice(0, 10);

    const recentVisitReports = visitReportsSnap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
      visitDate: serializeDate((doc.data() as Record<string, unknown>).visitDate),
      createdAt: serializeDate((doc.data() as Record<string, unknown>).createdAt),
    }));
    const recentTrainingReports = trainingReportsSnap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
      trainingDate: serializeDate((doc.data() as Record<string, unknown>).trainingDate),
      createdAt: serializeDate((doc.data() as Record<string, unknown>).createdAt),
    }));

    return NextResponse.json({
      name: profile.name,
      stateCode: profile.stateCode,
      assignedDistricts,
      totalGuards: employees.length,
      activeGuards: employees.filter((employee) => normalizeText(employee.status) === "Active").length,
      upcomingWorkOrders: workOrders,
      recentWorkOrders: workOrders.slice(0, 5),
      recentVisitReports,
      recentTrainingReports,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load field officer dashboard.";
    return unauthorizedResponse(message, 401);
  }
}
