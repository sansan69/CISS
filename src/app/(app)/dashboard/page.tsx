"use client";

import {
  Users, UserCheck, UserMinus, Clock,
  ArrowRight, UserPlus, AlertCircle as AlertIcon,
  CalendarClock, QrCode, Briefcase, TrendingUp,
  ShieldCheck, Star,
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
import { BarChart, Bar, PieChart, Pie, Cell, Legend, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Badge } from "@/components/ui/badge";
import { resolveAppUser } from '@/lib/auth/roles';
import { StatCard } from "@/components/ui/stat-card";
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
  { label: "Mark Attendance",  href: "/attendance",          icon: QrCode,      color: "bg-brand-blue-pale text-brand-blue" },
  { label: "Enroll Guard",     href: "/employees/enroll",    icon: UserPlus,    color: "bg-green-50 text-green-700" },
  { label: "Work Orders",      href: "/work-orders",         icon: Briefcase,   color: "bg-amber-50 text-amber-700" },
  { label: "Leaderboard",      href: "/leaderboard",         icon: Star,        color: "bg-purple-50 text-purple-700" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Mini skeleton row
// ─────────────────────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-9 w-9 rounded-full animate-shimmer shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 w-3/5 rounded animate-shimmer" />
        <div className="h-3 w-2/5 rounded animate-shimmer" />
      </div>
      <div className="h-7 w-12 rounded-lg animate-shimmer shrink-0" />
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
            // FO upcoming duties
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
          total: totalSnap.data().count,
          active: activeSnap.data().count,
          onLeave: leaveSnap.data().count,
          inactiveOrExited: inactiveSnap.data().count,
        });

        // New hires by month
        const monthStarts = Array.from({ length: 6 }, (_, i) => startOfMonth(subMonths(new Date(), 5 - i)));
        const monthLabels = monthStarts.map(d => format(d, 'MMM yyyy'));
        const byMonth: Record<string, number> = Object.fromEntries(monthLabels.map(l => [l, 0]));
        (hiresSnap as any).docs.forEach((d: any) => {
          const cd = d.data().createdAt;
          const jd = d.data().joiningDate;
          const coerce = (v: any): Date | null => {
            if (!v) return null;
            if (typeof v.toDate === 'function') return v.toDate();
            const p = new Date(v); return isNaN(p.getTime()) ? null : p;
          };
          const date = coerce(cd) || coerce(jd);
          if (date) { const k = format(startOfMonth(date), 'MMM yyyy'); if (k in byMonth) byMonth[k]++; }
        });
        setNewHiresData(monthLabels.map(m => ({ month: m, hires: byMonth[m] })));

        // Client distribution
        const counts: Record<string, number> = {};
        (allEmpSnap as any).docs.forEach((d: any) => {
          const n = d.data().clientName || "Unassigned";
          counts[n] = (counts[n] || 0) + 1;
        });
        setClientDistData(Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value));

        // Recent activity
        setRecentActivity((recentSnap as any).docs.map((d: any) => {
          const data = d.data() as Employee;
          return {
            id: d.id,
            text: data.fullName,
            subtext: `${data.clientName || 'Unassigned'} · ${data.status}`,
            timestamp: (data.createdAt as Timestamp).toDate(),
          };
        }));

        // Upcoming duties (FO)
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

  const activePercent  = stats && stats.total > 0
    ? `${((stats.active / stats.total) * 100).toFixed(0)}% of total`
    : undefined;

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

  // ─── Admin & Field Officer greeting ──────────────────────────────────────
  const userName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'there';

  return (
    <div className="page-content">

      {/* ── Greeting ─────────────────────────────────────────────────────── */}
      <div className="animate-slide-down">
        <p className="text-muted-foreground text-sm">{getGreeting()},</p>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground capitalize mt-0.5">
          {userName} 👋
        </h1>
      </div>

      {/* ── Stat Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          title="Total Guards"
          value={stats?.total}
          icon={Users}
          iconColor="bg-brand-blue-pale text-brand-blue"
          isLoading={isLoading}
          delayClass="stagger-1"
        />
        <StatCard
          title="Active"
          value={stats?.active}
          icon={UserCheck}
          iconColor="bg-green-50 text-green-700"
          isLoading={isLoading}
          subtitle={activePercent}
          trend={stats && stats.active > 0 ? "up" : undefined}
          delayClass="stagger-2"
        />
        <StatCard
          title="On Leave"
          value={stats?.onLeave}
          icon={Clock}
          iconColor="bg-amber-50 text-amber-700"
          isLoading={isLoading}
          delayClass="stagger-3"
        />
        <StatCard
          title="Inactive / Exited"
          value={stats?.inactiveOrExited}
          icon={UserMinus}
          iconColor="bg-red-50 text-red-500"
          isLoading={isLoading}
          delayClass="stagger-4"
        />
      </div>

      {/* ── Quick Actions (admin + FO) ────────────────────────────────────── */}
      {userRole !== 'client' && (
        <Card className="animate-slide-up stagger-2">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-4 gap-2">
              {quickActions.map(action => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-muted transition-colors press-scale text-center group"
                >
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", action.color)}>
                    <action.icon className="h-5 w-5" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-medium text-muted-foreground group-hover:text-foreground leading-tight">
                    {action.label}
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Field Officer: Upcoming Duties ───────────────────────────────── */}
      {userRole === 'fieldOfficer' && (
        <Card className="animate-slide-up stagger-3">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-brand-blue shrink-0" />
              <div>
                <CardTitle>Upcoming Duties</CardTitle>
                <CardDescription>Next 7 days in your assigned districts</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <SkeletonRow key={i} />)}
              </div>
            ) : upcomingDuties.length > 0 ? (
              <div className="space-y-2">
                {upcomingDuties.map(duty => (
                  <div
                    key={duty.id}
                    className="flex items-center gap-3 rounded-xl border border-border p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-blue-pale shrink-0">
                      <ShieldCheck className="h-5 w-5 text-brand-blue" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{duty.siteName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {duty.clientName} · {format(duty.date, "EEE dd MMM")}
                      </p>
                    </div>
                    <Badge variant="brand-outline" className="shrink-0">
                      {duty.totalManpower} reqd.
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                emoji="📅"
                title="No upcoming duties"
                description="No guard requirements in your districts for the next 7 days."
                compact
              />
            )}
          </CardContent>
          <CardFooter>
            <Button asChild size="sm" variant="ghost-brand" className="w-full">
              <Link href="/work-orders">
                View all work orders <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* ── Admin Charts + Activity ───────────────────────────────────────── */}
      {userRole !== 'fieldOfficer' && userRole !== 'client' && (
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">

          {/* Charts — left 2/3 */}
          <div className="lg:col-span-2 space-y-4">
            {/* New Hires Bar Chart */}
            <Card className="animate-slide-up stagger-1">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle>New Enrollments</CardTitle>
                    <CardDescription>Last 6 months · monthly breakdown</CardDescription>
                  </div>
                  <TrendingUp className="h-5 w-5 text-brand-blue shrink-0" />
                </div>
              </CardHeader>
              <CardContent className="px-2 sm:px-4">
                {isLoading ? (
                  <div className="h-[200px] sm:h-[240px] rounded-xl animate-shimmer" />
                ) : (
                  <ChartContainer config={chartConfig} className="w-full h-[200px] sm:h-[240px]">
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
                      <ChartTooltip
                        cursor={{ fill: "hsl(var(--muted))", radius: 6 }}
                        content={<ChartTooltipContent hideLabel />}
                      />
                      <Bar
                        dataKey="hires"
                        fill="hsl(var(--chart-1))"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            {/* Pie Chart */}
            <Card className="animate-slide-up stagger-2">
              <CardHeader>
                <CardTitle>Guard Distribution by Client</CardTitle>
                <CardDescription>Current workforce allocation across clients</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="h-[220px] sm:h-[260px] rounded-xl animate-shimmer" />
                ) : !isMounted ? (
                  <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
                    Preparing chart…
                  </div>
                ) : clientDistData.length > 0 ? (
                  <ChartContainer
                    config={Object.fromEntries(clientDistData.map(c => [c.name, { label: c.name }]))}
                    className="w-full h-[220px] sm:h-[260px]"
                  >
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent nameKey="value" hideLabel />} />
                      <Pie
                        data={clientDistData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%" cy="50%"
                        outerRadius="75%"
                        innerRadius="40%"
                        paddingAngle={3}
                      >
                        {clientDistData.map((_, i) => (
                          <Cell key={i} fill={chartColors[i % chartColors.length]} />
                        ))}
                      </Pie>
                      <Legend
                        wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }}
                        iconType="circle"
                        iconSize={8}
                      />
                    </PieChart>
                  </ChartContainer>
                ) : (
                  <EmptyState compact title="No data" description="No employees enrolled yet." />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity — right 1/3 */}
          <Card className="animate-slide-up stagger-3 lg:col-span-1">
            <CardHeader>
              <CardTitle>Recent Enrollments</CardTitle>
              <CardDescription>Latest guards added to the system</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map(i => <SkeletonRow key={i} />)}
                </div>
              ) : recentActivity.length > 0 ? (
                <div className="space-y-1">
                  {recentActivity.map(act => (
                    <Link
                      key={act.id}
                      href={`/employees/${act.id}`}
                      className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-muted transition-colors group"
                    >
                      <Avatar className="h-9 w-9 shrink-0 ring-2 ring-border group-hover:ring-primary/30 transition-all">
                        <AvatarFallback className="text-xs bg-brand-blue-pale text-brand-blue font-semibold">
                          {act.text.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{act.text}</p>
                        <p className="text-xs text-muted-foreground truncate">{act.subtext}</p>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary shrink-0 transition-colors animate-bounce-x opacity-0 group-hover:opacity-100" />
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon={UserPlus} compact title="No recent activity" />
              )}
            </CardContent>
            <CardFooter>
              <Button asChild size="sm" variant="ghost-brand" className="w-full">
                <Link href="/employees">
                  View all employees <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* ── Client: Live Attendance ───────────────────────────────────────── */}
      {userRole === 'client' && (
        <>
          {/* Live summary cards */}
          <div className="grid grid-cols-3 gap-3 animate-slide-up stagger-2">
            {[
              { label: "Checked In",  value: clientAttendance.inToday,  color: "bg-green-50 text-green-700" },
              { label: "On Duty",     value: clientAttendance.onDuty,   color: "bg-brand-blue-pale text-brand-blue" },
              { label: "Checked Out", value: clientAttendance.outToday, color: "bg-muted text-muted-foreground" },
            ].map(s => (
              <Card key={s.label} className="text-center">
                <CardContent className="p-3 sm:p-4">
                  <p className={cn("text-2xl font-bold tabular-nums", s.color.split(' ')[1])}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground font-medium mt-0.5 uppercase tracking-wide">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Live log */}
          <Card className="animate-slide-up stagger-3">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>Live Attendance</CardTitle>
                  <CardDescription>Today's check-ins/outs for {clientInfo?.clientName}</CardDescription>
                </div>
                <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                  <span className="status-dot status-dot-active animate-pulse" />
                  Live
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {todayLogs.length === 0 ? (
                <EmptyState
                  emoji="🕐"
                  title="No attendance yet today"
                  description="Attendance records will appear here as guards check in."
                  compact
                />
              ) : (
                <div className="space-y-2">
                  {todayLogs.slice(0, 15).map(l => (
                    <div
                      key={l.id}
                      className="flex items-center gap-3 rounded-xl border border-border/60 p-3"
                    >
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="text-xs bg-brand-blue-pale text-brand-blue font-semibold">
                          {(l.employeeName || l.employeeId || '??').slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{l.employeeName || l.employeeId}</p>
                        <p className="text-xs text-muted-foreground truncate">{l.siteName}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant={l.status === 'In' ? 'active' : 'secondary'}>
                          {l.status}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {getAttendanceTime(l) ? format(getAttendanceTime(l)!, 'hh:mm a') : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
