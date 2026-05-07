import { NextResponse } from "next/server";

import { resolveSiteDutyPoints, resolveShiftByCode } from "@/lib/shift-utils";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
import {
  buildPatrolActivityPayload,
  computeHourlyNightPatrolState,
  parseDate,
  resolveDutyPointPatrolPoints,
  resolvePatrolSettings,
  toGuardPatrolActivityRow,
} from "@/lib/patrol";
import { buildServerCreateAudit } from "@/lib/server/audit";

type AttendanceRecord = Record<string, unknown> & { id: string };

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatRelativeIstLabel(value: Date | null) {
  if (!value) return null;
  return value.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function loadGuardContext(request: Request) {
  const guard = await requireGuard(request);
  const { db: adminDb } = await import("@/lib/firebaseAdmin");

  const employeeDoc = await adminDb.collection("employees").doc(guard.employeeDocId).get();
  if (!employeeDoc.exists) {
    return { error: NextResponse.json({ error: "Employee not found." }, { status: 404 }) };
  }

  const employee = employeeDoc.data() as Record<string, unknown>;
  const clientId = normalizeText(employee.clientId);
  const clientName = normalizeText(employee.clientName);
  if (!clientName) {
    return { error: NextResponse.json({ error: "Client assignment is missing." }, { status: 400 }) };
  }

  let clientDoc = clientId
    ? await adminDb.collection("clients").doc(clientId).get()
    : null;
  if ((!clientDoc || !clientDoc.exists) && clientName) {
    const clientLookup = await adminDb
      .collection("clients")
      .where("name", "==", clientName)
      .limit(1)
      .get();
    clientDoc = clientLookup.docs[0] ?? null;
  }

  const patrolSettings = resolvePatrolSettings(
    clientDoc?.exists ? clientDoc.data()?.patrolSettings : null,
  );

  return {
    adminDb,
    guard,
    employee,
    clientId: clientDoc?.id ?? clientId,
    clientName,
    patrolSettings,
  };
}

export async function GET(request: Request) {
  try {
    const context = await loadGuardContext(request);
    if ("error" in context) return context.error;

    const {
      adminDb,
      employee,
      guard,
      clientId,
      clientName,
      patrolSettings,
    } = context;

    let attendanceSnap = await adminDb
      .collection("attendanceLogs")
      .where("employeeDocId", "==", guard.employeeDocId)
      .limit(50)
      .get();
    if (attendanceSnap.empty) {
      attendanceSnap = await adminDb
        .collection("attendanceLogs")
        .where("employeeId", "==", guard.employeeId)
        .limit(50)
        .get();
    }

    const latestAttendance = attendanceSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
      .map((row) => row as AttendanceRecord)
      .sort((left, right) => {
        const leftAt =
          parseDate(left.reportedAt) ??
          parseDate(left.createdAt) ??
          parseDate(left.reportedAtClient) ??
          new Date(0);
        const rightAt =
          parseDate(right.reportedAt) ??
          parseDate(right.createdAt) ??
          parseDate(right.reportedAtClient) ??
          new Date(0);
        return rightAt.getTime() - leftAt.getTime();
      })[0] as AttendanceRecord | undefined;

    const guardName = normalizeText(
      employee.fullName ||
        employee.name ||
        [employee.firstName, employee.lastName].filter(Boolean).join(" "),
    ) || guard.employeeId;

    let activeDuty: {
      siteId: string;
      siteName: string;
      district: string;
      dutyPointId?: string;
      dutyPointName?: string;
      shiftCode?: string;
      shiftLabel?: string;
      checkedInAt: string | null;
      activeSinceLabel: string | null;
    } | null = null;

    let patrolPoints = [] as ReturnType<typeof resolveDutyPointPatrolPoints>;
    let shift = null as ReturnType<typeof resolveShiftByCode>;

    if (latestAttendance && normalizeText(latestAttendance.status) === "In") {
      const siteId = normalizeText(latestAttendance.siteId);
      const siteDoc = siteId
        ? await adminDb.collection("sites").doc(siteId).get()
        : null;
      const siteData = siteDoc?.exists ? (siteDoc.data() as Record<string, unknown>) : null;
      const dutyPoints = resolveSiteDutyPoints(siteData ?? {});
      const dutyPoint = dutyPoints.find(
        (point) => point.id === normalizeText(latestAttendance.dutyPointId),
      );
      patrolPoints = resolveDutyPointPatrolPoints(dutyPoint);
      shift = resolveShiftByCode(
        dutyPoint?.shiftMode,
        dutyPoint?.shiftTemplates,
        normalizeText(latestAttendance.shiftCode) || null,
      );
      const checkedInAt =
        parseDate(latestAttendance.reportedAt) ??
        parseDate(latestAttendance.createdAt) ??
        parseDate(latestAttendance.reportedAtClient);

      activeDuty = {
        siteId,
        siteName: normalizeText(latestAttendance.siteName || siteData?.siteName),
        district: normalizeText(latestAttendance.district || siteData?.district),
        dutyPointId: dutyPoint?.id,
        dutyPointName: dutyPoint?.name,
        shiftCode: normalizeText(latestAttendance.shiftCode) || shift?.code,
        shiftLabel: normalizeText(latestAttendance.shiftLabel) || shift?.label,
        checkedInAt: checkedInAt?.toISOString() ?? null,
        activeSinceLabel: formatRelativeIstLabel(checkedInAt),
      };
    }

    const activitiesSnapshot = await adminDb
      .collection("guardPatrolActivities")
      .where("employeeDocId", "==", guard.employeeDocId)
      .limit(80)
      .get();

    const activities = activitiesSnapshot.docs
      .map((doc) => toGuardPatrolActivityRow(doc.id, doc.data() as Record<string, unknown>))
      .sort((left, right) => {
        const leftAt = parseDate(left.activityAt ?? left.createdAt) ?? new Date(0);
        const rightAt = parseDate(right.activityAt ?? right.createdAt) ?? new Date(0);
        return rightAt.getTime() - leftAt.getTime();
      });

    const lastHourlyActivity = activities.find((item) => item.type === "hourly_photo");
    const hourlyRequirement = computeHourlyNightPatrolState({
      settings: patrolSettings,
      checkedInAt: parseDate(activeDuty?.checkedInAt),
      lastHourlyActivityAt: parseDate(lastHourlyActivity?.activityAt),
      shift,
    });

    return NextResponse.json({
      enabled: patrolSettings.enabled,
      settings: patrolSettings,
      guardName,
      employeeId: guard.employeeId,
      clientId,
      clientName,
      activeDuty,
      patrolPoints,
      hourlyRequirement: {
        enabled: hourlyRequirement.enabled,
        dueNow: hourlyRequirement.dueNow,
        nextDueAt: hourlyRequirement.nextDueAt?.toISOString() ?? null,
        overdueMinutes: hourlyRequirement.overdueMinutes,
        lastSubmittedAt: hourlyRequirement.lastSubmittedAt?.toISOString() ?? null,
        nightWindowLabel: `${patrolSettings.nightWindowStart} - ${patrolSettings.nightWindowEnd}`,
      },
      recentActivities: activities.slice(0, 12),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return unauthorizedResponse(message);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await loadGuardContext(request);
    if ("error" in context) return context.error;

    const { adminDb, employee, guard, clientId, clientName, patrolSettings } = context;
    if (!patrolSettings.enabled) {
      return NextResponse.json({ error: "Patrol monitoring is not enabled for this client." }, { status: 403 });
    }

    const body = (await request.json()) as {
      type?: "patrol" | "hourly_photo";
      siteId?: string;
      dutyPointId?: string;
      shiftCode?: string;
      photoUrl?: string;
      patrolPointId?: string;
      notes?: string;
      activityAt?: string;
    };

    const type = body.type === "hourly_photo" ? "hourly_photo" : "patrol";
    const siteId = normalizeText(body.siteId);
    if (!siteId) {
      return NextResponse.json({ error: "Site selection is required." }, { status: 400 });
    }

    const siteDoc = await adminDb.collection("sites").doc(siteId).get();
    if (!siteDoc.exists) {
      return NextResponse.json({ error: "Site not found." }, { status: 404 });
    }
    const site = siteDoc.data() as Record<string, unknown>;
    if (
      (clientId && normalizeText(site.clientId) && normalizeText(site.clientId) !== clientId) ||
      (!clientId && normalizeText(site.clientName) !== clientName)
    ) {
      return NextResponse.json({ error: "This site is outside your client scope." }, { status: 403 });
    }

    const dutyPoints = resolveSiteDutyPoints(site);
    const dutyPoint = dutyPoints.find((point) => point.id === normalizeText(body.dutyPointId));
    const patrolPoints = resolveDutyPointPatrolPoints(dutyPoint);
    const patrolPoint = patrolPoints.find((point) => point.id === normalizeText(body.patrolPointId));
    const shift = resolveShiftByCode(
      dutyPoint?.shiftMode,
      dutyPoint?.shiftTemplates,
      normalizeText(body.shiftCode) || null,
    );

    const photoUrl = normalizeText(body.photoUrl);
    if ((type === "hourly_photo" || patrolSettings.photoRequiredForPatrol || patrolPoint?.requiresPhoto) && !photoUrl) {
      return NextResponse.json({ error: "A photo is required for this submission." }, { status: 400 });
    }
    if (type === "patrol" && patrolPoints.length > 0 && !patrolPoint) {
      return NextResponse.json({ error: "Select the patrol point you completed." }, { status: 400 });
    }

    const payload = buildPatrolActivityPayload({
      type,
      clientId,
      clientName,
      siteId,
      siteName: normalizeText(site.siteName),
      district: normalizeText(site.district),
      employeeId: guard.employeeId,
      employeeDocId: guard.employeeDocId,
      guardName:
        normalizeText(employee.fullName || employee.name || guard.employeeId) || guard.employeeId,
      dutyPointId: dutyPoint?.id,
      dutyPointName: dutyPoint?.name,
      shiftCode: normalizeText(body.shiftCode) || shift?.code,
      shiftLabel: shift?.label ?? null,
      patrolPointId: patrolPoint?.id,
      patrolPointName: patrolPoint?.name,
      patrolPointDescription: patrolPoint?.description,
      photoUrl,
      notes: body.notes,
      source: "android",
      activityAt: body.activityAt ? new Date(body.activityAt) : new Date(),
    });

    const docRef = await adminDb.collection("guardPatrolActivities").add({
      ...payload,
      ...buildServerCreateAudit({
        uid: guard.uid,
        email: typeof employee.emailAddress === "string" ? employee.emailAddress : null,
      }),
    });

    return NextResponse.json({
      ok: true,
      activityId: docRef.id,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return unauthorizedResponse(message);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
