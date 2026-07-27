import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";

function normalizeTimestamp(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof ts === "string") {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === "object" && ts !== null && "toDate" in ts) {
    return (ts as Timestamp).toDate();
  }
  return null;
}

export interface AttendanceSummary {
  presentDays: number;
  workingDays: number;
}

export async function aggregateAttendance(
  employeeDocId: string,
  period: string,
  adminDb: Firestore,
  options: { holidays?: string[] } = {},
): Promise<AttendanceSummary> {
  const [year, month] = period.split("-").map(Number);

  const monthPadded = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  const startDateStr = `${year}-${monthPadded}-01`;
  const endDateStr = `${year}-${monthPadded}-${String(lastDay).padStart(2, "0")}`;

  // Primary query: by employeeDocId
  let snapshot = await adminDb
    .collection("attendanceLogs")
    .where("employeeDocId", "==", employeeDocId)
    .where("attendanceDate", ">=", startDateStr)
    .where("attendanceDate", "<=", endDateStr)
    .get();

  // Fallback: some legacy logs may only have employeeId, not employeeDocId.
  // If the primary query returns empty, look up the employee's employeeId
  // and retry with that field.
  //
  // NOTE: This fallback is redundant — it performs an extra query per employee
  // when employeeDocId is missing. Backfilling employeeDocId on legacy logs
  // (via a one-time migration that copies employeeId → employeeDocId on each
  // attendanceLog document) would eliminate this branch entirely.
  if (snapshot.empty) {
    const employeeSnap = await adminDb
      .collection("employees")
      .doc(employeeDocId)
      .get();
    const employeeData = employeeSnap.data() as Record<string, any> | undefined;
    const employeeId = employeeData?.employeeId as string | undefined;

    if (employeeId) {
      snapshot = await adminDb
        .collection("attendanceLogs")
        .where("employeeId", "==", employeeId)
        .where("attendanceDate", ">=", startDateStr)
        .where("attendanceDate", "<=", endDateStr)
        .get();
    }
  }

  type LogEntry = {
    attendanceDate: string;
    status: string;
    reportedAt?: { seconds?: number; nanoseconds?: number; toDate?: () => Date };
    createdAt?: { seconds?: number; nanoseconds?: number; toDate?: () => Date };
  };

  const presentDates = new Set<string>();

  snapshot.docs.forEach((d) => {
    const data = d.data() as LogEntry;

    // Count any date with at least one attendance log as "present".
    // Previously only counted status === "In", which missed guards who
    // only had checkout logs or whose IN log was in a different batch.
    let dateStr = data.attendanceDate as string | undefined;
    if (!dateStr) {
      const ts = data.createdAt;
      if (!ts) return;
      const date = normalizeTimestamp(ts);
      if (!date) return;
      const y = date.getFullYear();
      const mo = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      if (`${y}-${mo}` === `${year}-${monthPadded}`) {
        dateStr = `${y}-${mo}-${dd}`;
      }
    }
    if (!dateStr) return;

    presentDates.add(dateStr);
  });

  const daysInMonth = lastDay;
  const holidayDates = new Set(
    (options.holidays ?? []).filter((date) =>
      date >= startDateStr && date <= endDateStr,
    ),
  );
  let nonWorkingDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${monthPadded}-${String(day).padStart(2, "0")}`;
    const isSunday = new Date(year, month - 1, day).getDay() === 0;
    if (isSunday || holidayDates.has(dateStr)) nonWorkingDays++;
  }
  const workingDays = daysInMonth - nonWorkingDays;
  const presentDays = Math.min(presentDates.size, workingDays);

  return { presentDays, workingDays };
}
