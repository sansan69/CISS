"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  CalendarDays,
  Star,
  MapPin,
  Clock,
  ArrowRight,
  Building2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppAuth } from "@/context/auth-context";

const BRAND_BLUE = "#014c85";
const BRAND_GOLD = "#bd9c55";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DashboardData {
  employeeName: string;
  employeeId: string;
  clientName: string;
  district: string;
  profilePhotoUrl: string | null;
  attendanceStats: {
    presentDays: number;
    absentDays: number;
    workingDays: number;
  };
  leaveBalance: {
    casual: { entitled: number; taken: number; balance: number };
    sick: { entitled: number; taken: number; balance: number };
    earned: { entitled: number; taken: number; balance: number };
  } | null;
  latestEvalScore: number | null;
  latestEvalPeriod: string | null;
  nextShift: {
    date: string;
    siteName: string;
    clientName: string;
    shiftLabel?: string;
  } | null;
  recentAttendance: Array<{
    id: string;
    date: string;
    status: "In" | "Out";
    siteName: string;
    time: string;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton Loading
// ─────────────────────────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="p-4 space-y-4">
      <div className="space-y-1">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat Card
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  index = 0,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  index?: number;
}) {
  const stagger = ["stagger-1","stagger-2","stagger-3"][index] ?? "stagger-3";
  return (
    <div className={`bezel animate-slide-up ${stagger}`}>
      <div className="bg-card rounded-[calc(var(--radius)-1px)] inset-highlight overflow-hidden p-3 flex flex-col gap-2">
        <div
          className="flex items-center justify-center h-9 w-9 rounded-xl shrink-0"
          style={{ backgroundColor: `${color}18` }}
        >
          <Icon size={18} style={{ color }} />
        </div>
        <div>
          <p className="text-xl font-bold font-exo2 tabular-nums text-foreground leading-none">{value}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{label}</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Page
// ─────────────────────────────────────────────────────────────────────────────

export default function GuardDashboardPage() {
  const { user } = useAppAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const token = await user.getIdToken();
      const res = await fetch("/api/guard/dashboard", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json: DashboardData = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-red-600 text-sm font-medium">Failed to load</p>
          <p className="text-red-500 text-xs mt-1">{error}</p>
          <button
            onClick={fetchDashboard}
            className="mt-3 text-xs font-semibold text-red-600 underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const totalLeaveBalance = data.leaveBalance
    ? data.leaveBalance.casual.balance +
      data.leaveBalance.sick.balance +
      data.leaveBalance.earned.balance
    : null;

  return (
    <div className="p-4 space-y-4 pb-6">
      {/* Greeting */}
      <div className="animate-slide-up stagger-1">
        <p className="text-muted-foreground text-sm">{getGreeting()},</p>
        <h1 className="text-xl font-bold text-foreground leading-tight font-exo2 tracking-tight">
          {data.employeeName || "Guard"}
        </h1>
        {data.clientName && (
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Building2 size={11} />
            {data.clientName}
            {data.district ? ` · ${data.district}` : ""}
          </p>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-2.5">
        <StatCard
          label="Present this month"
          value={data.attendanceStats.presentDays}
          icon={CalendarCheck}
          color="#22c55e"
          index={0}
        />
        <StatCard
          label="Leave balance"
          value={totalLeaveBalance !== null ? totalLeaveBalance : "—"}
          icon={CalendarDays}
          color={BRAND_GOLD}
          index={1}
        />
        <StatCard
          label={data.latestEvalScore !== null ? "Eval score" : "Eval"}
          value={
            data.latestEvalScore !== null ? `${data.latestEvalScore}%` : "—"
          }
          icon={Star}
          color={BRAND_BLUE}
          index={2}
        />
      </div>

      {/* Next Shift */}
      <Card className="rounded-xl shadow-sm border-0">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              Next Shift
            </h2>
          </div>
          {data.nextShift ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <MapPin size={14} style={{ color: BRAND_BLUE }} />
                {data.nextShift.siteName || data.nextShift.clientName}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock size={12} />
                {formatDate(data.nextShift.date)}
                {data.nextShift.shiftLabel
                  ? ` · ${data.nextShift.shiftLabel}`
                  : ""}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/60">No upcoming shift found</p>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-2.5 animate-slide-up stagger-4">
        <Link
          href="/guard/attendance"
          className="flex items-center gap-3 bg-card rounded-xl border border-border/60 p-4 transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] hover:border-primary/30 hover:shadow-sm select-none"
          style={{ boxShadow: "0 1px 4px hsl(0 0% 0% / 0.06)" }}
        >
          <div
            className="flex items-center justify-center h-10 w-10 rounded-xl shrink-0"
            style={{ backgroundColor: `${BRAND_BLUE}12` }}
          >
            <CalendarCheck size={20} style={{ color: BRAND_BLUE }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Attendance</p>
            <p className="text-[10px] text-muted-foreground">View records</p>
          </div>
        </Link>
        <Link
          href="/guard/leave"
          className="flex items-center gap-3 bg-card rounded-xl border border-border/60 p-4 transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] hover:border-primary/30 hover:shadow-sm select-none"
          style={{ boxShadow: "0 1px 4px hsl(0 0% 0% / 0.06)" }}
        >
          <div
            className="flex items-center justify-center h-10 w-10 rounded-xl shrink-0"
            style={{ backgroundColor: `${BRAND_GOLD}12` }}
          >
            <CalendarDays size={20} style={{ color: BRAND_GOLD }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Apply Leave</p>
            <p className="text-[10px] text-muted-foreground">Submit request</p>
          </div>
        </Link>
      </div>

      {/* Recent Attendance */}
      <Card className="rounded-xl shadow-sm border-0">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              Recent Attendance
            </h2>
            <Link
              href="/guard/attendance"
              className="flex items-center gap-1 text-xs font-medium"
              style={{ color: BRAND_BLUE }}
            >
              View all
              <ArrowRight size={12} />
            </Link>
          </div>

          {data.recentAttendance.length === 0 ? (
            <p className="text-sm text-muted-foreground/60 text-center py-3">
              No attendance records this month
            </p>
          ) : (
            <div className="space-y-2">
              {data.recentAttendance.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0"
                >
                  {/* Date badge */}
                  <div
                    className="flex flex-col items-center justify-center h-10 w-10 rounded-xl shrink-0 text-center"
                    style={{ backgroundColor: `${BRAND_BLUE}10` }}
                  >
                    <span
                      className="text-xs font-bold leading-none"
                      style={{ color: BRAND_BLUE }}
                    >
                      {log.date.slice(8, 10)}
                    </span>
                    <span className="text-[10px] text-muted-foreground leading-none mt-0.5">
                      {new Date(`${log.date}T00:00:00`).toLocaleDateString(
                        "en-IN",
                        { month: "short" }
                      )}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {log.siteName || "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{log.time}</p>
                  </div>

                  <Badge
                    variant="outline"
                    className={
                      log.status === "In"
                        ? "text-green-700 border-green-300 bg-green-50 text-[10px] px-2 py-0.5"
                        : "text-orange-700 border-orange-300 bg-orange-50 text-[10px] px-2 py-0.5"
                    }
                  >
                    {log.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
