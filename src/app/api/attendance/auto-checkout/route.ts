import { NextRequest, NextResponse } from "next/server";
import { db as adminDb } from "@/lib/firebaseAdmin";
import { isSessionStale } from "@/lib/attendance/attendance-validation";
import { runChunked, buildSelfUrl } from "@/lib/server/self-queue";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

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
  const sessionStart = Date.parse(`${sessionStartDate}T00:00:00+05:30`);
  if (Number.isNaN(sessionStart)) return null;
  const shiftEndTimestamp = crossesMidnight
    ? sessionStart + 24 * 60 * 60 * 1000
    : sessionStart;
  const bufferMinutes = 120;
  return new Date(
    shiftEndTimestamp + (endH * 60 + endM + bufferMinutes) * 60 * 1000,
  ).toISOString();
}

/**
 * Generate the writes needed for a stale session auto-close.
 * Returns null if the session is not stale.
 */
function processStaleSession(
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
  const selfUrl = buildSelfUrl(request.url, "/api/attendance/auto-checkout");
  const cronSecret = process.env.CRON_SECRET || "";

  try {
    const result = await runChunked(
      {
        stateCollection: "systemConfig",
        jobId: "autoCheckoutQueue",
        budgetMs: 50_000,
        selfUrl,
        cronSecret,
      },
      // ── claim: read one page of stale attendance states ──
      async (tx, cursor) => {
        let query = adminDb
          .collection("attendanceState")
          .where("lastStatus", "==", "In")
          .orderBy("lastAttendanceDate")
          .limit(PAGE_LIMIT);

        if (cursor) {
          const cursorDocRef = adminDb
            .collection("attendanceState")
            .doc(cursor as string);
          const cursorDoc = await tx.get(cursorDocRef);
          if (cursorDoc.exists) {
            query = query.startAfter(cursorDoc);
          }
        }

        const snapshot = await query.get();
        if (snapshot.empty) {
          return { chunk: null, cursor: null };
        }

        const docs = snapshot.docs;
        return {
          chunk: docs,
          cursor: docs[docs.length - 1].id,
        };
      },
      // ── process: close stale sessions in individual transactions ──
      async (docs) => {
        // Pre-fetch session docs for this page in batches of 10
        const sessionIds = docs
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

        let closedCount = 0;

        for (const doc of docs) {
          const state = doc.data() as Record<string, any>;
          const session = state.openSessionId
            ? sessionById.get(String(state.openSessionId))
            : undefined;

          const result = processStaleSession(doc, state, session, now);
          if (!result) continue;

          // Use runTransaction per session to atomically verify & close
          // (prevents P1-7 race where a real checkout is overwritten)
          try {
            await adminDb.runTransaction(async (tx) => {
              const freshSnap = await tx.get(doc.ref);
              if (!freshSnap.exists) return;
              const freshState = freshSnap.data() as Record<string, any>;
              if (freshState.lastStatus !== "In") return;

              for (const write of result.writes) {
                if (write.merge) {
                  tx.set(write.ref, write.data, { merge: true });
                } else {
                  tx.set(write.ref, write.data);
                }
              }
            });
            closedCount++;
          } catch (txError) {
            // Transaction conflict — the guard likely checked out concurrently
            console.warn(
              `[auto-checkout] Transaction conflict for ${result.employeeDocId}:`,
              txError,
            );
          }
        }

        return { done: true, processed: closedCount };
      },
    );

    // Write completion marker (covers W-P2-2)
    if (result.done) {
      await adminDb
        .collection("systemConfig")
        .doc("autoCheckoutQueue")
        .set(
          {
            autoCheckoutLastRun: {
              ranAt: now.toISOString(),
              closedCount: result.processed,
              status: result.status,
            },
          },
          { merge: true },
        );
    }

    if (!result.done) {
      return NextResponse.json({ status: 202 });
    }

    return NextResponse.json({
      success: true,
      closedCount: result.processed,
      checkedAt: now.toISOString(),
    });
  } catch (error: any) {
    const { log } = await import("@/lib/server/log");
    log("error", "auto-checkout", "Auto-checkout job failed", {
      error: error?.message,
    });
    return NextResponse.json(
      { error: error?.message || "Auto-checkout failed." },
      { status: 500 },
    );
  }
}
