"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppAuth } from "@/context/auth-context";
import { CheckCircle2, XCircle, Timer } from "lucide-react";

type QuizQuestion = { id: string; prompt: string; options: string[] };

type QuizData = {
  assignment: { id: string; moduleName?: string; moduleId: string };
  bank: { id: string; timeLimitMinutes: number };
  questions: QuizQuestion[];
};

type ResultState = { score: number; passed: boolean; passingScore: number } | null;

export default function GuardQuizPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const router = useRouter();
  const { user } = useAppAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [current, setCurrent] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState<ResultState>(null);

  const load = useCallback(async () => {
    if (!user || !assignmentId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/guard/training/quiz/${assignmentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load quiz");
      setQuiz(data);
      if (data.bank?.timeLimitMinutes) {
        setDeadlineMs(Date.now() + data.bank.timeLimitMinutes * 60 * 1000);
      }
    } catch (err: any) {
      toast({ title: "Could not start quiz", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [assignmentId, toast, user]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!deadlineMs) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadlineMs]);

  const remainingSec = deadlineMs ? Math.max(0, Math.round((deadlineMs - now) / 1000)) : null;

  const handleSubmit = useCallback(async () => {
    if (!quiz || !user) return;
    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const payload = {
        bankId: quiz.bank.id,
        startedAt,
        answers: quiz.questions.map((q) => ({
          questionId: q.id,
          selectedIndex: typeof answers[q.id] === "number" ? answers[q.id] : -1,
        })),
      };
      const res = await fetch(`/api/guard/training/quiz/${assignmentId}/submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submit failed");
      setResult({ score: data.score, passed: data.passed, passingScore: data.passingScore });
    } catch (err: any) {
      toast({ title: "Submit failed", description: err?.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }, [answers, assignmentId, quiz, startedAt, toast, user]);

  useEffect(() => {
    if (remainingSec === 0 && !result && quiz) {
      void handleSubmit();
    }
  }, [handleSubmit, quiz, remainingSec, result]);

  const answered = useMemo(() => Object.keys(answers).length, [answers]);

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="p-4">
        <Card><CardContent className="py-10 text-center text-sm text-gray-600">Quiz unavailable.</CardContent></Card>
      </div>
    );
  }

  if (result) {
    return (
      <div className="p-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="space-y-4 py-8 text-center">
            {result.passed ? (
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
            ) : (
              <XCircle className="mx-auto h-12 w-12 text-red-600" />
            )}
            <div>
              <p className="text-2xl font-bold">{result.score}%</p>
              <p className="text-sm text-gray-600">
                {result.passed ? "Passed" : "Did not pass"} · Passing {result.passingScore}%
              </p>
            </div>
            <Button onClick={() => router.push("/guard/training")} className="bg-[#014c85] text-white hover:bg-[#013963]">
              Back to Training
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const q = quiz.questions[current];
  const isLast = current === quiz.questions.length - 1;

  return (
    <div className="flex flex-col gap-3 p-4 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500">{quiz.assignment.moduleName}</p>
          <p className="text-sm font-semibold">Question {current + 1} / {quiz.questions.length}</p>
        </div>
        {remainingSec !== null && (
          <div className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium">
            <Timer className="h-3.5 w-3.5" />
            {Math.floor(remainingSec / 60)}:{String(remainingSec % 60).padStart(2, "0")}
          </div>
        )}
      </div>

      <Card className="rounded-2xl border-0 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <p className="text-base font-medium">{q.prompt}</p>
          <div className="space-y-2">
            {q.options.map((opt, i) => {
              const selected = answers[q.id] === i;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setAnswers((a) => ({ ...a, [q.id]: i }))}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                    selected ? "border-[#014c85] bg-[#014c85]/5 font-medium text-[#014c85]" : "border-gray-200 bg-white hover:bg-gray-50"
                  }`}
                >
                  <span className="mr-2 font-semibold">{String.fromCharCode(65 + i)}.</span>
                  {opt}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" disabled={current === 0} onClick={() => setCurrent((c) => c - 1)}>Previous</Button>
        <p className="text-xs text-gray-500">{answered} / {quiz.questions.length} answered</p>
        {isLast ? (
          <Button onClick={handleSubmit} disabled={submitting} className="bg-[#014c85] text-white hover:bg-[#013963]">
            {submitting ? "Submitting..." : "Submit Quiz"}
          </Button>
        ) : (
          <Button onClick={() => setCurrent((c) => c + 1)} className="bg-[#014c85] text-white hover:bg-[#013963]">Next</Button>
        )}
      </div>
    </div>
  );
}
