import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const guard = await requireGuard(request);
    const { assignmentId } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const assignSnap = await adminDb.collection("trainingAssignments").doc(assignmentId).get();
    if (!assignSnap.exists) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    const assignment = assignSnap.data()!;
    const belongs = assignment.employeeId === guard.employeeDocId || assignment.employeeId === guard.employeeId || assignment.employeeDocId === guard.employeeDocId;
    if (!belongs) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const moduleId = assignment.moduleId as string | undefined;
    if (!moduleId) return NextResponse.json({ error: "Assignment has no module" }, { status: 400 });

    const bankQ = await adminDb.collection("questionBanks").where("moduleId", "==", moduleId).limit(1).get();
    if (bankQ.empty) return NextResponse.json({ error: "No question bank linked to this module yet." }, { status: 404 });
    const bankDoc = bankQ.docs[0];
    const bank = { id: bankDoc.id, ...bankDoc.data() } as {
      id: string;
      questionsPerAttempt?: number;
      timeLimitMinutes?: number;
      shuffle?: boolean;
      maxAttempts?: number;
    };

    if (bank.maxAttempts && bank.maxAttempts > 0) {
      const attempts = await adminDb
        .collection("quizAttempts")
        .where("bankId", "==", bank.id)
        .where("employeeDocId", "==", guard.employeeDocId)
        .count()
        .get();
      if (attempts.data().count >= bank.maxAttempts) {
        return NextResponse.json({ error: "Max attempts reached." }, { status: 403 });
      }
    }

    const qSnap = await adminDb
      .collection("questionBanks")
      .doc(bank.id)
      .collection("questions")
      .get();
    const pool = qSnap.docs.map((d) => ({
      id: d.id,
      prompt: d.data().prompt as string,
      options: d.data().options as string[],
    }));
    if (pool.length === 0) return NextResponse.json({ error: "Bank has no questions yet." }, { status: 400 });

    const shuffled = bank.shuffle !== false ? shuffleInPlace([...pool]) : [...pool];
    const take = Math.min(bank.questionsPerAttempt ?? 10, shuffled.length);
    const picked = shuffled.slice(0, take);

    return NextResponse.json({
      assignment: { id: assignSnap.id, moduleName: assignment.moduleName, moduleId },
      bank: { id: bank.id, timeLimitMinutes: bank.timeLimitMinutes ?? 0 },
      questions: picked,
    });
  } catch (err: any) {
    const msg = err?.message || "Internal error";
    if (msg.includes("Missing bearer") || msg.includes("Guard access")) return unauthorizedResponse(msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
