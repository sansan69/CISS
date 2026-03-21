"use client";

import React, { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppAuth } from "@/context/auth-context";

type Evaluation = {
  id: string;
  period?: string;
  normalizedScore?: number;
  totalScore?: number;
  comments?: string;
  criteria?: Record<string, number>;
  createdAt?: { seconds: number };
};

function formatTs(ts?: { seconds: number }) {
  if (!ts?.seconds) return "—";
  return new Date(ts.seconds * 1000).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function GuardEvaluationsPage() {
  const { user } = useAppAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);

  const loadEvaluations = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/guard/evaluations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load evaluations.");
      setEvaluations(data.evaluations ?? []);
    } catch (error: any) {
      toast({
        title: "Could not load evaluations",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    void loadEvaluations();
  }, [loadEvaluations]);

  return (
    <div className="space-y-4 p-4 pb-6">
      <div>
        <p className="text-sm text-gray-500">Performance review</p>
        <h1 className="text-lg font-bold text-gray-900">My Evaluations</h1>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : evaluations.length === 0 ? (
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="py-14 text-center">
            <Star className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-700">No evaluations yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {evaluations.map((evaluation) => (
            <Card key={evaluation.id} className="rounded-2xl border-0 shadow-sm">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{evaluation.period || "Evaluation"}</p>
                    <p className="text-xs text-gray-500">Recorded {formatTs(evaluation.createdAt)}</p>
                  </div>
                  <span className="rounded-full bg-[#014c85]/10 px-2.5 py-1 text-xs font-semibold text-[#014c85]">
                    {typeof evaluation.normalizedScore === "number" ? `${evaluation.normalizedScore}%` : "—"}
                  </span>
                </div>
                {evaluation.criteria ? (
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                    {Object.entries(evaluation.criteria).map(([key, value]) => (
                      <div key={key} className="rounded-xl bg-gray-50 px-3 py-2">
                        <p className="capitalize">{key.replace(/([A-Z])/g, " $1")}</p>
                        <p className="mt-1 font-semibold text-gray-900">{value}/10</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {evaluation.comments ? (
                  <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-700">{evaluation.comments}</p>
                ) : (
                  <p className="inline-flex items-center text-xs text-gray-500">
                    <BadgeCheck className="mr-1.5 h-3.5 w-3.5" />
                    No comments added
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
