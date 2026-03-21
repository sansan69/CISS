"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import type { Evaluation } from "@/types/evaluation";

export default function EvaluationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [evaluationId, setEvaluationId] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then(({ id }) => setEvaluationId(id));
  }, [params]);

  const loadEvaluation = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await authorizedFetch("/api/admin/evaluations");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load evaluations.");
      const matched = (data.evaluations ?? []).find((item: Evaluation) => item.id === id) ?? null;
      setEvaluation(matched);
    } catch (error: any) {
      toast({
        title: "Could not load evaluation",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (evaluationId) {
      void loadEvaluation(evaluationId);
    }
  }, [evaluationId, loadEvaluation]);

  if (loading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!evaluation) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Evaluation" backHref="/evaluations" />
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Evaluation not found.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={evaluation.employeeName || "Evaluation"}
        backHref="/evaluations"
        description={`${evaluation.period} · ${evaluation.clientName || "No client"}${evaluation.district ? ` · ${evaluation.district}` : ""}`}
      />

      <Card>
        <CardContent className="grid gap-4 p-6 md:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Employee</p>
            <p className="text-base font-semibold">{evaluation.employeeName}</p>
            <p className="text-sm text-muted-foreground">{evaluation.employeeCode || evaluation.employeeId}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Score</p>
            <p className="text-base font-semibold">{evaluation.normalizedScore}%</p>
            <p className="text-sm text-muted-foreground">{evaluation.totalScore}/50 total</p>
          </div>
          {Object.entries(evaluation.criteria).map(([key, value]) => (
            <div key={key} className="rounded-xl border p-4">
              <p className="text-sm capitalize text-muted-foreground">{key.replace(/([A-Z])/g, " $1")}</p>
              <p className="mt-1 text-xl font-semibold">{value}/10</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {evaluation.comments ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium">Comments</p>
            <p className="mt-2 text-sm text-muted-foreground">{evaluation.comments}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
