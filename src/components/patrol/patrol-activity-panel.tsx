"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, Clock3, Footprints, MapPin, ShieldCheck } from "lucide-react";
import { format } from "date-fns";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authorizedFetch } from "@/lib/api-client";
import { useAppAuth } from "@/context/auth-context";
import type { GuardPatrolActivityRow, PatrolActivityListPayload } from "@/types/patrol";

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return format(parsed, "dd MMM · hh:mm a");
}

function PatrolActivityList({ activities }: { activities: GuardPatrolActivityRow[] }) {
  if (activities.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No patrol activity yet"
        description="Hourly night-photo submissions and patrol rounds will appear here once guards start logging them."
      />
    );
  }

  return (
    <div className="space-y-3">
      {activities.map((activity) => (
        <div
          key={activity.id}
          className="rounded-2xl border border-border/60 bg-card/70 px-4 py-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{activity.guardName}</p>
                <Badge variant={activity.type === "hourly_photo" ? "secondary" : "outline"}>
                  {activity.type === "hourly_photo" ? "Hourly Photo" : "Patrol Round"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {activity.siteName}
                {activity.dutyPointName ? ` · ${activity.dutyPointName}` : ""}
                {activity.shiftLabel ? ` · ${activity.shiftLabel}` : ""}
                {` · ${formatDateTime(activity.activityAt ?? activity.createdAt)}`}
              </p>
              {activity.patrolPointName ? (
                <p className="mt-2 text-sm text-foreground/90">
                  Patrol point: <strong>{activity.patrolPointName}</strong>
                </p>
              ) : null}
              {activity.notes ? (
                <p className="mt-2 text-sm text-foreground/80">{activity.notes}</p>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-muted-foreground">{activity.district || "District"}</p>
              {activity.photoUrl ? (
                <a
                  href={activity.photoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-blue hover:underline"
                >
                  <Camera className="h-3.5 w-3.5" />
                  View photo
                </a>
              ) : (
                <span className="mt-2 inline-flex text-xs text-muted-foreground">No photo</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PatrolActivityPanel() {
  const { userRole } = useAppAuth();
  const isClient = userRole === "client";
  const [data, setData] = useState<PatrolActivityListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userRole) return;
    let active = true;
    setLoading(true);
    setError(null);

    authorizedFetch(isClient ? "/api/client/patrol-activities" : "/api/admin/patrol-activities")
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error || "Could not load patrol activity.");
        }
        if (!active) return;
        setData(json);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load patrol activity.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isClient, userRole]);

  const summaryCards = useMemo(() => {
    if (!data) return [];
    return [
      { label: "All activity", value: data.summary.total, icon: ShieldCheck },
      { label: "Hourly photos", value: data.summary.hourlyPhotos, icon: Clock3 },
      { label: "Patrol rounds", value: data.summary.patrolRounds, icon: Footprints },
      { label: "Sites covered", value: data.summary.activeSites, icon: MapPin },
    ];
  }, [data]);

  return (
    <div className="page-content space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Patrol Activity"
        description={
          isClient
            ? "Review hourly night-photo proofs and site patrol rounds for your guarded locations."
            : "Monitor hourly night-photo proofs and patrol rounds across guarded sites."
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Patrol Activity" },
        ]}
      />

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-28 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : error || !data ? (
        <Card className="rounded-3xl border-border/60">
          <CardContent className="py-16">
            <EmptyState
              icon={ShieldCheck}
              title="Patrol activity unavailable"
              description={error || "Could not load patrol data."}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((card) => {
              const Icon = card.icon;
              return (
                <Card key={card.label} className="rounded-2xl border-border/60 shadow-card">
                  <CardContent className="flex items-start justify-between gap-4 p-5">
                    <div>
                      <p className="text-sm text-muted-foreground">{card.label}</p>
                      <p className="mt-2 text-3xl font-bold tabular-nums">{card.value}</p>
                    </div>
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-blue/10 text-brand-blue">
                      <Icon className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="rounded-2xl border-border/60 shadow-card">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>
                Latest hourly night checks and patrol rounds reported from the guard app.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PatrolActivityList activities={data.activities} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
