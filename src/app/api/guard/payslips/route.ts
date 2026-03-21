import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    let snapshot = await adminDb
      .collection("payrollEntries")
      .where("employeeId", "==", guard.employeeDocId)
      .limit(24)
      .get();

    if (snapshot.empty) {
      snapshot = await adminDb
        .collection("payrollEntries")
        .where("employeeId", "==", guard.employeeId)
        .limit(24)
        .get();
    }

    const payslips = snapshot.docs
      .map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
          }) as { id: string; createdAt?: { seconds?: number } },
      )
      .sort((a, b) => {
        const aSeconds = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
        const bSeconds = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
        return bSeconds - aSeconds;
      });
    return NextResponse.json({ payslips });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (msg.includes("Missing bearer token") || msg.includes("Guard access required")) {
      return unauthorizedResponse(msg);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
