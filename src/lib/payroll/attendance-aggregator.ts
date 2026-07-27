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
  options: { holidays?: string[]; scheduledDates?: string[] } = {},
): Promise<AttendanceSummary> {
  const [year, month] = period.split("-").map(Number);

  const monthPadded = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  const startDateStr = `${year}-${monthPadded}-01`;
  const endDateStr = `${year}-${monthPadded}-${String(lastDay).padStart(2, "0")}`;

  const employeeSnap = await adminDb
    .collection("employees")
    .doc(employeeDocId)
    .get();
  const employeeData = employeeSnap.data() as
    | Record<string, unknown>
    | undefined;
  const employeeId =
    typeof employeeData?.employeeId === "string"
      ? employeeData.employeeId
      : undefined;

  const buildLogQuery = (field: "employeeDocId" | "employeeId", value: string) =>
    adminDb
      .collection("attendanceLogs")
      .where(field, "==", value)
      .where("attendanceDate", ">=", startDateStr)
      .where("attendanceDate", "<=", endDateStr)
      .get();

  // Read both modern and legacy identifiers. Using a legacy query only when
  // the modern query is empty silently loses older days in partially migrated
  // months.
  const [modernSnapshot, legacySnapshot] = await Promise.all([
    buildLogQuery("employeeDocId", employeeDocId),
    employeeId
      ? buildLogQuery("employeeId", employeeId)
      : Promise.resolve(null),
  ]);

  type LogEntry = {
    attendanceDate: string;
    status: string;
    reviewStatus?: string;
    reportedAt?: { seconds?: number; nanoseconds?: number; toDate?: () => Date };
    createdAt?: { seconds?: number; nanoseconds?: number; toDate?: () => Date };
  };

  const presentDates = new Set<string>();

  const logsById = new Map(
    [
      ...modernSnapshot.docs,
      ...(legacySnapshot?.docs ?? []),
    ].map((document) => [document.id, document]),
  );

  logsById.forEach((d) => {
    const data = d.data() as LogEntry;

    // Presence requires a valid check-in. An isolated auto-checkout or a
    // rejected record must never create a paid attendance day.
    if (String(data.status).toLowerCase() !== "in") return;
    if (String(data.reviewStatus ?? "").toLowerCase() === "rejected") return;

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
  const scheduledDates = new Set(
    (options.scheduledDates ?? []).filter(
      (date) =>
        date >= startDateStr &&
        date <= endDateStr &&
        !holidayDates.has(date),
    ),
  );
  let workingDays: number;
  if (options.scheduledDates) {
    workingDays = scheduledDates.size;
  } else {
    let nonWorkingDays = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${monthPadded}-${String(day).padStart(2, "0")}`;
      const isSunday = new Date(year, month - 1, day).getDay() === 0;
      if (isSunday || holidayDates.has(dateStr)) nonWorkingDays++;
    }
    workingDays = daysInMonth - nonWorkingDays;
  }
  const presentDays = Math.min(presentDates.size, workingDays);

  return { presentDays, workingDays };
}
