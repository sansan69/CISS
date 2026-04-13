import type { Firestore } from "firebase-admin/firestore";

export interface AttendanceSummary {
  presentDays: number;
  workingDays: number;
  lopDays: number;
  overtimeHours: number;
}

/**
 * Aggregate attendance for an employee in a given period (YYYY-MM).
 * @param employeeDocId - Firestore document ID of the employee (employees/{id})
 * @param period - YYYY-MM
 * @param adminDb - Firestore admin instance
 *
 * Queries attendanceLogs using `employeeDocId` (Firestore doc ID) + `attendanceDate`
 * range for the period. Uses the composite index (employeeDocId, attendanceDate).
 * workingDays = calendar days in month minus Sundays.
 * presentDays = distinct dates employee checked In.
 * lopDays = workingDays - presentDays (capped at 0).
 */
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

  const presentSet = new Set<string>();
  snapshot.docs.forEach((d) => {
    const data = d.data();
    if (data.status !== "In") return;

    const dateStr = data.attendanceDate as string | undefined;
    if (dateStr) {
      presentSet.add(dateStr);
    } else {
      // Fallback for older logs without attendanceDate: parse createdAt
      const ts = data.createdAt;
      if (!ts) return;
      const date = ts?.toDate ? ts.toDate() : new Date(ts);
      const y = date.getFullYear();
      const mo = String(date.getMonth() + 1).padStart(2, "0");
      const d2 = String(date.getDate()).padStart(2, "0");
      // Only count if within the target month
      if (`${y}-${mo}` === `${year}-${monthPadded}`) {
        presentSet.add(`${y}-${mo}-${d2}`);
      }
    }
  });

  // Working days = total days in month minus Sundays
  const daysInMonth = lastDay;
  let sundays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month - 1, day).getDay() === 0) sundays++;
  }
  const workingDays = daysInMonth - sundays;
  const presentDays = Math.min(presentSet.size, workingDays);
  const lopDays = Math.max(0, workingDays - presentDays);

  return { presentDays, workingDays, lopDays, overtimeHours: 0 };
}
