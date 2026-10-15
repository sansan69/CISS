import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import { db } from "@/lib/firebaseAdmin";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
export const runtime = "nodejs";

const breakSchema = z.object({
  action: z.enum(["start", "stop"]),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
  accuracy: z.number().finite().positive().max(5_000).optional(),
  capturedAt: z.string().datetime().optional(),
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
    const { action, lat, lng, accuracy } = parsed.data;

    const attendanceStateRef = db
      .collection("attendanceState")
      .doc(guard.employeeDocId);
    const attendanceStateDoc = await attendanceStateRef.get();
    if (!attendanceStateDoc.exists) {
      return NextResponse.json(
        { error: "Mark IN before starting a break." },
        { status: 409 },
      );
    }

    const attendanceState = attendanceStateDoc.data() as Record<string, unknown>;
    const openSessionId = normalizeText(attendanceState.openSessionId);
    if (
      normalizeText(attendanceState.lastStatus) !== "In" ||
      !openSessionId
    ) {
      return NextResponse.json(
        { error: "Break requires an open IN session." },
        { status: 409 },
      );
    }

    const sessionRef = db.collection("attendanceSessions").doc(openSessionId);
    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists) {
      return NextResponse.json(
        { error: "The open attendance session could not be verified." },
        { status: 409 },
      );
    }
    const session = sessionDoc.data() as Record<string, unknown>;
    if (
      normalizeText(session.status) !== "open" ||
      normalizeText(session.employeeDocId) !== guard.employeeDocId
    ) {
      return NextResponse.json(
        { error: "The active attendance session is no longer valid." },
        { status: 409 },
      );
    }

    const storedBreakSeconds = toNonNegativeInt(session.breakSeconds);
    const storedStartedMs = toMillis(session.breakStartedAt);
    const wasOnBreak = storedStartedMs !== null || session.onBreak === true;

    const now = Timestamp.now();
    const nowMs = now.toDate().getTime();

    let onBreak: boolean;
    let breakStartedAt: Date | null;
    let breakSeconds = storedBreakSeconds;

    if (action === "start") {
      onBreak = true;
      breakStartedAt =
        storedStartedMs !== null ? new Date(storedStartedMs) : now.toDate();
    } else if (wasOnBreak) {
      const startMs = storedStartedMs ?? nowMs;
      breakSeconds =
        storedBreakSeconds + Math.max(0, Math.round((nowMs - startMs) / 1000));
      onBreak = false;
      breakStartedAt = null;
    } else {
      // Stop when not on a break — idempotent no-op.
      onBreak = false;
      breakStartedAt = null;
    }

    const breakStartedAtValue = breakStartedAt
      ? Timestamp.fromDate(breakStartedAt)
      : null;
    const locationPatch =
      typeof lat === "number" && typeof lng === "number"
        ? { lastBreakLocation: { lat, lng, accuracy: accuracy ?? null } }
        : {};

    const batch = db.batch();
    batch.set(
      sessionRef,
      {
        onBreak,
        breakStartedAt: breakStartedAtValue,
        breakSeconds,
        breakUpdatedAt: now,
        ...locationPatch,
        updatedAt: now,
      },
      { merge: true },
    );
    batch.set(
      attendanceStateRef,
      {
        onBreak,
        breakStartedAt: breakStartedAtValue,
        breakSeconds,
        breakUpdatedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    await batch.commit();

    return NextResponse.json({
      onBreak,
      ...(onBreak && breakStartedAt
        ? { breakStartedAt: breakStartedAt.toISOString() }
        : {}),
      breakSeconds,
      canCheckOut: !onBreak,
    });
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
