"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  Activity,
  ArrowRight,
  Briefcase,
  Building2,
  CalendarCheck,
  Clock3,
  FileText,
  GraduationCap,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { authorizedFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ClientDashboardPayload } from "@/types/client-dashboard";

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return format(parsed, "dd MMM · hh:mm a");
}

function formatDateOnly(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return format(parsed, "dd MMM yyyy");
}

function ClientDashboardSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 rounded-3xl" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}

const summaryCards = [
  {
    key: "checkedInToday",
    label: "Checked In Today",
    icon: CalendarCheck,
    color: "bg-emerald-50 text-emerald-700",
  },
  {
    key: "onDutyNow",
    label: "Currently On Duty",
    icon: Activity,
    color: "bg-brand-blue/10 text-brand-blue",
  },
  {
    key: "deploymentsToday",
    label: "Planned Deployments",
    icon: Briefcase,
    color: "bg-amber-50 text-amber-700",
  },
  {
    key: "pendingVisitReports",
    label: "Reports Awaiting Review",
    icon: FileText,
    color: "bg-slate-100 text-slate-700",
  },
] as const;

export function ClientOperationsDashboard() {
  const [data, setData] = useState<ClientDashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);

    authorizedFetch("/api/client/dashboard")
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error || "Could not load client dashboard.");
        }
        if (!active) return;
        setData(json);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load client dashboard.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (isLoading) {
    return <ClientDashboardSkeleton />;
  }

  if (error || !data) {
    return (
      <Card className="rounded-3xl border-border/60">
        <CardContent className="py-16">
          <EmptyState
            icon={Building2}
            title="Client dashboard unavailable"
            description={error || "Could not load the current client summary."}
          />
        </CardContent>
      </Card>
    );
  }

  const { summary } = data;

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-3xl border border-brand-blue/10 bg-[radial-gradient(circle_at_top_right,_rgba(189,156,85,0.18),_transparent_34%),linear-gradient(135deg,#0c4576_0%,#0f5c97_48%,#f8fbff_180%)] p-5 text-white shadow-brand-md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/72">
              <ShieldCheck className="h-3.5 w-3.5" />
              Client Operations
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">{summary.clientName}</h2>
              <p className="mt-1 max-w-2xl text-sm text-white/78">
                Live view of attendance, deployment coverage, field activity, and training follow-up for your sites.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:min-w-[360px]">
            <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur-sm">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/60">Sites Covered</p>
              <p className="mt-2 text-3xl font-bold">{summary.sitesCovered}</p>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur-sm">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/60">Active Guards</p>
              <p className="mt-2 text-3xl font-bold">{summary.activeGuards}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          const value = summary[card.key];
          return (
            <Card key={card.key} className="rounded-2xl border-border/60 shadow-card">
              <CardContent className="flex items-start justify-between gap-4 p-5">
                <div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums">{value.toLocaleString()}</p>
                </div>
                <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", card.color)}>
                  <Icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-2xl border-border/60 shadow-card">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Live Attendance</CardTitle>
              <CardDescription>
                {summary.checkedInToday} checked in, {summary.checkedOutToday} checked out, {summary.onDutyNow} currently active.
              </CardDescription>
            </div>
            <Link href="/attendance-logs" className="text-sm font-semibold text-brand-blue hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.liveAttendance.length === 0 ? (
              <EmptyState
                icon={CalendarCheck}
                compact
                title="No attendance yet today"
                description="Guard check-ins will appear here as they are submitted."
              />
            ) : (
              data.liveAttendance.map((row) => (
                <div key={row.id} className="flex items-center gap-3 rounded-2xl border border-border/60 px-4 py-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-brand-blue/10 text-brand-blue">
                      {row.employeeName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{row.employeeName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.siteName || "Site"} · {formatDateTime(row.reportedAt)}
                    </p>
                  </div>
                  <Badge variant={row.status === "In" ? "active" : "secondary"}>{row.status}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/60 shadow-card">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Top Sites</CardTitle>
              <CardDescription>Current activity and upcoming duty coverage by site.</CardDescription>
            </div>
            <Link href="/work-orders" className="text-sm font-semibold text-brand-blue hover:underline">
              Deployments
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.siteSnapshots.length === 0 ? (
              <EmptyState
                icon={Building2}
                compact
                title="No linked sites yet"
                description="Once sites are mapped to this client, the operational summary appears here."
              />
            ) : (
              data.siteSnapshots.map((site) => (
                <div key={site.siteId || site.siteName} className="rounded-2xl border border-border/60 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{site.siteName}</p>
                      <p className="text-xs text-muted-foreground">{site.district || "District pending"}</p>
                    </div>
                    <Badge variant="outline">{site.onDutyNow} on duty</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{site.checkedInToday} checked in today</span>
                    <span>{site.upcomingDuties} upcoming duty slots</span>
                    <span>{formatDateOnly(site.nextDutyDate)}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl border-border/60 shadow-card">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Upcoming Work Orders</CardTitle>
              <CardDescription>Upcoming exam and deployment duties for this client.</CardDescription>
            </div>
            <Link href="/work-orders" className="text-sm font-semibold text-brand-blue hover:underline">
              View board
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.upcomingWorkOrders.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                compact
                title="No upcoming work orders"
                description="Future deployment requirements will show here."
              />
            ) : (
              data.upcomingWorkOrders.map((row) => (
                <div key={row.id} className="flex items-center gap-3 rounded-2xl border border-border/60 px-4 py-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-blue/10 text-brand-blue">
                    <Clock3 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{row.siteName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.examName || "Duty"} · {row.district || "District pending"} · {formatDateOnly(row.date)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{row.assignedCount}/{row.totalManpower}</p>
                    <p className="text-[11px] text-muted-foreground">assigned</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/60 shadow-card">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Guard Highlights</CardTitle>
              <CardDescription>Quick access to active workforce records for this client.</CardDescription>
            </div>
            <Link href="/employees" className="text-sm font-semibold text-brand-blue hover:underline">
              Open roster
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.guardHighlights.length === 0 ? (
              <EmptyState
                icon={Users}
                compact
                title="No guards mapped yet"
                description="Employee records for this client will appear here."
              />
            ) : (
              data.guardHighlights.map((guard) => (
                <Link
                  key={guard.id}
                  href={`/employees/${guard.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-border/60 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={guard.profilePictureUrl || undefined} />
                    <AvatarFallback className="bg-brand-blue/10 text-brand-blue">
                      {guard.fullName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{guard.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {guard.employeeId} · {guard.district || "District pending"}
                    </p>
                  </div>
                  <Badge variant={guard.status === "Active" ? "active" : "secondary"}>{guard.status}</Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl border-border/60 shadow-card">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Visit Reports</CardTitle>
              <CardDescription>Recent field officer visits and review status.</CardDescription>
            </div>
            <Link href="/visit-reports" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline">
              Open reports <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentVisitReports.length === 0 ? (
              <EmptyState
                icon={FileText}
                compact
                title="No visit reports yet"
                description="Field officer site visits will appear here."
              />
            ) : (
              data.recentVisitReports.map((report) => (
                <div key={report.id} className="rounded-2xl border border-border/60 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{report.siteName || "Site Visit"}</p>
                      <p className="text-xs text-muted-foreground">
                        {report.fieldOfficerName} · {report.district || "District pending"}
                      </p>
                    </div>
                    <Badge variant={report.status === "reviewed" ? "active" : "outline"}>{report.status}</Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{report.summary}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">{formatDateOnly(report.visitDate || report.createdAt)}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/60 shadow-card">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Training Reports</CardTitle>
              <CardDescription>Latest training sessions completed for your workforce.</CardDescription>
            </div>
            <Link href="/training-reports" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline">
              Open reports <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentTrainingReports.length === 0 ? (
              <EmptyState
                icon={GraduationCap}
                compact
                title="No training reports yet"
                description="Completed site trainings will appear here."
              />
            ) : (
              data.recentTrainingReports.map((report) => (
                <div key={report.id} className="rounded-2xl border border-border/60 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{report.topic}</p>
                      <p className="text-xs text-muted-foreground">
                        {report.siteName || "Site"} · {report.attendeeCount} attendees
                      </p>
                    </div>
                    <Badge variant={report.status === "acknowledged" ? "active" : "outline"}>{report.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {report.fieldOfficerName} · {formatDateOnly(report.trainingDate || report.createdAt)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
