"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  Star,
  MapPin,
  Clock,
  ArrowRight,
  Building2,
  Camera,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppAuth } from "@/context/auth-context";
import { useGuardHeartbeat } from "@/lib/hooks/use-guard-heartbeat";


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
  latestEvalScore: number | null;
  latestEvalPeriod: string | null;
  nextShift: {
    date: string;
    siteId: string;
    siteName: string;
    clientName: string;
    shiftLabel?: string;
  } | null;
  recentAttendance: Array<{
    id: string;
    date: string;
    status: "In" | "Out";
    siteName: string;
    dutyPointName?: string;
    time: string;
  }>;
  attendanceStatus: {
    lastStatus: string | null;
    lastAttendanceDate: string | null;
  };
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
  colorClass,
  index = 0,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  colorClass: string;
  index?: number;
}) {
  const stagger = ["stagger-1","stagger-2","stagger-3"][index] ?? "stagger-3";
  return (
    <div className={`bezel animate-slide-up ${stagger}`}>
      <div className="bg-card rounded-[calc(var(--radius)-1px)] inset-highlight overflow-hidden p-3 flex flex-col gap-2">
        <div
          className={`flex items-center justify-center h-9 w-9 rounded-xl shrink-0 ${colorClass}`}
        >
          <Icon size={18} />
        </div>
        <div>
          <p className="text-xl font-bold font-exo2 tabular-nums text-foreground leading-none">{value}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{label}</p>
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

  const isClockedIn = data?.attendanceStatus?.lastStatus === "In";
  useGuardHeartbeat(user, isClockedIn, data?.nextShift?.siteId ?? null);

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

  return (
    <div className="p-4 space-y-4 pb-6">
      {/* Greeting */}
      <div className="animate-slide-up stagger-1">
        <div className="flex items-center gap-4">
          {data.profilePhotoUrl ? (
            <div className="relative h-14 w-14 rounded-full overflow-hidden ring-2 ring-white shadow-md shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.profilePhotoUrl}
                alt={data.employeeName}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-blue/10 shrink-0">
              <span className="text-xl font-bold text-brand-blue">
                {(data.employeeName || "G").charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="min-w-0">
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
        </div>
      </div>

      {/* Attendance Status Banner */}
      {data.attendanceStatus.lastStatus && (
        <div
          className={`animate-slide-up stagger-2 rounded-xl border p-3 flex items-center gap-3 ${
            data.attendanceStatus.lastStatus === "In"
              ? "bg-green-50 border-green-200"
              : "bg-muted/50 border-border"
          }`}
        >
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-full ${
              data.attendanceStatus.lastStatus === "In"
                ? "bg-green-100"
                : "bg-gray-200"
            }`}
          >
            <div
              className={`h-3 w-3 rounded-full ${
                data.attendanceStatus.lastStatus === "In"
                  ? "bg-green-500 animate-pulse"
                  : "bg-gray-400"
              }`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {data.attendanceStatus.lastStatus === "In"
                ? "Currently Clocked IN"
                : "Clocked OUT"}
            </p>
            {data.attendanceStatus.lastAttendanceDate && (
              <p className="text-xs text-muted-foreground">
                Since {formatDate(data.attendanceStatus.lastAttendanceDate)}
              </p>
            )}
          </div>
          <Badge
            variant="outline"
            className={
              data.attendanceStatus.lastStatus === "In"
                ? "text-green-700 border-green-300 bg-green-50 text-xs shrink-0"
                : "text-gray-600 border-gray-300 bg-muted/50 text-xs shrink-0"
            }
          >
            {data.attendanceStatus.lastStatus}
          </Badge>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard
          label="Present this month"
          value={data.attendanceStats.presentDays}
          icon={CalendarCheck}
          colorClass="bg-green-500/10 text-green-500"
          index={0}
        />
        <StatCard
          label="Absent this month"
          value={data.attendanceStats.absentDays}
          icon={Clock}
          colorClass="bg-red-500/10 text-red-500"
          index={1}
        />
        <StatCard
          label="Working days"
          value={data.attendanceStats.workingDays}
          icon={Clock}
          colorClass="bg-accent/10 text-accent"
          index={2}
        />
        <StatCard
          label={data.latestEvalScore !== null ? "Eval score" : "Eval"}
          value={
            data.latestEvalScore !== null ? `${data.latestEvalScore}%` : "—"
          }
          icon={Star}
          colorClass="bg-primary/10 text-primary"
          index={3}
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
                <MapPin size={14} className="text-primary" />
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

      <Link
        href={`/attendance?employeeId=${encodeURIComponent(data.employeeId)}`}
        className="block animate-slide-up stagger-4"
      >
        <div
          className="rounded-xl p-4 text-white transition-all duration-150 ease-out active:brightness-[0.92] bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/25"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/12 ring-1 ring-white/15">
              <Camera size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Mark Attendance</p>
              <p className="text-xs text-white/75">
                {data.nextShift?.siteName
                  ? `Open the camera for ${data.nextShift.siteName}`
                  : "Open your attendance camera and submit from this portal"}
              </p>
            </div>
            <ArrowRight size={18} className="shrink-0 text-white/80" />
          </div>
        </div>
      </Link>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-2.5 animate-slide-up stagger-4">
        <Link
          href="/guard/attendance"
          className="flex items-center gap-3 bg-card rounded-xl border border-border/60 p-4 transition-all duration-150 ease-out active:brightness-[0.92] hover:border-primary/30 hover:shadow-sm select-none shadow-sm"
        >
          <div
            className="flex items-center justify-center h-10 w-10 rounded-xl shrink-0 bg-primary/10"
          >
            <CalendarCheck size={20} className="text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Attendance History</p>
            <p className="text-[11px] text-muted-foreground">View records</p>
          </div>
        </Link>
        <Link
          href="/guard/training"
          className="flex items-center gap-3 bg-card rounded-xl border border-border/60 p-4 transition-all duration-150 ease-out active:brightness-[0.92] hover:border-primary/30 hover:shadow-sm select-none shadow-sm"
        >
          <div
            className="flex items-center justify-center h-10 w-10 rounded-xl shrink-0 bg-accent/10"
          >
            <CalendarCheck size={20} className="text-accent" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Training</p>
            <p className="text-[11px] text-muted-foreground">View assignments</p>
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
              className="flex items-center gap-1 text-xs font-medium text-primary"
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
                    className="flex flex-col items-center justify-center h-10 w-10 rounded-xl shrink-0 text-center bg-primary/10"
                  >
                    <span
                      className="text-xs font-bold leading-none text-primary"
                    >
                      {log.date.slice(8, 10)}
                    </span>
                    <span className="text-[11px] text-muted-foreground leading-none mt-0.5">
                      {new Date(`${log.date}T00:00:00`).toLocaleDateString(
                        "en-IN",
                        { month: "short" }
                      )}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {log.siteName || "—"}
                      {log.dutyPointName ? ` • ${log.dutyPointName}` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{log.time}</p>
                  </div>

                  <Badge
                    variant="outline"
                    className={
                      log.status === "In"
                        ? "text-green-700 border-green-300 bg-green-50 text-[11px] px-2 py-0.5"
                        : "text-orange-700 border-orange-300 bg-orange-50 text-[11px] px-2 py-0.5"
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
