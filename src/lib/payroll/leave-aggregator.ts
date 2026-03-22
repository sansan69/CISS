import type { Firestore } from "firebase-admin/firestore";

export interface LeaveSummary {
  approvedPaidLeaveDays: number;
  approvedUnpaidLeaveDays: number;
}

function coerceDate(
  value?: { toDate?: () => Date } | Date | string | null,
): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate();
  }
  return null;
}

export async function aggregateApprovedLeave(
  employeeId: string,
  period: string,
  adminDb: Firestore,
): Promise<LeaveSummary> {
  const [year, month] = period.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);

  const snapshot = await adminDb
    .collection("leaveRequests")
    .where("employeeId", "==", employeeId)
    .where("status", "==", "approved")
    .get();

  let approvedPaidLeaveDays = 0;
  let approvedUnpaidLeaveDays = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() as {
      type?: string;
      days?: number;
      fromDate?: { toDate?: () => Date } | Date | string | null;
      toDate?: { toDate?: () => Date } | Date | string | null;
    };
    const from = coerceDate(data.fromDate);
    const to = coerceDate(data.toDate) ?? from;

    if (!from || !to) continue;
    if (to < start || from > end) continue;

    const boundedStart = from > start ? from : start;
    const boundedEnd = to < end ? to : end;
    const overlapDays =
      Math.floor(
        (boundedEnd.getTime() - boundedStart.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;
    const days = typeof data.days === "number" && data.days > 0
      ? Math.min(data.days, overlapDays)
      : overlapDays;
    if (days <= 0) continue;
    if (data.type === "unpaid") approvedUnpaidLeaveDays += days;
    else approvedPaidLeaveDays += days;
  }

  return {
    approvedPaidLeaveDays,
    approvedUnpaidLeaveDays,
  };
}
