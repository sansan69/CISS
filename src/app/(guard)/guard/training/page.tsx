"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ExternalLink, GraduationCap, FileText, Presentation, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppAuth } from "@/context/auth-context";

type ContentType = "pdf" | "pptx" | "image";

type Assignment = {
  id: string;
  moduleName?: string;
  moduleCategory?: string;
  status?: string;
  score?: number;
  contentUrl?: string;
  contentType?: ContentType | null;
  contentFileName?: string | null;
  dueDate?: { seconds: number };
  assignedAt?: { seconds: number };
};

function officeEmbedUrl(publicUrl: string) {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(publicUrl)}`;
}

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
  const [viewer, setViewer] = useState<Assignment | null>(null);

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
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/guard/training/quiz/${assignment.id}`}
                    className="inline-flex h-8 items-center rounded-md bg-[#bd9c55] px-3 text-xs font-medium text-white hover:bg-[#a8884a]"
                  >
                    {assignment.status === "completed" || assignment.status === "failed" ? "Retake Quiz" : "Start Quiz"}
                  </Link>
                  {assignment.contentUrl ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1.5 bg-[#014c85] text-white hover:bg-[#013963]"
                        onClick={() => setViewer(assignment)}
                      >
                        {assignment.contentType === "pptx" ? (
                          <Presentation className="h-3.5 w-3.5" />
                        ) : assignment.contentType === "image" ? (
                          <ImageIcon className="h-3.5 w-3.5" />
                        ) : assignment.contentType === "pdf" ? (
                          <FileText className="h-3.5 w-3.5" />
                        ) : (
                          <BookOpen className="h-3.5 w-3.5" />
                        )}
                        Open material
                      </Button>
                      <Link
                        href={assignment.contentUrl}
                        target="_blank"
                        className="inline-flex items-center text-xs font-medium text-gray-500"
                      >
                        Download
                        <ExternalLink className="ml-1 h-3 w-3" />
                      </Link>
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {viewer?.contentUrl ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur">
          <div className="flex items-center justify-between gap-2 p-3 text-white">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{viewer.moduleName}</p>
              {viewer.contentFileName && (
                <p className="truncate text-xs text-white/70">{viewer.contentFileName}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Link
                href={viewer.contentUrl}
                target="_blank"
                className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
              >
                Download
              </Link>
              <Button type="button" size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => setViewer(null)}>
                Close
              </Button>
            </div>
          </div>
          <div className="relative flex-1 bg-white">
            {viewer.contentType === "image" ? (
              <img src={viewer.contentUrl} alt={viewer.moduleName || "Training material"} className="h-full w-full object-contain" />
            ) : viewer.contentType === "pptx" ? (
              <iframe
                title={viewer.moduleName || "Training material"}
                src={officeEmbedUrl(viewer.contentUrl)}
                className="h-full w-full"
                allow="fullscreen"
              />
            ) : (
              <iframe
                title={viewer.moduleName || "Training material"}
                src={viewer.contentUrl}
                className="h-full w-full"
                allow="fullscreen"
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
