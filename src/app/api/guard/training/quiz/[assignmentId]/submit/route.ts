import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

type SubmitPayload = {
  bankId: string;
  answers: { questionId: string; selectedIndex: number }[];
  startedAt?: number;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const guard = await requireGuard(request);
    const { assignmentId } = await params;
    const body = (await request.json()) as SubmitPayload;
    if (!body.bankId || !Array.isArray(body.answers)) {
      return NextResponse.json({ error: "bankId and answers required." }, { status: 400 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const FieldValue = (await import("firebase-admin/firestore")).FieldValue;

    const assignRef = adminDb.collection("trainingAssignments").doc(assignmentId);
    const assignSnap = await assignRef.get();
    if (!assignSnap.exists) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    const assignment = assignSnap.data()!;
    const belongs = assignment.employeeId === guard.employeeDocId || assignment.employeeId === guard.employeeId || assignment.employeeDocId === guard.employeeDocId;
    if (!belongs) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const moduleId = assignment.moduleId as string;
    const moduleSnap = await adminDb.collection("trainingModules").doc(moduleId).get();
    const passingScore = (moduleSnap.data()?.passingScore as number | undefined) ?? 70;

    const questionIds = body.answers.map((a) => a.questionId);
    const refs = questionIds.map((qid) =>
      adminDb.collection("questionBanks").doc(body.bankId).collection("questions").doc(qid),
    );
    const qDocs = refs.length ? await adminDb.getAll(...refs) : [];
    const correctMap = new Map<string, number>();
    qDocs.forEach((d) => {
      if (d.exists) correctMap.set(d.id, (d.data()?.correctIndex as number) ?? 0);
    });

    let correctCount = 0;
    const gradedAnswers = body.answers.map((a) => {
      const correct = correctMap.get(a.questionId);
      const isCorrect = typeof correct === "number" && a.selectedIndex === correct;
      if (isCorrect) correctCount++;
      return { questionId: a.questionId, selectedIndex: a.selectedIndex, correct: isCorrect };
    });

    const total = body.answers.length || 1;
    const scorePercent = Math.round((correctCount / total) * 100);
    const passed = scorePercent >= passingScore;
    const now = new Date();
    const startedAt = body.startedAt ? new Date(body.startedAt) : now;
    const durationSeconds = Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000));

    const attemptRef = adminDb.collection("quizAttempts").doc();
    await attemptRef.set({
      moduleId,
      bankId: body.bankId,
      assignmentId,
      employeeDocId: guard.employeeDocId,
      employeeId: guard.employeeId,
      answers: gradedAnswers,
      score: scorePercent,
      correctCount,
      total,
      passed,
      startedAt,
      submittedAt: now,
      durationSeconds,
    });

    await assignRef.update({
      status: passed ? "completed" : "failed",
      score: scorePercent,
      completedAt: now,
      lastAttemptId: attemptRef.id,
    });

    if (guard.employeeDocId) {
      const guardRef = adminDb.collection("employees").doc(guard.employeeDocId);
      await guardRef.set(
        {
          trainingPerformance: {
            lastAttemptAt: now,
            lastScore: scorePercent,
            lastPassed: passed,
            completedCount: FieldValue.increment(passed ? 1 : 0),
            attemptCount: FieldValue.increment(1),
          },
        },
        { merge: true },
      );
    }

    return NextResponse.json({ attemptId: attemptRef.id, score: scorePercent, passed, passingScore });
  } catch (err: any) {
    const msg = err?.message || "Internal error";
    if (msg.includes("Missing bearer") || msg.includes("Guard access")) return unauthorizedResponse(msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
