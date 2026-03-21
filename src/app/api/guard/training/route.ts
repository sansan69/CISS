import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    let snapshot = await adminDb
      .collection("trainingAssignments")
      .where("employeeId", "==", guard.employeeDocId)
      .limit(100)
      .get();

    if (snapshot.empty) {
      snapshot = await adminDb
        .collection("trainingAssignments")
        .where("employeeId", "==", guard.employeeId)
        .limit(100)
        .get();
    }

    const assignments = snapshot.docs
      .map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
          }) as { id: string; assignedAt?: { seconds?: number } },
      )
      .sort((a, b) => {
        const aSeconds = (a.assignedAt as { seconds?: number } | undefined)?.seconds ?? 0;
        const bSeconds = (b.assignedAt as { seconds?: number } | undefined)?.seconds ?? 0;
        return bSeconds - aSeconds;
      });
    return NextResponse.json({ assignments });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (msg.includes("Missing bearer token") || msg.includes("Guard access required")) {
      return unauthorizedResponse(msg);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
