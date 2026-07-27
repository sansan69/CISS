import { FieldValue } from "firebase-admin/firestore";

import { db as adminDb } from "@/lib/firebaseAdmin";
import {
  computeShiftInterval,
  isSessionStale,
} from "@/lib/attendance/attendance-validation";

function toDateValue(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const timestamp = value as { toDate?: () => Date; seconds?: number };
    if (typeof timestamp.toDate === "function") return timestamp.toDate();
    if (typeof timestamp.seconds === "number") {
      return new Date(timestamp.seconds * 1000);
    }
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeFallbackAutoCheckout(
  state: Record<string, any>,
  session: Record<string, any> | undefined,
): string | null {
  const existing = toDateValue(state.autoCheckoutAt ?? session?.autoCheckoutAt);
  if (existing) return existing.toISOString();
  if (!session?.shiftEndTime || !session?.shiftStartTime) return null;

  const sessionStartDate = String(state.lastAttendanceDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionStartDate)) return null;

  return (
    computeShiftInterval({
      operationalDate: sessionStartDate,
      shift: {
        code: String(session.shiftCode ?? ""),
        startTime: String(session.shiftStartTime),
        endTime: String(session.shiftEndTime),
      },
    })?.autoCheckoutAt ?? null
  );
}

export function processStaleSession(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  state: Record<string, any>,
  session: Record<string, any> | undefined,
  now: Date,
): {
  employeeDocId: string;
  attendanceDate: string;
  reason: string;
  writes: Array<{
    ref: FirebaseFirestore.DocumentReference;
    data: Record<string, any>;
    merge?: boolean;
  }>;
} | null {
  const autoCheckoutAt = computeFallbackAutoCheckout(state, session);
  const staleCheck = isSessionStale({
    lastState: {
      lastStatus: "In",
      lastAttendanceDate: state.lastAttendanceDate,
      autoCheckoutAt,
    },
    now,
  });

  if (!staleCheck.stale) return null;

  const employeeDocId = doc.id;
  const staleDate = state.lastAttendanceDate ?? "unknown";
  const writes: Array<{
    ref: FirebaseFirestore.DocumentReference;
    data: Record<string, any>;
    merge?: boolean;
  }> = [];

  const staleOutLogRef = adminDb.collection("attendanceLogs").doc();
  const effectiveOutAt =
    toDateValue(session?.shiftEndsAt ?? state.shiftEndsAt) ?? now;
  writes.push({
    ref: staleOutLogRef,
    data: {
      employeeId: state.employeeId ?? employeeDocId,
      employeeDocId,
      employeeName: state.employeeName ?? "",
      status: "Out",
      attendanceDate: staleDate,
      siteId: state.lastSiteId ?? "",
      siteName: state.lastSiteName ?? "",
      dutyPointId: state.lastDutyPointId ?? null,
      dutyPointName: state.lastDutyPointName ?? null,
      clientName: state.lastSiteClientName ?? "",
      employeeClientName: state.employeeClientName ?? "",
      siteClientName: state.lastSiteClientName ?? "",
      shiftCode: state.lastShiftCode ?? session?.shiftCode ?? null,
      shiftLabel: state.lastShiftLabel ?? session?.shiftLabel ?? null,
      attendanceSessionId: state.openSessionId ?? null,
      autoClosed: true,
      closeReason: "missed_checkout",
      requiresAdminReview: true,
      autoClosedReason: "Session auto-closed by scheduled job. " + staleCheck.reason,
      reportedAt: effectiveOutAt,
      serverProcessedAt: now,
      createdAt: now,
      attendanceReviewWarnings: [
        "Auto-closed stale session: " + staleCheck.reason,
      ],
    },
  });

  if (state.openSessionId) {
    writes.push({
      ref: adminDb.collection("attendanceSessions").doc(String(state.openSessionId)),
      data: {
        status: "closed",
        outLogId: staleOutLogRef.id,
        endedAt: effectiveOutAt,
        autoClosed: true,
        closeReason: "missed_checkout",
        requiresAdminReview: true,
        autoClosedReason: "Scheduled auto-checkout: " + staleCheck.reason,
        updatedAt: now,
      },
      merge: true,
    });
  }

  writes.push({
    ref: doc.ref,
    data: {
      lastStatus: "Out",
      lastAttendanceDate: staleDate,
      lastAttendanceId: staleOutLogRef.id,
      openSessionId: FieldValue.delete(),
      openSessionStartedAt: FieldValue.delete(),
      autoCheckoutAt: FieldValue.delete(),
      lastLoggedAt: now,
      updatedAt: now,
      lastAutoClosedAt: now,
      lastAutoCloseReason: staleCheck.reason,
    },
    merge: true,
  });

  writes.push({
    ref: adminDb.collection("guardLocations").doc(employeeDocId),
    data: {
      status: "Out",
      isOutOfZone: false,
      attendanceId: staleOutLogRef.id,
      updatedAt: now,
    },
    merge: true,
  });

  return { employeeDocId, attendanceDate: staleDate, reason: staleCheck.reason, writes };
}
