import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { startOfToday } from "date-fns";
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

const INDIA_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (typeof (value as { seconds?: unknown }).seconds === "number") {
    return new Date(
      (value as { seconds: number }).seconds * 1000,
    ).toISOString();
  }
  return null;
}

async function getFieldOfficerProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
): Promise<FieldOfficerProfile> {
  let name = decoded.name ?? decoded.email ?? "Field Officer";
  let stateCode = decoded.stateCode ?? "KL";
  let assignedDistricts = Array.isArray(decoded.assignedDistricts)
    ? decoded.assignedDistricts
    : [];

  const foSnapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(1)
    .get();

  if (!foSnapshot.empty) {
    const foData = foSnapshot.docs[0].data();
    name = typeof foData.name === "string" ? foData.name : name;
    stateCode =
      typeof foData.stateCode === "string" ? foData.stateCode : stateCode;
    assignedDistricts = Array.isArray(foData.assignedDistricts)
      ? canonicalizeDistrictList(
          foData.assignedDistricts.filter(
            (district): district is string => typeof district === "string",
          ),
        )
      : assignedDistricts;
  }

  return { name, stateCode, assignedDistricts };
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return unauthorizedResponse(
        "Field officer or admin access required.",
        403,
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const profile = await getFieldOfficerProfile(adminDb, decoded);
    const assignedDistricts = profile.assignedDistricts;
    const todayKey = INDIA_DATE_FORMATTER.format(new Date());

    const [
      employeesSnap,
      workOrdersSnap,
      visitReportsSnap,
      trainingReportsSnap,
      attendanceSnap,
    ] = await Promise.all([
      adminDb.collection("employees").where("status", "==", "Active").get(),
      adminDb
        .collection("workOrders")
        .where("date", ">=", Timestamp.fromDate(startOfToday()))
        .orderBy("date", "asc")
        .get(),
      adminDb
        .collection("foVisitReports")
        .where("fieldOfficerId", "==", decoded.uid)
        .limit(50)
        .get(),
      adminDb
        .collection("foTrainingReports")
        .where("fieldOfficerId", "==", decoded.uid)
        .limit(50)
        .get(),
      adminDb
        .collection("attendanceLogs")
        .where("attendanceDate", "==", todayKey)
        .limit(1000)
        .get(),
    ]);

    const employees = employeesSnap.docs
      .map(
        (doc) =>
          ({
            id: doc.id,
            ...(doc.data() as Record<string, unknown>),
          }) as Record<string, unknown> & { id: string },
      )
      .filter((employee) => {
        if (assignedDistricts.length === 0) return true;
        return employeeMatchesAnyDistrict(employee, assignedDistricts);
      });

    const workOrders = workOrdersSnap.docs
      .map(
        (doc) =>
          ({
            id: doc.id,
            ...(doc.data() as Record<string, unknown>),
          }) as Record<string, unknown> & { id: string },
      )
      .filter((row) => {
        if (assignedDistricts.length === 0) return true;
        return assignedDistricts.some((district) =>
          districtMatches(district, String(row.district ?? "")),
        );
      })
      .filter(
        (row) =>
          normalizeText(row.recordStatus || "active").toLowerCase() ===
          "active",
      )
      .map((row) => ({
        id: String(row.id),
        siteId: normalizeText(row.siteId),
        clientId: normalizeText(row.clientId),
        clientName: normalizeText(row.clientName),
        siteName: normalizeText(row.siteName || "Site"),
        examName: normalizeText(row.examName || row.examCode || "Duty"),
        examCode: normalizeText(row.examCode),
        district: normalizeText(row.district),
        date: serializeDate(row.date),
        totalManpower: Number(
          row.totalManpower ??
            Number(row.maleGuardsRequired ?? 0) +
              Number(row.femaleGuardsRequired ?? 0),
        ),
        assignedCount: Array.isArray(row.assignedGuards)
          ? row.assignedGuards.length
          : 0,
      }))
      .filter((row) => row.date)
      .sort(
        (left, right) =>
          new Date(left.date ?? 0).getTime() -
          new Date(right.date ?? 0).getTime(),
      )
      .slice(0, 10);

    const attendanceLogs: Array<Record<string, unknown>> = attendanceSnap.docs
      .map<Record<string, unknown>>((doc) => ({
        id: doc.id,
        ...(doc.data() as Record<string, unknown>),
      }))
      .filter((log) => {
        if (assignedDistricts.length === 0) return true;
        return assignedDistricts.some((district) =>
          districtMatches(district, normalizeText(log.district)),
        );
      });

    const checkedInEmployees = new Set<string>();
    const latestByEmployee = new Map<string, Record<string, unknown>>();

    for (const log of attendanceLogs) {
      const employeeKey = normalizeText(
        log.employeeDocId || log.employeeId || log.employeeName,
      );
      if (!employeeKey) continue;
      if (normalizeText(log.status).toLowerCase() === "in") {
        checkedInEmployees.add(employeeKey);
      }

      const previous = latestByEmployee.get(employeeKey);
      const previousMs = previous
        ? new Date(
            serializeDate(previous.createdAt) ||
              serializeDate(previous.reportedAt) ||
              serializeDate(previous.reportedAtClient) ||
              0,
          ).getTime()
        : 0;
      const currentMs = new Date(
        serializeDate(log.createdAt) ||
          serializeDate(log.reportedAt) ||
          serializeDate(log.reportedAtClient) ||
          0,
      ).getTime();

      if (!previous || currentMs >= previousMs) {
        latestByEmployee.set(employeeKey, log);
      }
    }

    const onDutyEmployees = new Set<string>();
    const districtAttendance = new Map<
      string,
      { checkedIn: Set<string>; onDuty: Set<string> }
    >();
    const siteAttendance = new Map<
      string,
      {
        siteId: string;
        siteName: string;
        district: string;
        checkedIn: Set<string>;
        onDuty: Set<string>;
      }
    >();

    function districtEntry(districtName: string) {
      const label = normalizeText(districtName) || "Unassigned";
      if (!districtAttendance.has(label)) {
        districtAttendance.set(label, {
          checkedIn: new Set<string>(),
          onDuty: new Set<string>(),
        });
      }
      return districtAttendance.get(label)!;
    }

    function siteEntry(log: Record<string, unknown>) {
      const siteId = normalizeText(
        log.siteId || log.siteName || log.locationText,
      );
      const siteName = normalizeText(
        log.siteName || log.locationText || "Site",
      );
      const district = normalizeText(log.district) || "Unassigned";
      const key = siteId || `${siteName}:${district}`;
      if (!siteAttendance.has(key)) {
        siteAttendance.set(key, {
          siteId,
          siteName,
          district,
          checkedIn: new Set<string>(),
          onDuty: new Set<string>(),
        });
      }
      return siteAttendance.get(key)!;
    }

    for (const log of attendanceLogs) {
      const employeeKey = normalizeText(
        log.employeeDocId || log.employeeId || log.employeeName,
      );
      if (!employeeKey) continue;
      if (normalizeText(log.status).toLowerCase() !== "in") continue;
      districtEntry(normalizeText(log.district)).checkedIn.add(employeeKey);
      siteEntry(log).checkedIn.add(employeeKey);
    }

    for (const [employeeKey, log] of latestByEmployee.entries()) {
      if (normalizeText(log.status).toLowerCase() !== "in") continue;
      onDutyEmployees.add(employeeKey);
      districtEntry(normalizeText(log.district)).onDuty.add(employeeKey);
      siteEntry(log).onDuty.add(employeeKey);
    }

    const assignedDistrictAttendance = (
      assignedDistricts.length > 0
        ? assignedDistricts
        : Array.from(districtAttendance.keys()).sort((left, right) =>
            left.localeCompare(right),
          )
    )
      .map((district) => {
        const matchingEntries = Array.from(districtAttendance.entries()).filter(
          ([key]) => districtMatches(district, key),
        );
        const checkedIn = new Set<string>();
        const onDuty = new Set<string>();
        for (const [, entry] of matchingEntries) {
          entry.checkedIn.forEach((employeeId) => checkedIn.add(employeeId));
          entry.onDuty.forEach((employeeId) => onDuty.add(employeeId));
        }
        return {
          district,
          checkedInToday: checkedIn.size,
          onDutyNow: onDuty.size,
        };
      })
      .slice(0, 6);

    const attendanceSites = Array.from(siteAttendance.values())
      .map((entry) => ({
        siteId: entry.siteId,
        siteName: entry.siteName,
        district: entry.district,
        checkedInToday: entry.checkedIn.size,
        onDutyNow: entry.onDuty.size,
      }))
      .sort(
        (left, right) =>
          right.onDutyNow - left.onDutyNow ||
          right.checkedInToday - left.checkedInToday,
      )
      .slice(0, 5);

    const recentVisitReports = visitReportsSnap.docs.map((doc) => {
      const source = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        ...source,
        siteId: normalizeText(source.siteId),
        visitDate: serializeDate(source.visitDate),
        createdAt: serializeDate(source.createdAt),
      };
    });
    const recentTrainingReports = trainingReportsSnap.docs.map((doc) => {
      const source = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        ...source,
        siteId: normalizeText(source.siteId),
        trainingDate: serializeDate(source.trainingDate),
        createdAt: serializeDate(source.createdAt),
      };
    });

    const todayWorkOrders = workOrders.filter((row) => {
      if (!row.date) return false;
      return INDIA_DATE_FORMATTER.format(new Date(row.date)) === todayKey;
    });

    const visitReportsToday = recentVisitReports.filter((report) => {
      const dateValue = report.visitDate || report.createdAt;
      return dateValue
        ? INDIA_DATE_FORMATTER.format(new Date(String(dateValue))) === todayKey
        : false;
    });
    const trainingReportsToday = recentTrainingReports.filter((report) => {
      const dateValue = report.trainingDate || report.createdAt;
      return dateValue
        ? INDIA_DATE_FORMATTER.format(new Date(String(dateValue))) === todayKey
        : false;
    });

    const todayVisitSiteIds = new Set(
      visitReportsToday.map((report) => normalizeText(report.siteId)).filter(Boolean),
    );
    const todayTrainingSiteIds = new Set(
      trainingReportsToday
        .map((report) => normalizeText(report.siteId))
        .filter(Boolean),
    );

    const siteBriefMap = new Map<
      string,
      {
        siteId: string;
        siteName: string;
        clientId: string;
        clientName: string;
        district: string;
        dutyCount: number;
        requiredGuards: number;
        assignedGuards: number;
        checkedInToday: number;
        onDutyNow: number;
        hasVisitReport: boolean;
        hasTrainingReport: boolean;
      }
    >();

    for (const workOrder of todayWorkOrders) {
      const siteKey =
        normalizeText(workOrder.siteId) ||
        `${normalizeText(workOrder.siteName)}:${normalizeText(workOrder.district)}`;
      const existing = siteBriefMap.get(siteKey) ?? {
        siteId: normalizeText(workOrder.siteId),
        siteName: normalizeText(workOrder.siteName || "Site"),
        clientId: normalizeText(workOrder.clientId),
        clientName: normalizeText(workOrder.clientName),
        district: normalizeText(workOrder.district),
        dutyCount: 0,
        requiredGuards: 0,
        assignedGuards: 0,
        checkedInToday: 0,
        onDutyNow: 0,
        hasVisitReport: false,
        hasTrainingReport: false,
      };
      existing.dutyCount += 1;
      existing.requiredGuards += Number(workOrder.totalManpower || 0);
      existing.assignedGuards += Number(workOrder.assignedCount || 0);
      existing.hasVisitReport =
        existing.hasVisitReport || todayVisitSiteIds.has(existing.siteId);
      existing.hasTrainingReport =
        existing.hasTrainingReport || todayTrainingSiteIds.has(existing.siteId);
      siteBriefMap.set(siteKey, existing);
    }

    for (const entry of siteAttendance.values()) {
      const siteKey =
        normalizeText(entry.siteId) ||
        `${normalizeText(entry.siteName)}:${normalizeText(entry.district)}`;
      const existing = siteBriefMap.get(siteKey);
      if (!existing) continue;
      existing.checkedInToday = entry.checkedIn.size;
      existing.onDutyNow = entry.onDuty.size;
    }

    const todaySiteBriefs = Array.from(siteBriefMap.values()).sort(
      (left, right) =>
        (right.requiredGuards - right.assignedGuards) -
          (left.requiredGuards - left.assignedGuards) ||
        left.siteName.localeCompare(right.siteName),
    );

    const totalSitesInScope = new Set(
      workOrders.map((row) => normalizeText(row.siteId || row.siteName)).filter(Boolean),
    ).size;
    const todayRequiredGuards = todaySiteBriefs.reduce(
      (sum, site) => sum + site.requiredGuards,
      0,
    );
    const todayAssignedGuards = todaySiteBriefs.reduce(
      (sum, site) => sum + site.assignedGuards,
      0,
    );
    const sitesWithoutAttendance = todaySiteBriefs.filter(
      (site) => site.checkedInToday == 0,
    ).length;
    const pendingSiteReports = todaySiteBriefs.filter(
      (site) => !site.hasVisitReport && !site.hasTrainingReport,
    ).length;
    const underAssignedSites = todaySiteBriefs.filter(
      (site) => site.assignedGuards < site.requiredGuards,
    ).length;

    return NextResponse.json({
      name: profile.name,
      stateCode: profile.stateCode,
      assignedDistricts,
      totalGuards: employees.length,
      activeGuards: employees.filter(
        (employee) => normalizeText(employee.status) === "Active",
      ).length,
      totalSitesInScope,
      attendanceSummary: {
        date: todayKey,
        checkedInToday: checkedInEmployees.size,
        onDutyNow: onDutyEmployees.size,
        districts: assignedDistrictAttendance,
      },
      todayOverview: {
        sitesScheduled: todaySiteBriefs.length,
        dutiesScheduled: todayWorkOrders.length,
        requiredGuards: todayRequiredGuards,
        assignedGuards: todayAssignedGuards,
        unassignedGuards: Math.max(0, todayRequiredGuards - todayAssignedGuards),
        sitesWithoutAttendance,
        visitReportsToday: visitReportsToday.length,
        trainingReportsToday: trainingReportsToday.length,
        pendingSiteReports,
        underAssignedSites,
      },
      todaySites: todaySiteBriefs,
      attendanceSites,
      upcomingWorkOrders: workOrders,
      recentWorkOrders: workOrders.slice(0, 5),
      recentVisitReports,
      recentTrainingReports,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load field officer dashboard.";
    return unauthorizedResponse(message, 401);
  }
}
