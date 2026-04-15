import type { Firestore } from "firebase-admin/firestore";

export interface AttendanceSummary {
  presentDays: number;
  workingDays: number;
  lopDays: number;
  overtimeHours: number;
}

const STANDARD_WORKING_HOURS = 8;

export async function aggregateAttendance(
  employeeDocId: string,
  period: string,
  adminDb: Firestore
): Promise<AttendanceSummary> {
  const [year, month] = period.split("-").map(Number);

  const monthPadded = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  const startDateStr = `${year}-${monthPadded}-01`;
  const endDateStr = `${year}-${monthPadded}-${String(lastDay).padStart(2, "0")}`;

  const snapshot = await adminDb
    .collection("attendanceLogs")
    .where("employeeDocId", "==", employeeDocId)
    .where("attendanceDate", ">=", startDateStr)
    .where("attendanceDate", "<=", endDateStr)
    .get();

  type LogEntry = {
    attendanceDate: string;
    status: string;
    reportedAt?: { seconds?: number; nanoseconds?: number; toDate?: () => Date };
    createdAt?: { seconds?: number; nanoseconds?: number; toDate?: () => Date };
  };

  const logsByDate = new Map<string, { inTime: Date | null; outTime: Date | null }>();

  snapshot.docs.forEach((d) => {
    const data = d.data() as LogEntry;

    let dateStr = data.attendanceDate as string | undefined;
    if (!dateStr) {
      const ts = data.createdAt;
      if (!ts) return;
      const date = ts?.toDate ? ts.toDate() : new Date(ts as unknown as Date);
      const y = date.getFullYear();
      const mo = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      if (`${y}-${mo}` === `${year}-${monthPadded}`) {
        dateStr = `${y}-${mo}-${dd}`;
      }
    }
    if (!dateStr) return;

    const existing = logsByDate.get(dateStr) ?? { inTime: null, outTime: null };

    const timestampToDate = (ts: LogEntry["reportedAt"]): Date | null => {
      if (!ts) return null;
      if (typeof ts.toDate === "function") return ts.toDate();
      if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000);
      return null;
    };

    if (data.status === "In") {
      const inTime = timestampToDate(data.reportedAt);
      if (!existing.inTime || (inTime && inTime < existing.inTime)) {
        existing.inTime = inTime;
      }
    } else if (data.status === "Out") {
      const outTime = timestampToDate(data.reportedAt);
      if (!existing.outTime || (outTime && outTime > existing.outTime)) {
        existing.outTime = outTime;
      }
    }

    logsByDate.set(dateStr, existing);
  });

  const presentSet = new Set<string>();
  let totalOvertimeHours = 0;

  logsByDate.forEach((entry, dateStr) => {
    if (entry.inTime) {
      presentSet.add(dateStr);
    }

    if (entry.inTime && entry.outTime) {
      const hoursWorked = (entry.outTime.getTime() - entry.inTime.getTime()) / (1000 * 60 * 60);
      if (hoursWorked > STANDARD_WORKING_HOURS) {
        totalOvertimeHours += hoursWorked - STANDARD_WORKING_HOURS;
      }
    }
  });

  const daysInMonth = lastDay;
  let sundays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month - 1, day).getDay() === 0) sundays++;
  }
  const workingDays = daysInMonth - sundays;
  const presentDays = Math.min(presentSet.size, workingDays);
  const lopDays = Math.max(0, workingDays - presentDays);

  return { presentDays, workingDays, lopDays, overtimeHours: Math.round(totalOvertimeHours * 100) / 100 };
}
