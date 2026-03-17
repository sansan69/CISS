import type { Firestore } from "firebase-admin/firestore";

export interface AttendanceSummary {
  presentDays: number;
  workingDays: number;
  lopDays: number;
  overtimeHours: number;
}

/**
 * Aggregate attendance for an employee in a given period (YYYY-MM).
 * workingDays = calendar days in month minus Sundays (approx 26).
 * presentDays = distinct dates employee checked In.
 * lopDays = workingDays - presentDays (capped at 0).
 */
export async function aggregateAttendance(
  employeeId: string,
  period: string, // YYYY-MM
  adminDb: Firestore
): Promise<AttendanceSummary> {
  const [year, month] = period.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59); // last day of month

  const { Timestamp } = await import("firebase-admin/firestore");
  const snapshot = await adminDb
    .collection("attendanceLogs")
    .where("employeeId", "==", employeeId)
    .where("createdAt", ">=", Timestamp.fromDate(start))
    .where("createdAt", "<=", Timestamp.fromDate(end))
    .where("status", "==", "In")
    .get();

  const presentSet = new Set<string>();
  snapshot.docs.forEach((d) => {
    const ts = d.data().createdAt;
    const date = ts?.toDate ? ts.toDate() : new Date(ts);
    presentSet.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
  });

  // Working days = total days in month minus Sundays
  const daysInMonth = new Date(year, month, 0).getDate();
  let sundays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month - 1, day).getDay() === 0) sundays++;
  }
  const workingDays = daysInMonth - sundays;
  const presentDays = Math.min(presentSet.size, workingDays);
  const lopDays = Math.max(0, workingDays - presentDays);

  return { presentDays, workingDays, lopDays, overtimeHours: 0 };
}
