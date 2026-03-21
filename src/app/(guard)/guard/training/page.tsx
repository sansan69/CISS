"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ExternalLink, GraduationCap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppAuth } from "@/context/auth-context";

type Assignment = {
  id: string;
  moduleName?: string;
  moduleCategory?: string;
  status?: string;
  score?: number;
  contentUrl?: string;
  dueDate?: { seconds: number };
  assignedAt?: { seconds: number };
};

function formatTs(ts?: { seconds: number }) {
  if (!ts?.seconds) return "—";
  return new Date(ts.seconds * 1000).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function GuardTrainingPage() {
  const { user } = useAppAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const loadAssignments = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/guard/training", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load training.");
      setAssignments(data.assignments ?? []);
    } catch (error: any) {
      toast({
        title: "Could not load training",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  return (
    <div className="space-y-4 p-4 pb-6">
      <div>
        <p className="text-sm text-gray-500">Growth & learning</p>
        <h1 className="text-lg font-bold text-gray-900">My Training</h1>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : assignments.length === 0 ? (
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="py-14 text-center">
            <GraduationCap className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-700">No training assigned yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {assignments.map((assignment) => (
            <Card key={assignment.id} className="rounded-2xl border-0 shadow-sm">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{assignment.moduleName || "Training module"}</p>
                    <p className="text-xs text-gray-500 capitalize">
                      {assignment.moduleCategory || "General"} · Assigned {formatTs(assignment.assignedAt)}
                    </p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium capitalize text-gray-700">
                    {assignment.status || "assigned"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Due: {formatTs(assignment.dueDate)}</span>
                  <span>Score: {typeof assignment.score === "number" ? `${assignment.score}%` : "—"}</span>
                </div>
                {assignment.contentUrl ? (
                  <Link href={assignment.contentUrl} target="_blank" className="inline-flex items-center text-sm font-medium text-[#014c85]">
                    <BookOpen className="mr-1.5 h-4 w-4" />
                    Open training material
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
