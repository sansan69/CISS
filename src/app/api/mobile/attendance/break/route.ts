import { createHash } from "node:crypto";
import { OFFLINE_ATTENDANCE_MAX_AGE_HOURS } from "@/lib/constants";
import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import { db } from "@/lib/firebaseAdmin";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
export const runtime = "nodejs";

const breakSchema = z.object({
  action: z.enum(["start", "stop"]),
  lat: z.number().finite().min(-90).max(90).nullish().transform(v => v ?? undefined),
  lng: z.number().finite().min(-180).max(180).nullish().transform(v => v ?? undefined),
  accuracy: z.number().finite().positive().max(5_000).nullish().transform(v => v ?? undefined),
  capturedAt: z.string().datetime().optional(),
  sessionId: z.string().min(1).max(256).refine(v => !v.includes("/")).optional(),
  clientRequestId: z.string().uuid().optional(),
});

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object") {
    const candidate = value as {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof candidate.toDate === "function") {
      const date = candidate.toDate();
      return Number.isNaN(date.getTime()) ? null : date.getTime();
    }
    const seconds = candidate.seconds ?? candidate._seconds;
    if (typeof seconds === "number") {
      return seconds * 1000;
    }
  }
  return null;
}

function toNonNegativeInt(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

export async function POST(request: Request) {
  try {
    const guard = await requireGuard(request);

    const parsed = breakSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "A valid break action ('start' or 'stop') is required." },
        { status: 400 },
      );
    }
    const payload = parsed.data;
    const {action, lat, lng, accuracy, capturedAt, clientRequestId} = payload;
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const stateRef = db.collection('attendanceState').doc(guard.employeeDocId);
    const receiptRef = clientRequestId ? db.collection('attendanceBreakReceipts').doc(`${guard.employeeDocId}_${clientRequestId}`) : null;
    const result = await db.runTransaction(async transaction => {
      if (receiptRef) {
        const receipt = await transaction.get(receiptRef);
        if (receipt.exists) {
          const data = receipt.data()!;
          if (data.ownerUid !== guard.uid || data.fingerprint !== fingerprint) {
            return {ok:false as const, status:409, error:'Break request identity does not match the saved operation.'};
          }
          return {ok:true as const, response:{...data.result, replayed:true}};
        }
      }
      const currentStateDoc = await transaction.get(stateRef);
      const currentState = currentStateDoc.exists ? currentStateDoc.data() as Record<string, unknown> : {};
      const openSessionId = normalizeText(currentState.openSessionId);
      if (normalizeText(currentState.lastStatus) !== 'In' || !openSessionId || (payload.sessionId && payload.sessionId !== openSessionId)) {
        return {ok:false as const, status:409, error:'Break requires an open IN session matching this capture.'};
      }
      const sessionRef = db.collection('attendanceSessions').doc(openSessionId);
      const sessionDoc = await transaction.get(sessionRef);
      const session = sessionDoc.exists ? sessionDoc.data() as Record<string,unknown> : {};
      if (normalizeText(session.status) !== 'open' || normalizeText(session.employeeDocId) !== guard.employeeDocId) {
        return {ok:false as const, status:409, error:'The active attendance session is no longer valid.'};
      }
      const now = Timestamp.now();
      const nowMs = now.toMillis();
      const eventMs = capturedAt ? Date.parse(capturedAt) : nowMs;
      if (eventMs > nowMs + 5 * 60_000 || nowMs - eventMs > OFFLINE_ATTENDANCE_MAX_AGE_HOURS * 3600000) {
        return {ok:false as const, status:400, error:'Break capture time is outside the allowed offline window.'};
      }
      const sessionStart = toMillis(session.startedAt) ?? toMillis(currentState.openSessionStartedAt);
      if (sessionStart !== null && eventMs < sessionStart) {
        return {ok:false as const, status:409, error:'This break belongs to an earlier attendance session.'};
      }
      const lastEvent = toMillis(session.breakLastEventAt);
      if (lastEvent !== null && eventMs < lastEvent) {
        return {ok:false as const, status:409, error:'A newer break action has already been recorded.'};
      }
      const storedBreakSeconds = toNonNegativeInt(session.breakSeconds);
      const storedStartedMs = toMillis(session.breakStartedAt);
      const wasOnBreak = storedStartedMs !== null || session.onBreak === true;
      const onBreak = action === 'start';
      const breakStartedAt = onBreak ? new Date(storedStartedMs ?? eventMs) : null;
      if (action === 'stop' && storedStartedMs !== null && eventMs < storedStartedMs) {
        return {ok:false as const, status:409, error:'Break end must follow its start.'};
      }
      const breakSeconds = action === 'stop' && wasOnBreak
        ? storedBreakSeconds + Math.max(0, Math.round((eventMs - (storedStartedMs ?? eventMs)) / 1000))
        : storedBreakSeconds;
      const patch = {onBreak, breakStartedAt:breakStartedAt ? Timestamp.fromDate(breakStartedAt) : null, breakSeconds, breakLastEventAt:Timestamp.fromMillis(eventMs), breakUpdatedAt:now, updatedAt:now};
      const locationPatch = typeof lat === 'number' && typeof lng === 'number' ? {lastBreakLocation:{lat,lng,accuracy:accuracy ?? null}} : {};
      const response = {onBreak, ...(breakStartedAt ? {breakStartedAt:breakStartedAt.toISOString()} : {}), breakSeconds, canCheckOut:!onBreak, sessionId:openSessionId};
      transaction.set(sessionRef,{...patch,...locationPatch},{merge:true});
      transaction.set(stateRef,patch,{merge:true});
      if (receiptRef) transaction.set(receiptRef,{ownerUid:guard.uid, employeeDocId:guard.employeeDocId, sessionId:openSessionId, fingerprint, result:response, createdAt:now});
      return {ok:true as const,response};
    });
    if (!result.ok) return NextResponse.json({error:result.error},{status:result.status});
    return NextResponse.json(result.response);

  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid break payload." },
        { status: 400 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Could not update break state.";
    if (
      message.includes("Missing bearer token") ||
      message.includes("Guard access required")
    ) {
      return unauthorizedResponse(message);
    }
    console.error("[mobile/attendance/break]", error);
    return NextResponse.json(
      { error: "Break state could not be saved. Please try again." },
      { status: 500 },
    );
  }
}
