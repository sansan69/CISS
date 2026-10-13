import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
import { resolveEmployeeDistrict } from "@/lib/employees/visibility";
import { getIstYearMonth } from "@/lib/ist-date";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TrainingEntry = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  clientId: string;
  clientName: string;
  district: string;
  profilePicUrl?: string;
  trainingScore: number;
  totalTrainingsCompleted: number;
  trainingAttempts: number;
  lastAttemptAt?: string;
};

function timestampToIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

function readNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const empSnap = await adminDb.doc(`employees/${guard.employeeDocId}`).get();
    const empData = empSnap.exists
      ? (empSnap.data() as Record<string, unknown>)
      : {};

    const district = resolveEmployeeDistrict(empData);
    const clientId = String(empData.clientId ?? "");

    // Scope the leaderboard to the guard's peers: same district first, then
    // same client as a fallback when the employee has no district set.
    let q: FirebaseFirestore.Query | null = null;
    if (district) q = adminDb.collection("employees").where("district", "==", district);
    else if (clientId) q = adminDb.collection("employees").where("clientId", "==", clientId);

    let rows: TrainingEntry[] = [];
    let myEntry: TrainingEntry | null = null;
    let myRank: number | null = null;

    if (q) {
      const snapshot = await q.limit(1000).get();
      rows = snapshot.docs
        .map((d): TrainingEntry | null => {
          const data = d.data() as Record<string, unknown>;
          const tp =
            data.trainingPerformance &&
            typeof data.trainingPerformance === "object"
              ? (data.trainingPerformance as Record<string, unknown>)
              : {};

          const trainingAttempts = readNumber(tp.attemptCount);
          const completedCount = readNumber(tp.completedCount);
          const score = readNumber(tp.lastScore);
          const hasTraining =
            trainingAttempts > 0 || completedCount > 0 || score > 0;
          if (!hasTraining) return null;

          return {
            id: d.id,
            employeeId: String(data.employeeId ?? ""),
            employeeName: String(data.fullName ?? data.name ?? ""),
            employeeCode: String(data.employeeCode ?? data.employeeId ?? ""),
            clientId: String(data.clientId ?? ""),
            clientName: String(data.clientName ?? ""),
            district: resolveEmployeeDistrict(data),
            profilePicUrl:
              typeof data.profilePhotoUrl === "string"
                ? data.profilePhotoUrl
                : undefined,
            trainingScore: score,
            totalTrainingsCompleted: completedCount,
            trainingAttempts,
            lastAttemptAt: timestampToIso(tp.lastAttemptAt),
          };
        })
        .filter((entry): entry is TrainingEntry => entry !== null);

      rows.sort((a, b) => {
        if (b.trainingScore !== a.trainingScore) {
          return b.trainingScore - a.trainingScore;
        }
        if (b.totalTrainingsCompleted !== a.totalTrainingsCompleted) {
          return b.totalTrainingsCompleted - a.totalTrainingsCompleted;
        }
        return a.trainingAttempts - b.trainingAttempts;
      });
      rows = rows.slice(0, 50);

      const myIndex = rows.findIndex(
        (entry) => entry.id === guard.employeeDocId || entry.employeeId === guard.employeeId,
      );
      if (myIndex >= 0) {
        myRank = myIndex + 1;
        myEntry = rows[myIndex];
      }
    }

    const currentMonth = getIstYearMonth(new Date());
    return NextResponse.json({
      district,
      currentMonth: currentMonth.monthStr,
      scores: rows.map((entry, index) => ({ rank: index + 1, ...entry })),
      myRank,
      myEntry,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Guard access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[guard/leaderboard]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
