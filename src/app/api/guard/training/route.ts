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

    const rawAssignments = snapshot.docs.map(
      (doc) =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as { id: string; moduleId?: string; assignedAt?: { seconds?: number } },
    );

    const moduleIds = Array.from(
      new Set(rawAssignments.map((a) => a.moduleId).filter((x): x is string => Boolean(x))),
    );
    const moduleMap = new Map<string, Record<string, unknown>>();
    if (moduleIds.length) {
      const refs = moduleIds.map((id) => adminDb.collection("trainingModules").doc(id));
      const modDocs = await adminDb.getAll(...refs);
      modDocs.forEach((d) => {
        if (d.exists) moduleMap.set(d.id, d.data() ?? {});
      });
    }

    const assignments = rawAssignments
      .map((a) => {
        const mod = a.moduleId ? moduleMap.get(a.moduleId) : undefined;
        return {
          ...a,
          contentUrl: (a as any).contentUrl ?? mod?.contentUrl ?? null,
          contentType: mod?.contentType ?? null,
          contentFileName: mod?.contentFileName ?? null,
        };
      })
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
