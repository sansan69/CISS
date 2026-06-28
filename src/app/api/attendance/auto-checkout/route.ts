import { NextRequest, NextResponse } from "next/server";
import { db as adminDb } from "@/lib/firebaseAdmin";
import { isSessionStale } from "@/lib/attendance/attendance-validation";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

const CHUNK_SIZE = 50;
const PAGE_LIMIT = 100;

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

  let body = "";
  try {
    body = await request.clone().text();
  } catch {}

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

function computeFallbackAutoCheckout(
  state: Record<string, any>,
  session: Record<string, any> | undefined,
): string | null {
  if (state.autoCheckoutAt) return state.autoCheckoutAt;
  if (!session?.shiftEndTime || !session?.shiftStartTime) return null;

  const sessionStartDate = String(state.lastAttendanceDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionStartDate)) return null;

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
  return new Date(
    shiftEndTimestamp + (endH * 60 + endM + bufferMinutes) * 60 * 1000,
  ).toISOString();
}

async function processStaleSession(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  state: Record<string, any>,
  session: Record<string, any> | undefined,
  now: Date,
): Promise<{
  employeeDocId: string;
  attendanceDate: string;
  reason: string;
  writes: Array<{
    ref: FirebaseFirestore.DocumentReference;
    data: Record<string, any>;
    merge?: boolean;
  }>;
} | null> {
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
      autoClosed: true,
      autoClosedReason: "Session auto-closed by scheduled job. " + staleCheck.reason,
      reportedAt: now,
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
        endedAt: now,
        autoClosed: true,
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

  return { employeeDocId, attendanceDate: staleDate, reason: staleCheck.reason, writes };
}

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
  let totalClosed = 0;
  let totalPages = 0;
  const closedSessions: Array<{
    employeeDocId: string;
    attendanceDate: string;
    reason: string;
  }> = [];

  try {
    let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    let hasMore = true;

    while (hasMore) {
      let query = adminDb
        .collection("attendanceState")
        .where("lastStatus", "==", "In")
        .limit(PAGE_LIMIT);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const statesSnapshot = await query.get();
      if (statesSnapshot.empty) {
        hasMore = false;
        break;
      }

      totalPages++;

      // Pre-fetch session docs for this page
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

      // Collect all stale sessions for this page
      const pageResults: Array<{
        employeeDocId: string;
        attendanceDate: string;
        reason: string;
        writes: Array<{
          ref: FirebaseFirestore.DocumentReference;
          data: Record<string, any>;
          merge?: boolean;
        }>;
      }> = [];

      for (const doc of statesSnapshot.docs) {
        const state = doc.data() as Record<string, any>;
        const session = state.openSessionId
          ? sessionById.get(String(state.openSessionId))
          : undefined;
        const result = await processStaleSession(doc, state, session, now);
        if (result) {
          pageResults.push(result);
        }
      }

      lastDoc = statesSnapshot.docs[statesSnapshot.docs.length - 1];
      hasMore = statesSnapshot.docs.length >= PAGE_LIMIT;

      // Commit chunks of 50 stale sessions per batch
      if (pageResults.length > 0) {
        for (let i = 0; i < pageResults.length; i += CHUNK_SIZE) {
          const chunk = pageResults.slice(i, i + CHUNK_SIZE);
          const batch = adminDb.batch();
          for (const result of chunk) {
            for (const write of result.writes) {
              if (write.merge) {
                batch.set(write.ref, write.data, { merge: true });
              } else {
                batch.set(write.ref, write.data);
              }
            }
          }
          await batch.commit();
        }

        totalClosed += pageResults.length;
        for (const r of pageResults) {
          closedSessions.push({
            employeeDocId: r.employeeDocId,
            attendanceDate: r.attendanceDate,
            reason: r.reason,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      closedCount: totalClosed,
      pagesScanned: totalPages,
      closedSessions: closedSessions.slice(0, 20),
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
