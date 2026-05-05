import { NextResponse } from "next/server";

import { hasClientAccess, unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import {
  matchesClientScope,
  resolveClientScope,
} from "@/lib/server/client-access";
import { OPERATIONAL_CLIENT_NAME } from "@/lib/constants";
import { resolveSiteDutyPoints, resolveSiteShift } from "@/lib/shift-utils";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";
import type {
  ClientDashboardDutyPointSnapshot,
  ClientDashboardGuardHighlight,
  ClientDashboardLiveAttendanceRow,
  ClientDashboardPayload,
  ClientDashboardSiteSnapshot,
  ClientDashboardTrainingReportRow,
  ClientDashboardVisitReportRow,
  ClientDashboardWorkOrderRow,
} from "@/types/client-dashboard";
import { resolveClientModules } from "@/types/client-permissions";
import type { ClientDashboardModulesConfig } from "@/types/client-permissions";

type DashboardRecord = Record<string, unknown> & { id: string };

const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
});

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (typeof (value as { seconds?: unknown }).seconds === "number") {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }
  if (typeof (value as { _seconds?: unknown })._seconds === "number") {
    return new Date((value as { _seconds: number })._seconds * 1000).toISOString();
  }
  return null;
}

function toDate(value: unknown): Date | null {
  const iso = serializeDate(value);
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isTodayInIst(value: unknown, todayKey: string) {
  const date = toDate(value);
  if (!date) return false;
  return IST_DATE_FORMATTER.format(date) === todayKey;
}

function sortByDateDesc<T>(rows: T[], pick: (row: T) => string | null) {
  return [...rows].sort((left, right) => {
    const leftMs = pick(left) ? new Date(pick(left) as string).getTime() : 0;
    const rightMs = pick(right) ? new Date(pick(right) as string).getTime() : 0;
    return rightMs - leftMs;
  });
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasClientAccess(decoded)) {
      return unauthorizedResponse("Client access required.", 403);
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const scope = await resolveClientScope(adminDb, decoded);
    if (!scope) {
      return unauthorizedResponse("Client account is not linked to a valid client profile.", 403);
    }
    const isOperationalClient = isOperationalWorkOrderClientName(scope.clientName);

    // Load per-client dashboard module visibility config
    let dashboardModules: Required<ClientDashboardModulesConfig> = resolveClientModules(null);
    if (scope.clientId) {
      const clientDoc = await adminDb.collection("clients").doc(scope.clientId).get();
      if (clientDoc.exists) {
        const clientData = clientDoc.data() as Record<string, unknown>;
        const modulesConfig = clientData.dashboardModules as ClientDashboardModulesConfig | undefined;
        dashboardModules = resolveClientModules(modulesConfig);
      }
    }
    if (!isOperationalClient) {
      dashboardModules = { ...dashboardModules, workOrders: false };
    }

    const today = new Date();
    const todayKey = IST_DATE_FORMATTER.format(today);
    const next14Days = new Date(today);
    next14Days.setDate(next14Days.getDate() + 14);

    const employeesPromise = adminDb
      .collection("employees")
      .where("clientName", "==", scope.clientName)
      .get();
    const attendancePromise = adminDb
      .collection("attendanceLogs")
      .where("clientName", "==", scope.clientName)
      .limit(500)
      .get();
    const workOrdersPromise: Promise<{ docs: Array<{ id: string; data(): Record<string, unknown> }> }> =
      isOperationalClient
        ? (adminDb.collection("workOrders").where("clientName", "==", OPERATIONAL_CLIENT_NAME).get() as any)
        : Promise.resolve({ docs: [] });
    const sitesPromise = scope.clientId
      ? adminDb.collection("sites").where("clientId", "==", scope.clientId).get()
      : adminDb.collection("sites").where("clientName", "==", scope.clientName).get();
    const visitReportsPromise = scope.clientId
      ? adminDb.collection("foVisitReports").where("clientId", "==", scope.clientId).limit(80).get()
      : adminDb.collection("foVisitReports").where("clientName", "==", scope.clientName).limit(80).get();
    const trainingReportsPromise = scope.clientId
      ? adminDb.collection("foTrainingReports").where("clientId", "==", scope.clientId).limit(80).get()
      : adminDb.collection("foTrainingReports").where("clientName", "==", scope.clientName).limit(80).get();

    const [
      employeesSnapshot,
      attendanceSnapshot,
      workOrdersSnapshot,
      sitesSnapshot,
      visitReportsSnapshot,
      trainingReportsSnapshot,
    ] = await Promise.all([
      employeesPromise,
      attendancePromise,
      workOrdersPromise,
      sitesPromise,
      visitReportsPromise,
      trainingReportsPromise,
    ]);

    const employees = employeesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    })) as DashboardRecord[];

    const totalGuards = employees.length;
    const activeGuards = employees.filter((employee) => employee.status === "Active").length;
    const inactiveGuards = employees.filter(
      (employee) => employee.status === "Inactive" || employee.status === "Exited",
    ).length;

    const guardHighlights: ClientDashboardGuardHighlight[] = employees
      .map((employee) => ({
        id: String(employee.id),
        fullName: normalizeText(employee.fullName || employee.name || employee.employeeId || "Guard"),
        employeeId: normalizeText(employee.employeeId),
        district: normalizeText(employee.district),
        status: normalizeText(employee.status || "Unknown"),
        profilePictureUrl:
          typeof employee.profilePictureUrl === "string" ? employee.profilePictureUrl : null,
      }))
      .sort((left, right) => left.fullName.localeCompare(right.fullName))
      .slice(0, 6);

    const attendanceLogs = attendanceSnapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as Record<string, unknown>),
      }) as DashboardRecord)
      .filter((log) => matchesClientScope(log, scope))
      .sort((left, right) => {
        const leftIso = serializeDate(left.createdAt) ?? serializeDate(left.reportedAt) ?? "";
        const rightIso = serializeDate(right.createdAt) ?? serializeDate(right.reportedAt) ?? "";
        return new Date(rightIso).getTime() - new Date(leftIso).getTime();
      });

    const todayLogs = attendanceLogs.filter((log) => {
      if (typeof log.attendanceDate === "string" && log.attendanceDate.trim()) {
        return normalizeText(log.attendanceDate) === todayKey;
      }
      return isTodayInIst(log.createdAt ?? log.reportedAt, todayKey);
    });

    const latestByEmployee = new Map<string, Record<string, unknown>>();
    const seenIn = new Set<string>();
    const seenOut = new Set<string>();

    for (const log of todayLogs) {
      const employeeId = normalizeText(log.employeeId || log.employeeDocId || log.employeeName);
      if (!employeeId) continue;
      if (log.status === "In") seenIn.add(employeeId);
      if (log.status === "Out") seenOut.add(employeeId);

      const previous = latestByEmployee.get(employeeId);
      const previousMs = previous
        ? new Date(
            serializeDate(previous.createdAt) ??
              serializeDate(previous.reportedAt) ??
              serializeDate(previous.reportedAtClient) ??
              0,
          ).getTime()
        : 0;
      const currentMs = new Date(
        serializeDate(log.createdAt) ??
          serializeDate(log.reportedAt) ??
          serializeDate(log.reportedAtClient) ??
          0,
      ).getTime();
      if (!previous || currentMs >= previousMs) {
        latestByEmployee.set(employeeId, log);
      }
    }

    let onDutyNow = 0;
    for (const latest of latestByEmployee.values()) {
      if (latest.status === "In") onDutyNow += 1;
    }

    const liveAttendance: ClientDashboardLiveAttendanceRow[] = todayLogs
      .slice(0, 12)
      .map((log) => ({
        id: String(log.id),
        employeeId: normalizeText(log.employeeId),
        employeeName: normalizeText(log.employeeName || log.employeeId || "Guard"),
        status: log.status === "Out" ? "Out" : "In",
        siteId: normalizeText(log.siteId),
        siteName: normalizeText(log.siteName || log.locationText || "Site"),
        dutyPointName: normalizeText(log.dutyPointName),
        shiftLabel: normalizeText(log.shiftLabel),
        reportedAt:
          serializeDate(log.reportedAt) ??
          serializeDate(log.createdAt) ??
          serializeDate(log.reportedAtClient),
      }));

    const workOrders = workOrdersSnapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as Record<string, unknown>),
      }) as DashboardRecord)
      .filter((row) => matchesClientScope(row, scope))
      .filter((row) => isOperationalWorkOrderClientName(String(row.clientName ?? "")))
      .filter((row) => normalizeText(row.recordStatus || "active").toLowerCase() === "active");

    const upcomingWorkOrders: ClientDashboardWorkOrderRow[] = workOrders
      .map((row) => {
        const dateIso = serializeDate(row.date);
        return {
          id: String(row.id),
          siteId: normalizeText(row.siteId),
          siteName: normalizeText(row.siteName || "Site"),
          district: normalizeText(row.district),
          examName: normalizeText(row.examName || row.examCode || "Duty"),
          date: dateIso,
          totalManpower:
            typeof row.totalManpower === "number"
              ? row.totalManpower
              : Number(row.maleGuardsRequired ?? 0) + Number(row.femaleGuardsRequired ?? 0),
          assignedCount: Array.isArray(row.assignedGuards) ? row.assignedGuards.length : 0,
        };
      })
      .filter((row) => {
        if (!row.date) return false;
        const date = new Date(row.date);
        return !Number.isNaN(date.getTime()) && date >= today;
      })
      .sort((left, right) => new Date(left.date ?? 0).getTime() - new Date(right.date ?? 0).getTime());

    const deploymentsToday = upcomingWorkOrders
      .filter((row) => row.date && IST_DATE_FORMATTER.format(new Date(row.date)) === todayKey)
      .reduce((sum, row) => sum + row.totalManpower, 0);

    const sites = sitesSnapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as Record<string, unknown>),
      }) as DashboardRecord)
      .filter((site) => matchesClientScope(site, scope));

    const attendanceBySite = new Map<string, { checkedIn: Set<string>; onDuty: Set<string> }>();
    const attendanceByDutyPoint = new Map<string, { checkedIn: Set<string>; onDuty: Set<string> }>();
    const attendanceByDutyPointShift = new Map<
      string,
      Map<string, { code: string; label: string; checkedIn: Set<string>; onDuty: Set<string> }>
    >();
    for (const log of todayLogs) {
      const siteKey = normalizeText(log.siteId || log.siteName || log.locationText);
      if (!siteKey) continue;
      if (!attendanceBySite.has(siteKey)) {
        attendanceBySite.set(siteKey, { checkedIn: new Set<string>(), onDuty: new Set<string>() });
      }
      const entry = attendanceBySite.get(siteKey)!;
      const employeeId = normalizeText(log.employeeId || log.employeeDocId || log.employeeName);
      if (log.status === "In") {
        entry.checkedIn.add(employeeId);
      }
      const dutyKey = `${siteKey}::${normalizeText(log.dutyPointId || log.dutyPointName)}`;
      if (!attendanceByDutyPoint.has(dutyKey)) {
        attendanceByDutyPoint.set(dutyKey, { checkedIn: new Set<string>(), onDuty: new Set<string>() });
      }
      if (log.status === "In") {
        attendanceByDutyPoint.get(dutyKey)!.checkedIn.add(employeeId);
      }
      const shiftCode = normalizeText(log.shiftCode);
      const shiftLabel = normalizeText(log.shiftLabel || shiftCode || "Shift");
      if (shiftCode || shiftLabel) {
        if (!attendanceByDutyPointShift.has(dutyKey)) {
          attendanceByDutyPointShift.set(dutyKey, new Map());
        }
        const shiftMap = attendanceByDutyPointShift.get(dutyKey)!;
        const shiftKey = shiftCode || shiftLabel;
        if (!shiftMap.has(shiftKey)) {
          shiftMap.set(shiftKey, {
            code: shiftCode || shiftKey,
            label: shiftLabel || shiftKey,
            checkedIn: new Set<string>(),
            onDuty: new Set<string>(),
          });
        }
        if (log.status === "In") {
          shiftMap.get(shiftKey)!.checkedIn.add(employeeId);
        }
      }
    }

    for (const [employeeId, log] of latestByEmployee.entries()) {
      const siteKey = normalizeText(log.siteId || log.siteName || log.locationText);
      if (!siteKey || log.status !== "In") continue;
      if (!attendanceBySite.has(siteKey)) {
        attendanceBySite.set(siteKey, { checkedIn: new Set<string>(), onDuty: new Set<string>() });
      }
      attendanceBySite.get(siteKey)!.onDuty.add(employeeId);
      const dutyKey = `${siteKey}::${normalizeText(log.dutyPointId || log.dutyPointName)}`;
      if (!attendanceByDutyPoint.has(dutyKey)) {
        attendanceByDutyPoint.set(dutyKey, { checkedIn: new Set<string>(), onDuty: new Set<string>() });
      }
      attendanceByDutyPoint.get(dutyKey)!.onDuty.add(employeeId);
      const shiftCode = normalizeText(log.shiftCode);
      const shiftLabel = normalizeText(log.shiftLabel || shiftCode || "Shift");
      if (shiftCode || shiftLabel) {
        if (!attendanceByDutyPointShift.has(dutyKey)) {
          attendanceByDutyPointShift.set(dutyKey, new Map());
        }
        const shiftMap = attendanceByDutyPointShift.get(dutyKey)!;
        const shiftKey = shiftCode || shiftLabel;
        if (!shiftMap.has(shiftKey)) {
          shiftMap.set(shiftKey, {
            code: shiftCode || shiftKey,
            label: shiftLabel || shiftKey,
            checkedIn: new Set<string>(),
            onDuty: new Set<string>(),
          });
        }
        shiftMap.get(shiftKey)!.onDuty.add(employeeId);
      }
    }

    const workOrdersBySite = new Map<
      string,
      { upcomingDuties: number; nextDutyDate: string | null }
    >();
    for (const duty of upcomingWorkOrders) {
      const siteKey = normalizeText(duty.siteId || duty.siteName);
      if (!siteKey) continue;
      const current = workOrdersBySite.get(siteKey) ?? { upcomingDuties: 0, nextDutyDate: null };
      current.upcomingDuties += 1;
      if (!current.nextDutyDate || (duty.date && new Date(duty.date) < new Date(current.nextDutyDate))) {
        current.nextDutyDate = duty.date;
      }
      workOrdersBySite.set(siteKey, current);
    }

    const siteSnapshots: ClientDashboardSiteSnapshot[] = sites
      .map((site) => {
        const siteKey = normalizeText(site.id || site.siteId || site.siteName);
        const attendance = attendanceBySite.get(siteKey) ?? { checkedIn: new Set<string>(), onDuty: new Set<string>() };
        const duty = workOrdersBySite.get(siteKey) ?? { upcomingDuties: 0, nextDutyDate: null };
        const dutyPoints = resolveSiteDutyPoints(site as any);
        const dutyPointSnapshots: ClientDashboardDutyPointSnapshot[] = dutyPoints.map((point) => {
          const pointKey = `${siteKey}::${normalizeText(point.id || point.name)}`;
          const pointAttendance = attendanceByDutyPoint.get(pointKey) ?? {
            checkedIn: new Set<string>(),
            onDuty: new Set<string>(),
          };
          const shiftAttendance = attendanceByDutyPointShift.get(pointKey);
          const activeShift = resolveSiteShift(point.shiftMode, point.shiftTemplates, today);
          return {
            id: point.id,
            name: point.name,
            checkedInToday: pointAttendance.checkedIn.size,
            onDutyNow: pointAttendance.onDuty.size,
            activeShiftLabel: activeShift?.label ?? null,
            shifts:
              shiftAttendance && shiftAttendance.size > 0
                ? Array.from(shiftAttendance.values())
                    .map((shift) => ({
                      code: shift.code,
                      label: shift.label,
                      checkedInToday: shift.checkedIn.size,
                      onDutyNow: shift.onDuty.size,
                    }))
                    .sort((left, right) => right.onDutyNow - left.onDutyNow || left.label.localeCompare(right.label))
                : [],
          };
        });
        return {
          siteId: normalizeText(site.id || site.siteId),
          siteName: normalizeText(site.siteName || "Site"),
          district: normalizeText(site.district),
          checkedInToday: attendance.checkedIn.size,
          onDutyNow: attendance.onDuty.size,
          upcomingDuties: duty.upcomingDuties,
          nextDutyDate: duty.nextDutyDate,
          dutyPoints: dutyPointSnapshots,
        };
      })
      .sort((left, right) => {
        if (right.onDutyNow !== left.onDutyNow) return right.onDutyNow - left.onDutyNow;
        return left.siteName.localeCompare(right.siteName);
      })
      .slice(0, 8);

    const visitReports = sortByDateDesc(
      visitReportsSnapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...(doc.data() as Record<string, unknown>),
        }) as DashboardRecord)
        .filter((row) => matchesClientScope(row, scope))
        .map<ClientDashboardVisitReportRow>((row) => ({
          id: String(row.id),
          fieldOfficerName: normalizeText(row.fieldOfficerName || "Field Officer"),
          siteName: normalizeText(row.siteName || "Site"),
          district: normalizeText(row.district),
          visitDate: serializeDate(row.visitDate),
          createdAt: serializeDate(row.createdAt),
          status: normalizeText(row.status || "submitted"),
          summary: normalizeText(row.summary),
        })),
      (row) => row.createdAt ?? row.visitDate,
    ).slice(0, 6);

    const trainingReports = sortByDateDesc(
      trainingReportsSnapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...(doc.data() as Record<string, unknown>),
        }) as DashboardRecord)
        .filter((row) => matchesClientScope(row, scope))
        .map<ClientDashboardTrainingReportRow>((row) => ({
          id: String(row.id),
          fieldOfficerName: normalizeText(row.fieldOfficerName || "Field Officer"),
          siteName: normalizeText(row.siteName || "Site"),
          district: normalizeText(row.district),
          trainingDate: serializeDate(row.trainingDate),
          createdAt: serializeDate(row.createdAt),
          status: normalizeText(row.status || "submitted"),
          topic: normalizeText(row.topic || "Training"),
          attendeeCount: Number(row.attendeeCount ?? 0),
        })),
      (row) => row.createdAt ?? row.trainingDate,
    ).slice(0, 6);

    const payload: ClientDashboardPayload = {
      summary: {
        clientId: scope.clientId,
        clientName: scope.clientName,
        totalGuards,
        activeGuards,
        inactiveGuards,
        checkedInToday: seenIn.size,
        checkedOutToday: seenOut.size,
        onDutyNow,
        sitesCovered: sites.length,
        deploymentsToday,
        upcomingDuties: upcomingWorkOrders.filter((row) => {
          if (!row.date) return false;
          const date = new Date(row.date);
          return !Number.isNaN(date.getTime()) && date <= next14Days;
        }).length,
        pendingVisitReports: visitReports.filter((row) => row.status !== "reviewed").length,
        pendingTrainingReports: trainingReports.filter((row) => row.status !== "acknowledged").length,
      },
      liveAttendance,
      siteSnapshots,
      upcomingWorkOrders: upcomingWorkOrders.slice(0, 8),
      recentVisitReports: visitReports,
      recentTrainingReports: trainingReports,
      guardHighlights,
      dashboardModules,
    };

    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load client dashboard.";
    return unauthorizedResponse(message, 401);
  }
}
