"use client";

import {
  Users, UserCheck, UserMinus, Clock,
  ArrowRight, UserPlus, AlertCircle as AlertIcon,
  CalendarClock, QrCode, Briefcase, TrendingUp,
  ShieldCheck, Star, ChevronRight, Activity,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { db, auth } from '@/lib/firebase';
import {
  collection, getCountFromServer, getDocs, query, where,
  Timestamp, orderBy, limit, onSnapshot,
} from "firebase/firestore";
import type { Employee } from "@/types/employee";
import { format, subMonths, startOfMonth, startOfToday, addDays, endOfDay } from 'date-fns';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, PieChart, Pie, Cell, Legend, XAxis, YAxis, CartesianGrid } from "recharts";
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Badge } from "@/components/ui/badge";
import { resolveAppUser } from '@/lib/auth/roles';
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface DashboardStats  { total: number; active: number; onLeave: number; inactiveOrExited: number; }
interface NewHiresData    { month: string; hires: number; }
interface ClientDistData  { name: string; value: number; }
interface RecentActivity  { id: string; text: string; subtext: string; timestamp: Date; }
interface UpcomingDuty    { id: string; siteName: string; clientName: string; date: Date; totalManpower: number; }

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
// StatCard — mobile-optimised with colour bar
// ─────────────────────────────────────────────────────────────────────────────
const statDefs = [
  { key: "total",           label: "Total Guards",     barColor: "bg-brand-blue",   icon: Users,     iconBg: "bg-brand-blue/10 text-brand-blue" },
  { key: "active",          label: "Active",           barColor: "bg-emerald-500",  icon: UserCheck, iconBg: "bg-emerald-50 text-emerald-700" },
  { key: "onLeave",         label: "On Leave",         barColor: "bg-amber-400",    icon: Clock,     iconBg: "bg-amber-50 text-amber-700" },
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
              className="flex flex-col items-center gap-2.5 rounded-2xl bg-card border border-border/60 shadow-card p-3.5 min-w-[80px] press-scale shrink-0 transition-shadow hover:shadow-brand-sm"
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

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats, setStats]                   = useState<DashboardStats | null>(null);
  const [newHiresData, setNewHiresData]     = useState<NewHiresData[]>([]);
  const [clientDistData, setClientDistData] = useState<ClientDistData[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [upcomingDuties, setUpcomingDuties] = useState<UpcomingDuty[]>([]);
  const [todayLogs, setTodayLogs]           = useState<any[]>([]);
  const [clientAttendance, setClientAttendance] = useState({ inToday: 0, outToday: 0, onDuty: 0 });
  const [activeChartTab, setActiveChartTab] = useState<'hires' | 'distribution'>('hires');

  const [isLoading, setIsLoading]         = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [currentUser, setCurrentUser]     = useState<User | null>(null);
  const [userRole, setUserRole]           = useState<string | null>(null);
  const [assignedDistricts, setAssignedDistricts] = useState<string[]>([]);
  const [clientInfo, setClientInfo]       = useState<{ clientId: string; clientName: string } | null>(null);
  const [isMounted, setIsMounted]         = useState(false);

  useEffect(() => { setIsMounted(true); }, []);

  // Auth resolve
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        try {
          const appUser = await resolveAppUser(user);
          setUserRole(appUser.role);
          setAssignedDistricts(appUser.assignedDistricts);
          setClientInfo(appUser.clientId && appUser.clientName
            ? { clientId: appUser.clientId, clientName: appUser.clientName }
            : null
          );
        } catch {
          setUserRole('user');
          setAssignedDistricts([]);
          setClientInfo(null);
        }
      } else {
        setCurrentUser(null); setUserRole(null); setAssignedDistricts([]);
      }
    });
    return () => unsub();
  }, []);

  // Data fetch
  useEffect(() => {
    if (userRole === null) return;

    const fetchData = async () => {
      setIsLoading(true); setError(null);
      try {
        let empQ: any = collection(db, "employees");
        if (userRole === 'fieldOfficer' && assignedDistricts.length > 0)
          empQ = query(empQ, where('district', 'in', assignedDistricts));
        else if (userRole === 'client' && clientInfo?.clientName)
          empQ = query(empQ, where('clientName', '==', clientInfo.clientName));

        const includeCharts = userRole !== 'fieldOfficer' && userRole !== 'client';
        const sixMonthsAgo  = startOfMonth(subMonths(new Date(), 5));

        const [totalSnap, activeSnap, leaveSnap, inactiveSnap, hiresSnap, recentSnap, allEmpSnap, dutiesSnap] =
          await Promise.all([
            getCountFromServer(empQ),
            getCountFromServer(query(empQ, where('status', '==', 'Active'))),
            getCountFromServer(query(empQ, where('status', '==', 'OnLeave'))),
            getCountFromServer(query(empQ, where('status', 'in', ['Inactive', 'Exited']))),
            includeCharts
              ? getDocs(query(empQ, where("createdAt", ">=", Timestamp.fromDate(sixMonthsAgo))))
              : Promise.resolve({ docs: [] }),
            getDocs(query(empQ, orderBy("createdAt", "desc"), limit(5))),
            includeCharts
              ? getDocs(collection(db, "employees"))
              : Promise.resolve({ docs: [] }),
            userRole === 'fieldOfficer' && assignedDistricts.length > 0
              ? getDocs(query(
                  collection(db, "workOrders"),
                  where("district", "in", assignedDistricts),
                  where("date", ">=", Timestamp.fromDate(startOfToday())),
                  where("date", "<=", Timestamp.fromDate(endOfDay(addDays(new Date(), 6)))),
                  orderBy("date", "asc"), limit(10)
                ))
              : Promise.resolve({ docs: [] }),
          ]);

        setStats({
          total:            totalSnap.data().count,
          active:           activeSnap.data().count,
          onLeave:          leaveSnap.data().count,
          inactiveOrExited: inactiveSnap.data().count,
        });

        const monthStarts = Array.from({ length: 6 }, (_, i) => startOfMonth(subMonths(new Date(), 5 - i)));
        const monthLabels = monthStarts.map(d => format(d, 'MMM yyyy'));
        const byMonth: Record<string, number> = Object.fromEntries(monthLabels.map(l => [l, 0]));
        (hiresSnap as any).docs.forEach((d: any) => {
          const cd = d.data().createdAt, jd = d.data().joiningDate;
          const coerce = (v: any): Date | null => {
            if (!v) return null;
            if (typeof v.toDate === 'function') return v.toDate();
            const p = new Date(v); return isNaN(p.getTime()) ? null : p;
          };
          const date = coerce(cd) || coerce(jd);
          if (date) { const k = format(startOfMonth(date), 'MMM yyyy'); if (k in byMonth) byMonth[k]++; }
        });
        setNewHiresData(monthLabels.map(m => ({ month: m, hires: byMonth[m] })));

        const counts: Record<string, number> = {};
        (allEmpSnap as any).docs.forEach((d: any) => {
          const n = d.data().clientName || "Unassigned";
          counts[n] = (counts[n] || 0) + 1;
        });
        setClientDistData(Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value));

        setRecentActivity((recentSnap as any).docs.map((d: any) => {
          const data = d.data() as Employee;
          return {
            id: d.id,
            text: data.fullName,
            subtext: `${data.clientName || 'Unassigned'} · ${data.status}`,
            timestamp: (data.createdAt as Timestamp).toDate(),
          };
        }));

        setUpcomingDuties((dutiesSnap as any).docs.map((d: any) => {
          const data = d.data();
          return {
            id: d.id,
            siteName: data.siteName,
            clientName: data.clientName,
            date: (data.date as Timestamp).toDate(),
            totalManpower: data.totalManpower,
          };
        }));

      } catch (err: any) {
        let msg = "Failed to load dashboard data.";
        if (err.code === 'permission-denied') msg = "Permission denied — check Firestore rules.";
        if (err.code === 'failed-precondition') msg = "A required database index is missing.";
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [userRole, assignedDistricts, clientInfo]);

  // Live attendance for client users
  useEffect(() => {
    if (userRole !== 'client' || !clientInfo?.clientName) return;
    const qLogs = query(
      collection(db, 'attendanceLogs'),
      where('clientName', '==', clientInfo.clientName),
      where('createdAt', '>=', Timestamp.fromDate(startOfToday())),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(qLogs, (snap) => {
      const logs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setTodayLogs(logs);
      const latestByEmp = new Map<string, any>();
      const seenIn = new Set<string>(), seenOut = new Set<string>();
      logs.forEach(l => {
        if (l.status === 'In') seenIn.add(l.employeeId);
        if (l.status === 'Out') seenOut.add(l.employeeId);
        const prev = latestByEmp.get(l.employeeId);
        const prevTs = prev?.createdAt?.toMillis?.() ?? 0;
        const curTs  = l.createdAt?.toMillis?.()    ?? 0;
        if (!prev || curTs > prevTs) latestByEmp.set(l.employeeId, l);
      });
      let onDuty = 0;
      latestByEmp.forEach(l => { if (l.status === 'In') onDuty++; });
      setClientAttendance({ inToday: seenIn.size, outToday: seenOut.size, onDuty });
    });
    return () => unsub();
  }, [userRole, clientInfo]);

  const chartConfig = {
    hires: { label: "New Hires", color: "hsl(var(--chart-1))" },
  };
  const chartColors = [
    "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
    "hsl(var(--chart-4))", "hsl(var(--chart-5))",
  ];

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
          {!isLoading && stats && (
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

      {/* ── Stat Cards 2×2 ───────────────────────────────────────────────── */}
      <StatGrid stats={stats} isLoading={isLoading} />

      {/* ── Quick Actions (admin + FO) ────────────────────────────────────── */}
      {userRole !== 'client' && <QuickActions />}

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

      {/* ── Admin: Charts (tabbed on mobile) + Recent Activity ───────────── */}
      {userRole !== 'fieldOfficer' && userRole !== 'client' && (
        <>
          {/* Charts */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="section-label">Analytics</p>
              {/* Tab pills */}
              <div className="flex gap-1 rounded-xl bg-muted p-0.5">
                <button
                  onClick={() => setActiveChartTab('hires')}
                  className={cn(
                    "px-3 py-1 rounded-lg text-[11px] font-semibold transition-all",
                    activeChartTab === 'hires'
                      ? "bg-white text-foreground shadow-brand-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Hires
                </button>
                <button
                  onClick={() => setActiveChartTab('distribution')}
                  className={cn(
                    "px-3 py-1 rounded-lg text-[11px] font-semibold transition-all",
                    activeChartTab === 'distribution'
                      ? "bg-white text-foreground shadow-brand-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Clients
                </button>
              </div>
            </div>

            <div className="lg:hidden">
              {/* Mobile: single chart tab */}
              {activeChartTab === 'hires' && (
                <Card className="animate-scale-in">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">New Enrollments</CardTitle>
                    <CardDescription className="text-xs">Last 6 months</CardDescription>
                  </CardHeader>
                  <CardContent className="px-2">
                    {isLoading ? (
                      <SkeletonBlock className="h-[180px]" />
                    ) : (
                      <ChartContainer config={chartConfig} className="w-full h-[180px]">
                        <BarChart data={newHiresData} accessibilityLayer barSize={22}>
                          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 4" />
                          <XAxis
                            dataKey="month"
                            tickLine={false} tickMargin={8} axisLine={false}
                            stroke="hsl(var(--muted-foreground))" fontSize={10}
                            tickFormatter={v => v.split(' ')[0]}
                          />
                          <YAxis
                            stroke="hsl(var(--muted-foreground))" fontSize={10}
                            tickLine={false} axisLine={false} tickMargin={6}
                            allowDecimals={false} width={24}
                          />
                          <ChartTooltip cursor={{ fill: "hsl(var(--muted))", radius: 6 }} content={<ChartTooltipContent hideLabel />} />
                          <Bar dataKey="hires" fill="hsl(var(--chart-1))" radius={[5, 5, 0, 0]} />
                        </BarChart>
                      </ChartContainer>
                    )}
                  </CardContent>
                </Card>
              )}
              {activeChartTab === 'distribution' && isMounted && (
                <Card className="animate-scale-in">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Guard Distribution</CardTitle>
                    <CardDescription className="text-xs">By client</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isLoading ? (
                      <SkeletonBlock className="h-[180px]" />
                    ) : clientDistData.length > 0 ? (
                      <ChartContainer
                        config={Object.fromEntries(clientDistData.map(c => [c.name, { label: c.name }]))}
                        className="w-full h-[180px]"
                      >
                        <PieChart>
                          <ChartTooltip content={<ChartTooltipContent nameKey="value" hideLabel />} />
                          <Pie
                            data={clientDistData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%" cy="45%"
                            outerRadius="70%"
                            innerRadius="35%"
                            paddingAngle={3}
                          >
                            {clientDistData.map((_, i) => (
                              <Cell key={i} fill={chartColors[i % chartColors.length]} />
                            ))}
                          </Pie>
                          <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "8px" }} iconType="circle" iconSize={7} />
                        </PieChart>
                      </ChartContainer>
                    ) : (
                      <EmptyState compact title="No data" description="No employees enrolled yet." />
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Desktop: side-by-side charts */}
            <div className="hidden lg:grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle>New Enrollments</CardTitle>
                      <CardDescription>Last 6 months · monthly breakdown</CardDescription>
                    </div>
                    <TrendingUp className="h-5 w-5 text-brand-blue shrink-0" />
                  </div>
                </CardHeader>
                <CardContent className="px-2">
                  {isLoading ? (
                    <SkeletonBlock className="h-[220px]" />
                  ) : (
                    <ChartContainer config={chartConfig} className="w-full h-[220px]">
                      <BarChart data={newHiresData} accessibilityLayer barSize={28}>
                        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 4" />
                        <XAxis
                          dataKey="month"
                          tickLine={false} tickMargin={10} axisLine={false}
                          stroke="hsl(var(--muted-foreground))" fontSize={11}
                          tickFormatter={v => v.split(' ')[0]}
                        />
                        <YAxis
                          stroke="hsl(var(--muted-foreground))" fontSize={11}
                          tickLine={false} axisLine={false} tickMargin={8}
                          allowDecimals={false} width={28}
                        />
                        <ChartTooltip cursor={{ fill: "hsl(var(--muted))", radius: 6 }} content={<ChartTooltipContent hideLabel />} />
                        <Bar dataKey="hires" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Guard Distribution</CardTitle>
                  <CardDescription>Workforce allocation across clients</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <SkeletonBlock className="h-[220px]" />
                  ) : !isMounted ? null : clientDistData.length > 0 ? (
                    <ChartContainer
                      config={Object.fromEntries(clientDistData.map(c => [c.name, { label: c.name }]))}
                      className="w-full h-[220px]"
                    >
                      <PieChart>
                        <ChartTooltip content={<ChartTooltipContent nameKey="value" hideLabel />} />
                        <Pie
                          data={clientDistData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%" cy="45%"
                          outerRadius="70%"
                          innerRadius="35%"
                          paddingAngle={3}
                        >
                          {clientDistData.map((_, i) => (
                            <Cell key={i} fill={chartColors[i % chartColors.length]} />
                          ))}
                        </Pie>
                        <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }} iconType="circle" iconSize={8} />
                      </PieChart>
                    </ChartContainer>
                  ) : (
                    <EmptyState compact title="No data" description="No employees enrolled yet." />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Recent Activity */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="section-label">Recent Enrollments</p>
              <Link href="/employees" className="flex items-center gap-0.5 text-[11px] font-semibold text-primary">
                See all <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="divide-y divide-border/60 px-4">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="py-3"><SkeletonRow /></div>
                    ))}
                  </div>
                ) : recentActivity.length > 0 ? (
                  <div className="divide-y divide-border/60">
                    {recentActivity.map(act => (
                      <Link
                        key={act.id}
                        href={`/employees/${act.id}`}
                        className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 transition-colors group"
                      >
                        <Avatar className="h-10 w-10 shrink-0 ring-2 ring-border group-hover:ring-primary/20 transition-all">
                          <AvatarFallback className="text-xs bg-brand-blue/10 text-brand-blue font-semibold">
                            {act.text.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{act.text}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{act.subtext}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary shrink-0 transition-colors" />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-6">
                    <EmptyState icon={UserPlus} compact title="No recent activity" />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* ── Client: Live Attendance ───────────────────────────────────────── */}
      {userRole === 'client' && (
        <>
          {/* Hero attendance summary */}
          <div className="rounded-2xl gradient-brand p-5 shadow-brand-md text-white animate-slide-up stagger-2">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-4 w-4 text-white/70" />
              <span className="text-xs font-semibold uppercase tracking-widest text-white/70">Live Attendance</span>
              <span className="flex items-center gap-1 ml-auto text-xs text-emerald-300 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                Live
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Checked In",  value: clientAttendance.inToday,  dim: false },
                { label: "On Duty",     value: clientAttendance.onDuty,   dim: false },
                { label: "Checked Out", value: clientAttendance.outToday, dim: true  },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <p className={cn("text-3xl font-bold tabular-nums leading-none", s.dim ? "text-white/60" : "text-white")}>
                    {s.value}
                  </p>
                  <p className="text-[10px] text-white/55 font-semibold uppercase tracking-wide mt-1.5 leading-tight">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Live log */}
          <div>
            <p className="section-label mb-3">Today's Check-ins · {clientInfo?.clientName}</p>
            <Card>
              <CardContent className="p-0">
                {todayLogs.length === 0 ? (
                  <div className="px-4 py-8">
                    <EmptyState emoji="🕐" title="No attendance yet today" description="Records appear here as guards check in." compact />
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {todayLogs.slice(0, 15).map(l => (
                      <div key={l.id} className="flex items-center gap-3 px-4 py-3.5">
                        <Avatar className="h-10 w-10 shrink-0">
                          <AvatarFallback className="text-xs bg-brand-blue/10 text-brand-blue font-semibold">
                            {(l.employeeName || l.employeeId || '??').slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{l.employeeName || l.employeeId}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{l.siteName}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Badge variant={l.status === 'In' ? 'active' : 'secondary'}>{l.status}</Badge>
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {getAttendanceTime(l) ? format(getAttendanceTime(l)!, 'hh:mm a') : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
