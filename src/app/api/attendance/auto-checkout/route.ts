import { NextRequest, NextResponse } from "next/server";
import { db as adminDb } from "@/lib/firebaseAdmin";
import { isSessionStale } from "@/lib/attendance/attendance-validation";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

async function verifyVercelCronSignature(request: NextRequest): Promise<boolean> {
  const signatureHeader = request.headers.get("x-vercel-signature");
  const secret = process.env.CRON_SECRET;
  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split(",");
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));
  if (!tPart || !v1Part) return false;

  const timestamp = tPart.slice(2);
  const signature = v1Part.slice(3);

  // Vercel sends the body; for empty body use empty string
  let body = "";
  try {
    body = await request.clone().text();
  } catch {
    /* empty body */
  }

  const payload = `${timestamp}.${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

/**
 * POST /api/attendance/auto-checkout
 * Scheduled job (Vercel Cron every 30 minutes) that auto-closes
 * attendance sessions that have exceeded their shift end + buffer time.
 *
 * Auth: Vercel cron signature header (x-vercel-signature) OR query param ?key=<CRON_SECRET>
 */
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  let authorized = false;
  if (key === process.env.CRON_SECRET) {
    authorized = true;
  } else {
    authorized = await verifyVercelCronSignature(request);
  }

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const batch = adminDb.batch();
  let closedCount = 0;
  const closedSessions: Array<{
    employeeDocId: string;
    attendanceDate: string;
    reason: string;
  }> = [];

  try {
    // Find all attendance states with open sessions
    const statesSnapshot = await adminDb
      .collection("attendanceState")
      .where("lastStatus", "==", "In")
      .limit(500)
      .get();

    // Pre-fetch open session docs to compute autoCheckoutAt for old sessions
    // Firestore 'in' queries are limited to 10 values per query
    const sessionIds = statesSnapshot.docs
      .map((d) => (d.data() as Record<string, any>).openSessionId)
      .filter((id): id is string => typeof id === "string");

    const sessionById = new Map<string, Record<string, any>>();
    if (sessionIds.length > 0) {
      for (let i = 0; i < sessionIds.length; i += 10) {
        const idBatch = sessionIds.slice(i, i + 10);
        const snap = await adminDb
          .collection("attendanceSessions")
          .where("__name__", "in", idBatch)
          .get();
        for (const sDoc of snap.docs) {
          sessionById.set(sDoc.id, sDoc.data());
        }
      }
    }

    for (const doc of statesSnapshot.docs) {
      const state = doc.data() as Record<string, any>;

      // If autoCheckoutAt is missing, try to compute it from the session's shift
      let autoCheckoutAt: string | null = state.autoCheckoutAt ?? null;
      if (!autoCheckoutAt && state.openSessionId) {
        const session = sessionById.get(String(state.openSessionId));
        if (session?.shiftEndTime && session?.shiftStartTime) {
          const sessionStartDate = String(state.lastAttendanceDate ?? "");
          if (/^\d{4}-\d{2}-\d{2}$/.test(sessionStartDate)) {
            const endTime = String(session.shiftEndTime);
            const startTime = String(session.shiftStartTime);
            const [endH, endM] = endTime.split(":").map(Number);
            const [startH, startM] = startTime.split(":").map(Number);
            const crossesMidnight = startH * 60 + startM >= endH * 60 + endM;
            const [y, m, d] = sessionStartDate.split("-").map(Number);
            const sessionStart = Date.UTC(y, m - 1, d);
            const shiftEndTimestamp = crossesMidnight
              ? sessionStart + 24 * 60 * 60 * 1000
              : sessionStart;
            const bufferMinutes = 120;
            autoCheckoutAt = new Date(
              shiftEndTimestamp + (endH * 60 + endM + bufferMinutes) * 60 * 1000,
            ).toISOString();
          }
        }
      }

      const staleCheck = isSessionStale({
        lastState: {
          lastStatus: "In",
          lastAttendanceDate: state.lastAttendanceDate,
          autoCheckoutAt,
        },
        now,
      });

      if (!staleCheck.stale) continue;

      const employeeDocId = doc.id;
      const staleDate = state.lastAttendanceDate ?? "unknown";

      // Create auto-closed OUT log
      const staleOutLogRef = adminDb.collection("attendanceLogs").doc();
      batch.set(staleOutLogRef, {
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
        autoClosed: true,
        autoClosedReason:
          "Session auto-closed by scheduled job. " + staleCheck.reason,
        reportedAt: now,
        serverProcessedAt: now,
        createdAt: now,
        attendanceReviewWarnings: [
          "Auto-closed stale session: " + staleCheck.reason,
        ],
      });

      // Update the open session document
      if (state.openSessionId) {
        const sessionRef = adminDb
          .collection("attendanceSessions")
          .doc(String(state.openSessionId));
        batch.set(
          sessionRef,
          {
            status: "closed",
            outLogId: staleOutLogRef.id,
            endedAt: now,
            autoClosed: true,
            autoClosedReason: "Scheduled auto-checkout: " + staleCheck.reason,
            updatedAt: now,
          },
          { merge: true },
        );
      }

      // Update attendance state
      batch.set(
        doc.ref,
        {
          lastStatus: "Out",
          lastAttendanceDate: staleDate,
          lastAttendanceId: staleOutLogRef.id,
          openSessionId: FieldValue.delete(),
          openSessionStartedAt: FieldValue.delete(),
          autoCheckoutAt: FieldValue.delete(),
          lastLoggedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );

      closedCount++;
      closedSessions.push({
        employeeDocId,
        attendanceDate: staleDate,
        reason: staleCheck.reason,
      });
    }

    if (closedCount > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      success: true,
      closedCount,
      closedSessions: closedSessions.slice(0, 20), // Limit response size
      checkedAt: now.toISOString(),
    });
  } catch (error: any) {
    console.error("Auto-checkout job failed:", error);
    return NextResponse.json(
      { error: error?.message || "Auto-checkout failed." },
      { status: 500 },
    );
  }
}
