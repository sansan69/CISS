import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

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
      .filter((log) => typeof log.attendanceDate === "string" && log.attendanceDate >= `${monthStr}-01`)
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
    let nextShift = null;
    try {
      const todayStr = now.toISOString().slice(0, 10);
      const sevenDaysLater = new Date(now);
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
      const sevenDaysStr = sevenDaysLater.toISOString().slice(0, 10);

      const workOrderSnap = await adminDb
        .collection("workOrders")
        .where("assignedGuards", "array-contains", guard.employeeDocId)
        .where("date", ">=", todayStr)
        .where("date", "<=", sevenDaysStr)
        .orderBy("date")
        .limit(1)
        .get();

      if (!workOrderSnap.empty) {
        const wo = workOrderSnap.docs[0].data();
        nextShift = {
          date: wo.date ?? "",
          siteName: wo.siteName ?? "",
          clientName: wo.clientName ?? clientName,
          shiftLabel: wo.shiftLabel ?? undefined,
        };
      }
    } catch {
      // workOrders may not exist or index missing
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
