"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react";
import { authorizedFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type RevisionEvent = {
  id: string;
  revisionNumber: number;
  changeType: string;
  siteName: string;
  district: string;
  date: string;
  previousMaleGuardsRequired: number;
  previousFemaleGuardsRequired: number;
  maleGuardsRequired: number;
  femaleGuardsRequired: number;
  affectedGuardCount: number;
  assignmentReviewRequired: boolean;
  acknowledged: boolean;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Date unavailable";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function WorkOrderRevisionNotices() {
  const [events, setEvents] = useState<RevisionEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [acknowledgingId, setAcknowledgingId] = useState("");

  const loadEvents = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await authorizedFetch("/api/field-officer/work-order-revisions");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Could not load revision changes.");
      setEvents(Array.isArray(payload.events) ? payload.events : []);
    } catch {
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const pendingEvents = useMemo(
    () => events.filter((event) => !event.acknowledged),
    [events],
  );

  const acknowledge = async (eventId: string) => {
    setAcknowledgingId(eventId);
    try {
      const response = await authorizedFetch("/api/field-officer/work-order-revisions", {
        method: "POST",
        body: JSON.stringify({ eventId }),
      });
      if (!response.ok) throw new Error("Could not acknowledge revision.");
      setEvents((current) =>
        current.map((event) =>
          event.id === eventId ? { ...event, acknowledged: true } : event,
        ),
      );
    } finally {
      setAcknowledgingId("");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking work-order revisions…
      </div>
    );
  }
  if (pendingEvents.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4 text-amber-700" />
              Work-order changes to review
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirm these changes before continuing guard allocation.
            </p>
          </div>
          <Badge variant="secondary">{pendingEvents.length} new</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {pendingEvents.slice(0, 12).map((event) => {
          const isCancelled = event.changeType === "cancelled";
          const needsReview = event.assignmentReviewRequired || event.affectedGuardCount > 0;
          return (
            <article key={event.id} className="rounded-lg border bg-background p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{event.siteName}</p>
                    <Badge variant={isCancelled ? "destructive" : "outline"} className="capitalize">
                      {event.changeType}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Revision {event.revisionNumber}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(event.date)} · {event.district}
                  </p>
                  <p className="mt-2 text-sm tabular-nums">
                    Male {event.previousMaleGuardsRequired} → {event.maleGuardsRequired}
                    <span className="mx-2 text-muted-foreground">·</span>
                    Female {event.previousFemaleGuardsRequired} → {event.femaleGuardsRequired}
                  </p>
                  {needsReview && (
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-amber-800">
                      <AlertTriangle className="h-4 w-4" />
                      {event.affectedGuardCount} assigned guard{event.affectedGuardCount === 1 ? "" : "s"} need review or reassignment.
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => acknowledge(event.id)}
                  disabled={acknowledgingId === event.id}
                >
                  {acknowledgingId === event.id
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Check className="mr-2 h-4 w-4" />}
                  Reviewed
                </Button>
              </div>
            </article>
          );
        })}
      </CardContent>
    </Card>
  );
}
