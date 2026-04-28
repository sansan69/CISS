import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
import { OPERATIONAL_CLIENT_NAME } from "@/lib/constants";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";

function workingDaysInMonth(year: number, month: number): number {
  // Approximate: count days excluding Sundays
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month, d).getDay();
    if (day !== 0) count++; // 0 = Sunday
  }
  return count;
}

function toISTTimeString(ts: FirebaseFirestore.Timestamp | null | undefined): string {
  if (!ts) return "";
  const date = ts.toDate();
  return date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getWorkOrderTimestampValue(value: unknown): number {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime();
  }

  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    const converted = (value as { toDate?: () => Date }).toDate?.();
    if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
      return converted.getTime();
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
  }

  return Number.NaN;
}

function isAssignedToGuard(
  assignedGuards: unknown,
  employeeDocId: string,
  employeeId: string,
) {
  if (!Array.isArray(assignedGuards)) {
    return false;
  }

  return assignedGuards.some((guard) => {
    if (typeof guard === "string") {
      return guard === employeeDocId || guard === employeeId;
    }

    if (!guard || typeof guard !== "object") {
      return false;
    }

    const maybeGuard = guard as { uid?: string; employeeId?: string };
    return maybeGuard.uid === employeeDocId || maybeGuard.employeeId === employeeId;
  });
}

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // Fetch employee doc
    const empDoc = await adminDb.doc(`employees/${guard.employeeDocId}`).get();
    if (!empDoc.exists) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    const empData = empDoc.data()!;

    const employeeName: string = empData.name ?? "";
    const clientName: string = empData.clientName ?? "";
    const district: string = empData.district ?? "";
    const profilePhotoUrl: string | null = empData.profilePhotoUrl ?? null;

    // ─── This month's attendance ───────────────────────────────────────────
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed
    const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;

    const lastDay = new Date(year, month + 1, 0).getDate();
    const startDateStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const endDateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    let attendanceSnap = await adminDb
      .collection("attendanceLogs")
      .where("employeeDocId", "==", guard.employeeDocId)
      .limit(200)
      .get();

    if (attendanceSnap.empty) {
      attendanceSnap = await adminDb
        .collection("attendanceLogs")
        .where("employeeId", "==", guard.employeeId)
        .limit(200)
        .get();
    }

    const logs = attendanceSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
      id: string;
      attendanceDate: string;
      status: string;
      siteName?: string;
      reportedAt?: FirebaseFirestore.Timestamp;
      distanceMeters?: number;
      shiftLabel?: string;
    }>;

    const filteredLogs = logs
      .filter(
        (log) =>
          typeof log.attendanceDate === "string" &&
          log.attendanceDate >= startDateStr &&
          log.attendanceDate <= endDateStr,
      )
      .sort((a, b) => (b.attendanceDate || "").localeCompare(a.attendanceDate || ""));

    // Count unique present days (days with at least one "In" log)
    const presentDates = new Set(
      filteredLogs.filter((l) => l.status === "In").map((l) => l.attendanceDate)
    );
    const presentDays = presentDates.size;
    const workingDays = workingDaysInMonth(year, month);
    const absentDays = Math.max(0, workingDays - presentDays);

    // Recent 5 logs
    const recentAttendance = filteredLogs.slice(0, 5).map((l) => ({
      id: l.id,
      date: l.attendanceDate ?? "",
      status: l.status as "In" | "Out",
      siteName: l.siteName ?? "",
      time: toISTTimeString(l.reportedAt ?? undefined),
    }));

    // ─── Leave balance ─────────────────────────────────────────────────────
    const leaveBalanceKey = `${guard.employeeDocId}_${year}`;
    const leaveDoc = await adminDb.doc(`leaveBalances/${leaveBalanceKey}`).get();
    let leaveBalance = null;
    if (leaveDoc.exists) {
      const lb = leaveDoc.data()!;
      leaveBalance = {
        casual: {
          entitled: lb.casualEntitled ?? 12,
          taken: lb.casualTaken ?? 0,
          balance: (lb.casualEntitled ?? 12) - (lb.casualTaken ?? 0),
        },
        sick: {
          entitled: lb.sickEntitled ?? 6,
          taken: lb.sickTaken ?? 0,
          balance: (lb.sickEntitled ?? 6) - (lb.sickTaken ?? 0),
        },
        earned: {
          entitled: lb.earnedEntitled ?? 15,
          taken: lb.earnedTaken ?? 0,
          balance: (lb.earnedEntitled ?? 15) - (lb.earnedTaken ?? 0),
        },
      };
    }

    // ─── Latest evaluation ─────────────────────────────────────────────────
    let latestEvalScore: number | null = null;
    let latestEvalPeriod: string | null = null;
    try {
      let evalSnap = await adminDb
        .collection("evaluations")
        .where("employeeId", "==", guard.employeeDocId)
        .limit(20)
        .get();
      if (evalSnap.empty) {
        evalSnap = await adminDb
          .collection("evaluations")
          .where("employeeId", "==", guard.employeeId)
          .limit(20)
          .get();
      }
      if (!evalSnap.empty) {
        const evalData = evalSnap.docs
          .map((doc) => doc.data())
          .sort((a, b) => {
            const aSeconds = (a.createdAt as FirebaseFirestore.Timestamp | undefined)?.seconds ?? 0;
            const bSeconds = (b.createdAt as FirebaseFirestore.Timestamp | undefined)?.seconds ?? 0;
            return bSeconds - aSeconds;
          })[0];
        latestEvalScore =
          typeof evalData.normalizedScore === "number"
            ? evalData.normalizedScore
            : typeof evalData.score === "number"
              ? evalData.score
              : null;
        latestEvalPeriod =
          typeof evalData.period === "string" ? evalData.period : null;
      }
    } catch {
      // evaluations collection may not exist yet
    }

    // ─── Next shift ────────────────────────────────────────────────────────
    let nextShift: { date: string; siteName: string; clientName: string; shiftLabel?: string } | null = null;
    let nextShiftUnavailable = false;
    if (isOperationalWorkOrderClientName(clientName)) {
      try {
        const sevenDaysLater = new Date(now);
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

        const workOrderSnap = await adminDb
          .collection("workOrders")
          .where("clientName", "==", OPERATIONAL_CLIENT_NAME)
          .where("date", ">=", now)
          .where("date", "<=", sevenDaysLater)
          .get();

        const nextActiveWorkOrder = workOrderSnap.docs
          .map((doc) => doc.data())
          .filter((workOrder) => String(workOrder.recordStatus ?? "active").trim().toLowerCase() === "active")
          .filter((workOrder) =>
            isAssignedToGuard(workOrder.assignedGuards, guard.employeeDocId, guard.employeeId),
          )
          .sort(
            (left, right) =>
              getWorkOrderTimestampValue(left.date) - getWorkOrderTimestampValue(right.date),
          )[0];

        if (nextActiveWorkOrder) {
          const workOrderDate = getWorkOrderTimestampValue(nextActiveWorkOrder.date);
          nextShift = {
            date: Number.isFinite(workOrderDate)
              ? new Date(workOrderDate).toISOString()
              : "",
            siteName: nextActiveWorkOrder.siteName ?? "",
            clientName: nextActiveWorkOrder.clientName ?? clientName,
            shiftLabel: nextActiveWorkOrder.shiftLabel ?? undefined,
          };
        }
      } catch (err) {
        console.error("[guard/dashboard] nextShift query failed:", err);
        nextShiftUnavailable = true;
      }
    }

    return NextResponse.json({
      employeeName,
      employeeId: guard.employeeId,
      clientName,
      district,
      profilePhotoUrl,
      attendanceStats: { presentDays, absentDays, workingDays },
      leaveBalance,
      latestEvalScore,
      latestEvalPeriod,
      nextShift,
      nextShiftUnavailable,
      recentAttendance,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Guard access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[guard/dashboard]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
