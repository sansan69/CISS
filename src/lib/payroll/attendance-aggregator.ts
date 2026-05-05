import type { Firestore } from "firebase-admin/firestore";

export interface AttendanceSummary {
  presentDays: number;
  workingDays: number;
}

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

  const presentDates = new Set<string>();

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

    if (data.status === "In") {
      presentDates.add(dateStr);
    }
  });

  const daysInMonth = lastDay;
  let sundays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month - 1, day).getDay() === 0) sundays++;
  }
  const workingDays = daysInMonth - sundays;
  const presentDays = Math.min(presentDates.size, workingDays);

  return { presentDays, workingDays };
}
