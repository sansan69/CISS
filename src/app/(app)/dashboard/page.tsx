"use client";

import {
  Users, UserCheck, UserMinus, Clock,
  ArrowRight, UserPlus, AlertCircle as AlertIcon, AlertCircle,
  CalendarClock, QrCode, Briefcase, TrendingUp,
  ShieldCheck, Star, ChevronRight, Activity, Globe,
  AlertTriangle, CheckCircle2, MapPin, Building,
} from "lucide-react";
import React, { useEffect, useState, useMemo, useRef } from "react";
import { db } from '@/lib/firebase';
import {
  collection, query, where,
  Timestamp, orderBy, limit, onSnapshot, type Query,
} from "firebase/firestore";
import type { Employee } from "@/types/employee";
import { format, subMonths, startOfMonth, startOfToday, addDays, endOfDay } from 'date-fns';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Badge } from "@/components/ui/badge";
import { useAppAuth } from '@/context/auth-context';
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { authorizedFetch } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import type { RegionOverviewCard, SuperAdminOverviewSummary } from "@/types/region";
import { DashboardStats } from "@/components/dashboard/stats";
import { DashboardCharts } from "@/components/dashboard/charts";
import { DashboardActions } from "@/components/dashboard/actions";
import { ClientOperationsDashboard } from "@/components/dashboard/client-operations-dashboard";
import LiveGuardsSection from "@/components/dashboard/live-guards-section";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface DashboardStats  { total: number; active: number; inactiveOrExited: number; }
interface NewHiresData    { month: string; hires: number; }
interface RecentActivity  { id: string; text: string; subtext: string; timestamp: Date; }
interface UpcomingDuty    { id: string; siteName: string; clientName: string; date: Date; totalManpower: number; }
interface ClientCoverage  {
  clientName: string;
  totalGuards: number;
  activeGuards: number;
  checkedInToday: number;      // unique employees with status=In today
  coveragePct: number;         // checkedInToday / activeGuards * 100
  complianceClear: number;     // % photo compliance 'clear' today
  mockLocationAlerts: number;  // isMockLocationSuspected count today
  districts: string[];         // unique districts
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const getAttendanceTime = (log: any): Date | null => {
  if (log?.reportedAt?.toDate) return log.reportedAt.toDate();
  if (typeof log?.reportedAtClient === 'string') {
    const d = new Date(log.reportedAtClient);
    if (!isNaN(d.getTime())) return d;
  }
  return log?.createdAt?.toDate ? log.createdAt.toDate() : null;
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick actions
// ─────────────────────────────────────────────────────────────────────────────
const quickActions = [
  { label: "Attendance",  href: "/attendance",       icon: QrCode,    color: "bg-brand-blue/10 text-brand-blue" },
  { label: "Enroll",      href: "/employees/enroll", icon: UserPlus,  color: "bg-green-50 text-green-700" },
  { label: "Work Orders", href: "/work-orders",      icon: Briefcase, color: "bg-amber-50 text-amber-700" },
  { label: "Leaderboard", href: "/leaderboard",      icon: Star,      color: "bg-purple-50 text-purple-700" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton shimmer blocks
// ─────────────────────────────────────────────────────────────────────────────
function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("rounded-xl animate-shimmer", className)} />;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-1">
      <SkeletonBlock className="h-11 w-11 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <SkeletonBlock className="h-3.5 w-3/5" />
        <SkeletonBlock className="h-3 w-2/5" />
      </div>
      <SkeletonBlock className="h-6 w-10 rounded-lg shrink-0" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Overview — scrollable coverage cards + ranked strength list
// ─────────────────────────────────────────────────────────────────────────────

function coverageColor(pct: number) {
  if (pct >= 70) return { bar: "bg-emerald-500", text: "text-emerald-600", bg: "bg-emerald-50" };
  if (pct >= 35) return { bar: "bg-amber-400",   text: "text-amber-600",   bg: "bg-amber-50" };
  return               { bar: "bg-red-400",       text: "text-red-600",     bg: "bg-red-50" };
}

function ClientCoverageCards({ data, isLoading }: { data: ClientCoverage[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="-mx-4 sm:mx-0">
        <div className="flex gap-3 overflow-x-auto scrollbar-none px-4 sm:px-0 pb-1">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="rounded-2xl border border-border/60 p-4 min-w-[152px] shrink-0 space-y-3">
              <SkeletonBlock className="h-3.5 w-24" />
              <SkeletonBlock className="h-7 w-14" />
              <SkeletonBlock className="h-2 w-full rounded-full" />
              <SkeletonBlock className="h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data.length) return null;

  return (
    <div className="-mx-4 sm:mx-0">
      <div className="flex gap-3 overflow-x-auto scrollbar-none px-4 sm:px-0 pb-1">
        {data.map(client => {
          const col = coverageColor(client.coveragePct);
          return (
            <div
              key={client.clientName}
              className="relative overflow-hidden rounded-2xl bg-card border border-border/60 shadow-card p-4 min-w-[152px] shrink-0 flex flex-col gap-2"
            >
              {/* Colour top accent */}
              <div className={cn("absolute top-0 left-0 right-0 h-1 rounded-t-2xl", col.bar)} />

              {/* Client name */}
              <p className="text-xs font-bold text-foreground truncate leading-tight mt-1 pr-1" title={client.clientName}>
                {client.clientName}
              </p>

              {/* Big checked-in number */}
              <div className="flex items-end gap-1.5">
                <span className={cn("text-2xl font-bold tabular-nums leading-none", col.text)}>
                  {client.checkedInToday}
                </span>
                <span className="text-xs text-muted-foreground mb-0.5 leading-none">
                  / {client.activeGuards}
                </span>
              </div>

              {/* Coverage bar */}
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all duration-700", col.bar)}
                  style={{ width: `${Math.min(client.coveragePct, 100)}%` }}
                />
              </div>

              {/* Footer row */}
              <div className="flex items-center justify-between gap-1 mt-0.5">
                <span className="text-[10px] text-muted-foreground font-medium">
                  {Math.round(client.coveragePct)}% on duty
                </span>
                {client.mockLocationAlerts > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-red-500 font-semibold">
                    <AlertTriangle className="h-3 w-3" />
                    {client.mockLocationAlerts}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Ranked table: top clients by guard strength */
function ClientStrengthTable({ data, isLoading }: { data: ClientCoverage[]; isLoading: boolean }) {
  const sorted = [...data].sort((a, b) => b.totalGuards - a.totalGuards);
  const max = sorted[0]?.totalGuards || 1;

  return (
    <Card>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="divide-y divide-border/60 px-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="py-3 space-y-2">
                <SkeletonBlock className="h-3.5 w-32" />
                <SkeletonBlock className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState icon={Building} compact title="No client data yet" />
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {sorted.map((client, idx) => {
              const col = coverageColor(client.coveragePct);
              return (
                <div key={client.clientName} className="flex items-center gap-3 px-4 py-3">
                  {/* Rank */}
                  <span className="text-xs font-bold text-muted-foreground/60 w-4 shrink-0 tabular-nums">
                    {idx + 1}
                  </span>
                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-sm font-semibold truncate">{client.clientName}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        {client.mockLocationAlerts > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-500">
                            <AlertTriangle className="h-3 w-3" />
                            {client.mockLocationAlerts} alert{client.mockLocationAlerts > 1 ? 's' : ''}
                          </span>
                        )}
                        <span className={cn("text-xs font-bold tabular-nums", col.text)}>
                          {client.checkedInToday}/{client.activeGuards}
                        </span>
                      </div>
                    </div>
                    {/* Stacked bar: active (green) on top of total */}
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-blue/20 relative overflow-hidden"
                        style={{ width: `${(client.totalGuards / max) * 100}%` }}
                      >
                        <div
                          className={cn("absolute inset-y-0 left-0 rounded-full", col.bar)}
                          style={{ width: `${client.coveragePct}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-muted-foreground">
                        {client.totalGuards} total · {client.activeGuards} active
                      </span>
                      {Array.isArray(client.districts) && client.districts.length > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <MapPin className="h-2.5 w-2.5" />
                          {client.districts.slice(0, 2).join(', ')}
                          {client.districts.length > 2 && ` +${client.districts.length - 2}`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StatCard — mobile-optimised with colour bar
// ─────────────────────────────────────────────────────────────────────────────
const statDefs = [
  { key: "total",           label: "Total Guards",     barColor: "bg-brand-blue",   icon: Users,     iconBg: "bg-brand-blue/10 text-brand-blue" },
  { key: "active",          label: "Active",           barColor: "bg-emerald-500",  icon: UserCheck, iconBg: "bg-emerald-50 text-emerald-700" },
  { key: "inactiveOrExited",label: "Inactive / Exited",barColor: "bg-red-400",      icon: UserMinus, iconBg: "bg-red-50 text-red-500" },
];

function StatGrid({ stats, isLoading }: { stats: DashboardStats | null; isLoading: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {statDefs.map((def, i) => {
        const value = stats?.[def.key as keyof DashboardStats];
        const Icon  = def.icon;
        return (
          <div
            key={def.key}
            className={cn(
              "relative overflow-hidden rounded-2xl bg-card border border-border/60 p-4 shadow-card",
              "animate-slide-up",
              i === 0 && "stagger-1", i === 1 && "stagger-2",
              i === 2 && "stagger-3", i === 3 && "stagger-4",
            )}
          >
            {/* Colour top bar */}
            <div className={cn("absolute top-0 left-0 right-0 h-1 rounded-t-2xl", def.barColor)} />

            <div className="flex items-start justify-between gap-2 mt-1">
              <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl shrink-0", def.iconBg)}>
                <Icon className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-3">
              {isLoading ? (
                <SkeletonBlock className="h-8 w-16 mb-1" />
              ) : (
                <p className="text-3xl font-bold text-foreground leading-none tabular-nums animate-count-up">
                  {value?.toLocaleString() ?? "—"}
                </p>
              )}
              <p className="text-[11px] font-medium text-muted-foreground mt-1.5 uppercase tracking-wide leading-none">
                {def.label}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick Actions — edge-to-edge horizontal scroll (native feel)
// ─────────────────────────────────────────────────────────────────────────────
function QuickActions() {
  return (
    <div>
      <p className="section-label mb-3">Quick Actions</p>
      {/* -mx-4 + px-4 makes it bleed edge-to-edge on mobile like native apps */}
      <div className="-mx-4 sm:mx-0">
        <div className="flex gap-3 overflow-x-auto scrollbar-none px-4 sm:px-0 pb-1">
          {quickActions.map(action => (
            <Link
              key={action.href}
              href={action.href}
              className="flex flex-col items-center gap-2.5 rounded-2xl bg-card border border-border/60 shadow-card p-4 min-w-[80px] press-scale shrink-0 transition-shadow hover:shadow-brand-sm"
            >
              <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", action.color)}>
                <action.icon className="h-5 w-5" />
              </div>
              <span className="text-[11px] font-semibold text-muted-foreground text-center leading-tight">
                {action.label}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function SuperAdminOverviewPanel({
  summary,
  regions,
  isLoading,
  error,
}: {
  summary: SuperAdminOverviewSummary | null;
  regions: RegionOverviewCard[];
  isLoading: boolean;
  error: string | null;
}) {
  return (
    <div className="page-content">
      <PageHeader
        title="All Regions Overview"
        description="Super admin view of all connected regional backends."
        actions={
          <Button asChild>
            <Link href="/settings/state-management">Region Onboarding</Link>
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Could not load consolidated data</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Connected Regions</p><p className="mt-2 text-3xl font-bold text-brand-blue">{isLoading ? "..." : `${summary?.connectedRegions ?? 0}/${summary?.totalRegions ?? 0}`}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Employees</p><p className="mt-2 text-3xl font-bold">{isLoading ? "..." : summary?.employees ?? 0}</p><p className="mt-1 text-xs text-muted-foreground">{isLoading ? "" : `${summary?.activeEmployees ?? 0} active`}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Clients & Field Officers</p><p className="mt-2 text-3xl font-bold">{isLoading ? "..." : summary?.clients ?? 0}</p><p className="mt-1 text-xs text-muted-foreground">{isLoading ? "" : `${summary?.fieldOfficers ?? 0} field officers`}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Today&apos;s Attendance</p><p className="mt-2 text-3xl font-bold">{isLoading ? "..." : summary?.attendanceToday ?? 0}</p><p className="mt-1 text-xs text-muted-foreground">{isLoading ? "" : `${summary?.upcomingWorkOrders ?? 0} upcoming work orders`}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Region Health</CardTitle>
          <CardDescription>
            Each region uses its own Firebase backend. Connected regions contribute live totals here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <SkeletonBlock key={i} className="h-24" />
              ))}
            </div>
          ) : regions.length === 0 ? (
            <EmptyState icon={Globe} title="No regions yet" description="Start by onboarding the next region." />
          ) : (
            regions.map((region) => (
              <div key={region.regionCode} className="rounded-2xl border border-border/60 p-4 shadow-card">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-foreground">{region.regionName}</p>
                      <Badge variant={region.connectionStatus === "connected" ? "default" : "secondary"}>
                        {region.regionCode}
                      </Badge>
                      <Badge variant="outline">{region.status}</Badge>
                      <Badge
                        variant={
                          region.connectionStatus === "connected"
                            ? "default"
                            : region.connectionStatus === "needs_credentials"
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {region.connectionStatus === "connected"
                          ? "Connected"
                          : region.connectionStatus === "needs_credentials"
                            ? "Reconnect needed"
                            : "Connection error"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{region.firebaseProjectId}</p>
                    {region.regionAdminEmail ? (
                      <p className="text-xs text-muted-foreground">Region admin: {region.regionAdminEmail}</p>
                    ) : null}
                    {region.vercelProductionUrl || region.vercelProjectUrl ? (
                      <div className="flex flex-wrap gap-3 pt-1 text-xs">
                        {region.vercelProductionUrl ? (
                          <Link
                            href={region.vercelProductionUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-brand-blue hover:underline"
                          >
                            Regional App
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        ) : null}
                        {region.vercelProjectUrl ? (
                          <Link
                            href={region.vercelProjectUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                          >
                            Vercel Project
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                    {region.connectionNote ? (
                      <p className="text-xs text-amber-700">{region.connectionNote}</p>
                    ) : null}
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/settings/state-management">Manage Region</Link>
                  </Button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  <div className="rounded-xl bg-muted/40 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Employees</p><p className="mt-1 text-xl font-bold">{region.totals.employees}</p></div>
                  <div className="rounded-xl bg-muted/40 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Active</p><p className="mt-1 text-xl font-bold text-emerald-600">{region.totals.activeEmployees}</p></div>
                  <div className="rounded-xl bg-muted/40 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Clients</p><p className="mt-1 text-xl font-bold">{region.totals.clients}</p></div>
                  <div className="rounded-xl bg-muted/40 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Field Officers</p><p className="mt-1 text-xl font-bold">{region.totals.fieldOfficers}</p></div>
                  <div className="rounded-xl bg-muted/40 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Attendance Today</p><p className="mt-1 text-xl font-bold">{region.totals.attendanceToday}</p><p className="text-[10px] text-muted-foreground">{region.totals.upcomingWorkOrders} work orders</p></div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats, setStats]                   = useState<DashboardStats | null>(null);
  const [newHiresData, setNewHiresData]     = useState<NewHiresData[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [upcomingDuties, setUpcomingDuties] = useState<UpcomingDuty[]>([]);
  const [activeChartTab, setActiveChartTab] = useState<'hires' | 'distribution'>('hires');
  // Intermediate state for admin coverage — combined via useMemo
  const [clientGuardMap, setClientGuardMap] = useState<Map<string, { total: number; active: number; districts: Set<string> }> | null>(null);
  const [todayAttendanceDocs, setTodayAttendanceDocs] = useState<any[]>([]);
  const [superAdminSummary, setSuperAdminSummary] = useState<SuperAdminOverviewSummary | null>(null);
  const [superAdminRegions, setSuperAdminRegions] = useState<RegionOverviewCard[]>([]);
  const [superAdminLoading, setSuperAdminLoading] = useState(false);
  const [superAdminError, setSuperAdminError] = useState<string | null>(null);

  const [isLoading, setIsLoading]         = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const { user: currentUser, userRole, assignedDistricts, isSuperAdmin } = useAppAuth();

  // Client coverage: computed reactively from both live data sources
  const clientCoverage = useMemo<ClientCoverage[]>(() => {
    if (!clientGuardMap) return [];
    const clientCheckedIn  = new Map<string, Set<string>>();
    const clientMockAlerts = new Map<string, number>();
    const clientCompliance = new Map<string, { clear: number; total: number }>();
    todayAttendanceDocs.forEach(log => {
      const cn = log.clientName || 'Unassigned';
      if (log.status === 'In') {
        if (!clientCheckedIn.has(cn)) clientCheckedIn.set(cn, new Set());
        clientCheckedIn.get(cn)!.add(log.employeeId);
      }
      if (log.isMockLocationSuspected) clientMockAlerts.set(cn, (clientMockAlerts.get(cn) ?? 0) + 1);
      if (log.photoCompliance?.overallStatus) {
        if (!clientCompliance.has(cn)) clientCompliance.set(cn, { clear: 0, total: 0 });
        const comp = clientCompliance.get(cn)!;
        comp.total++;
        if (log.photoCompliance.overallStatus === 'clear') comp.clear++;
      }
    });
    const coverage: ClientCoverage[] = [];
    clientGuardMap.forEach((guards, clientName) => {
      if (clientName === 'Unassigned' && guards.total === 0) return;
      const checkedIn = clientCheckedIn.get(clientName)?.size ?? 0;
      const comp      = clientCompliance.get(clientName);
      coverage.push({
        clientName,
        totalGuards:        guards.total,
        activeGuards:       guards.active,
        checkedInToday:     checkedIn,
        coveragePct:        guards.active > 0 ? Math.round((checkedIn / guards.active) * 100) : 0,
        complianceClear:    comp ? Math.round((comp.clear / comp.total) * 100) : 0,
        mockLocationAlerts: clientMockAlerts.get(clientName) ?? 0,
        districts:          Array.from(guards.districts).sort(),
      });
    });
    coverage.sort((a, b) => b.totalGuards - a.totalGuards);
    return coverage;
  }, [clientGuardMap, todayAttendanceDocs]);

  // Real-time data subscriptions — fire from IndexedDB cache instantly, then sync from server
  useEffect(() => {
    if (isSuperAdmin || userRole === 'client') {
      setIsLoading(false);
      return;
    }
    if (userRole === null) return;
    const cleanups: Array<() => void> = [];
    const firstFired = { emp: false };

    const includeCharts = userRole !== 'fieldOfficer' && userRole !== 'client';
    const sixMonthsAgo  = startOfMonth(subMonths(new Date(), 5));
    const coerce = (v: any): Date | null => {
      if (!v) return null;
      if (typeof v.toDate === 'function') return v.toDate();
      const p = new Date(v); return isNaN(p.getTime()) ? null : p;
    };

    // ── Employee subscription (stats + charts + recent activity) ────────────
    let empQ: any = collection(db, "employees");

    // Field officer with no districts: nothing to show
    if (userRole === 'fieldOfficer' && assignedDistricts.length === 0) {
      setIsLoading(false);
      return;
    }

    const monthStarts = Array.from({ length: 6 }, (_, i) => startOfMonth(subMonths(new Date(), 5 - i)));
    const monthLabels = monthStarts.map(d => format(d, 'MMM yyyy'));

    const unsub1 = onSnapshot(empQ as Query, (snap) => {
      let total = 0, active = 0, inactiveOrExited = 0;
      const byMonth: Record<string, number> = Object.fromEntries(monthLabels.map(l => [l, 0]));
      const newGuardMap = new Map<string, { total: number; active: number; districts: Set<string> }>();
      const sortable: Array<{ id: string; data: Employee; ts: number }> = [];

      snap.docs.forEach(d => {
        const emp = d.data() as Employee;
        if (userRole === 'fieldOfficer' && assignedDistricts.length > 0) {
          const matchesDistrict = assignedDistricts.some((district) => district === (emp as any).district);
          if (!matchesDistrict) return;
        }
        total++;
        if (emp.status === 'Active') active++;
        else if (emp.status === 'Inactive' || emp.status === 'Exited') inactiveOrExited++;

        if (includeCharts) {
          const date = coerce(emp.createdAt as any) || coerce((emp as any).joiningDate);
          if (date && date >= sixMonthsAgo) {
            const k = format(startOfMonth(date), 'MMM yyyy');
            if (k in byMonth) byMonth[k]++;
          }
          const cn = emp.clientName || 'Unassigned';
          if (!newGuardMap.has(cn)) newGuardMap.set(cn, { total: 0, active: 0, districts: new Set() });
          const entry = newGuardMap.get(cn)!;
          entry.total++;
          if (emp.status === 'Active') entry.active++;
          if ((emp as any).district) entry.districts.add((emp as any).district);
        }

        sortable.push({ id: d.id, data: emp, ts: (emp.createdAt as any)?.toMillis?.() ?? 0 });
      });

      setStats({ total, active, inactiveOrExited });
      if (includeCharts) {
        setNewHiresData(monthLabels.map(m => ({ month: m, hires: byMonth[m] })));
        setClientGuardMap(newGuardMap);
      }
      sortable.sort((a, b) => b.ts - a.ts);
      setRecentActivity(
        sortable.slice(0, 5).map(({ id, data }) => {
          const createdAt = coerce((data as any).createdAt) || coerce((data as any).joiningDate) || new Date();

          return {
            id,
            text:
              data.fullName ||
              (data as any).name ||
              data.employeeId ||
              (data as any).employeeCode ||
              "Unknown employee",
            subtext: `${data.clientName || 'Unassigned'} · ${data.status || 'Unknown'}`,
            timestamp: createdAt,
          };
        })
      );

      if (!firstFired.emp) { firstFired.emp = true; setIsLoading(false); }
    }, (err: any) => {
      let msg = "Failed to load dashboard data.";
      if (err.code === 'permission-denied') msg = "Permission denied — check Firestore rules.";
      if (err.code === 'failed-precondition') msg = "A required database index is missing.";
      setError(msg);
      setIsLoading(false);
    });
    cleanups.push(unsub1);

    // ── Upcoming duties (field officer) ──────────────────────────────────────
    if (userRole === 'fieldOfficer' && assignedDistricts.length > 0) {
      const unsub2 = onSnapshot(
        query(
          collection(db, "workOrders"),
          where("date", ">=", Timestamp.fromDate(startOfToday())),
          where("date", "<=", Timestamp.fromDate(endOfDay(addDays(new Date(), 6)))),
          orderBy("date", "asc"), limit(10)
        ),
        (snap) => setUpcomingDuties(
          snap.docs
            .map(d => {
              const data = d.data();
              return {
                id: d.id,
                siteName: data.siteName,
                clientName: data.clientName,
                district: data.district,
                date: (data.date as Timestamp).toDate(),
                totalManpower: data.totalManpower,
              };
            })
            .filter((duty) => isOperationalWorkOrderClientName(duty.clientName))
            .filter((duty) => assignedDistricts.includes(duty.district))
        )
      );
      cleanups.push(unsub2);
    }

    // ── Today's attendance for admin coverage ─────────────────────────────────
    if (includeCharts) {
      const unsub3 = onSnapshot(
        query(
          collection(db, 'attendanceLogs'),
          where('createdAt', '>=', Timestamp.fromDate(startOfToday())),
          orderBy('createdAt', 'desc')
        ),
        (snap) => setTodayAttendanceDocs(snap.docs.map(d => d.data() as any))
      );
      cleanups.push(unsub3);
    }

    return () => cleanups.forEach(u => u());
  }, [userRole, assignedDistricts, isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin) return;

    let active = true;
    setSuperAdminLoading(true);
    setSuperAdminError(null);

    authorizedFetch("/api/super-admin/overview")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Could not load consolidated overview.");
        }
        if (!active) return;
        setSuperAdminSummary(data.summary ?? null);
        setSuperAdminRegions(data.regions ?? []);
      })
      .catch((err: any) => {
        if (!active) return;
        setSuperAdminError(err?.message || "Could not load consolidated overview.");
      })
      .finally(() => {
        if (active) setSuperAdminLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isSuperAdmin]);

  const chartConfig = {
    hires: { label: "New Hires", color: "hsl(var(--chart-1))" },
  };

  // ─── Error state ─────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center px-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
          <AlertIcon className="h-7 w-7 text-destructive" />
        </div>
        <div>
          <p className="font-semibold text-foreground">Something went wrong</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  const userName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'there';
  const todayLabel = format(new Date(), "EEEE, d MMM");

  if (isSuperAdmin) {
    return (
      <SuperAdminOverviewPanel
        summary={superAdminSummary}
        regions={superAdminRegions}
        isLoading={superAdminLoading}
        error={superAdminError}
      />
    );
  }

  return (
    <div className="page-content">

      {/* ── Greeting ─────────────────────────────────────────────────────── */}
      <div className="animate-slide-down">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{todayLabel}</p>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground capitalize mt-0.5 leading-tight">
              {getGreeting()}, {userName} 👋
            </h1>
          </div>
          {/* Active badge */}
          {userRole !== 'client' && !isLoading && stats && (
            <div className="flex flex-col items-end shrink-0">
              <span className="text-2xl font-bold text-emerald-600 tabular-nums leading-none">
                {stats.active}
              </span>
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mt-0.5">
                on duty
              </span>
            </div>
          )}
        </div>
      </div>

      {userRole === 'client' ? (
        <ClientOperationsDashboard />
      ) : (
        <>
      {/* ── Stat Cards 2×2 ───────────────────────────────────────────────── */}
      {stats && (
        <DashboardStats 
          role={userRole as any} 
          stats={stats}
        />
      )}

      {/* ── Quick Actions (admin + FO) ────────────────────────────────────── */}
      {userRole !== 'client' && <DashboardActions role={userRole as any} />}

      {/* ── Live Guard Locations (admin + FO) ────────────────────────────── */}
      {userRole !== 'client' && (
        <LiveGuardsSection
          district={
            userRole === 'fieldOfficer' && assignedDistricts?.length
              ? assignedDistricts[0]
              : undefined
          }
        />
      )}

      {/* ── Field Officer: Upcoming Duties ───────────────────────────────── */}
      {userRole === 'fieldOfficer' && (
        <div>
          <p className="section-label mb-3">Upcoming Duties</p>
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-0 divide-y divide-border/60 px-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="py-3">
                      <SkeletonRow />
                    </div>
                  ))}
                </div>
              ) : upcomingDuties.length > 0 ? (
                <div className="divide-y divide-border/60">
                  {upcomingDuties.map(duty => (
                    <div
                      key={duty.id}
                      className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-blue/10 shrink-0">
                        <ShieldCheck className="h-5 w-5 text-brand-blue" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{duty.siteName}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {duty.clientName} · {format(duty.date, "EEE dd MMM")}
                        </p>
                      </div>
                      <Badge variant="brand-outline" className="shrink-0 tabular-nums">
                        {duty.totalManpower}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6">
                  <EmptyState emoji="📅" title="No upcoming duties" description="No guard requirements in your districts for the next 7 days." compact />
                </div>
              )}
            </CardContent>
            <CardFooter className="pt-0">
              <Button asChild size="sm" variant="ghost-brand" className="w-full">
                <Link href="/work-orders">
                  View all work orders <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}


      {/* ── Admin: Charts + Recent Activity ───────────────────────────────── */}
      {userRole !== 'fieldOfficer' && userRole !== 'client' && (
        <DashboardCharts 
          role={userRole as any}
          newHiresData={newHiresData}
          clientCoverage={clientCoverage}
        />
      )}

        </>
      )}
    </div>
  );
}
