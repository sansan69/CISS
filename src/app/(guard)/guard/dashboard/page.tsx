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
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-3 flex flex-col gap-2">
      <div
        className="flex items-center justify-center h-9 w-9 rounded-xl"
        style={{ backgroundColor: `${color}18` }}
      >
        <Icon size={18} style={{ color }} />
      </div>
      <div>
        <p className="text-xl font-bold text-gray-900 leading-none">{value}</p>
        <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{label}</p>
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
      <div>
        <p className="text-gray-500 text-sm">{getGreeting()},</p>
        <h1 className="text-lg font-bold text-gray-900 leading-tight">
          {data.employeeName || "Guard"}
        </h1>
        {data.clientName && (
          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
            <Building2 size={11} />
            {data.clientName}
            {data.district ? ` · ${data.district}` : ""}
          </p>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Present this month"
          value={data.attendanceStats.presentDays}
          icon={CalendarCheck}
          color="#22c55e"
        />
        <StatCard
          label="Leave balance"
          value={totalLeaveBalance !== null ? totalLeaveBalance : "—"}
          icon={CalendarDays}
          color={BRAND_GOLD}
        />
        <StatCard
          label={data.latestEvalScore !== null ? "Eval score" : "Eval"}
          value={
            data.latestEvalScore !== null ? `${data.latestEvalScore}%` : "—"
          }
          icon={Star}
          color={BRAND_BLUE}
        />
      </div>

      {/* Next Shift */}
      <Card className="rounded-xl shadow-sm border-0">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-800">
              Next Shift
            </h2>
          </div>
          {data.nextShift ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <MapPin size={14} style={{ color: BRAND_BLUE }} />
                {data.nextShift.siteName || data.nextShift.clientName}
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Clock size={12} />
                {formatDate(data.nextShift.date)}
                {data.nextShift.shiftLabel
                  ? ` · ${data.nextShift.shiftLabel}`
                  : ""}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No upcoming shift found</p>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/guard/attendance"
          className="flex items-center gap-3 bg-white rounded-xl shadow-sm p-4 border border-gray-100 hover:bg-gray-50 transition-colors"
        >
          <div
            className="flex items-center justify-center h-10 w-10 rounded-xl shrink-0"
            style={{ backgroundColor: `${BRAND_BLUE}15` }}
          >
            <CalendarCheck size={20} style={{ color: BRAND_BLUE }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Attendance</p>
            <p className="text-[10px] text-gray-500">View records</p>
          </div>
        </Link>
        <Link
          href="/guard/leave"
          className="flex items-center gap-3 bg-white rounded-xl shadow-sm p-4 border border-gray-100 hover:bg-gray-50 transition-colors"
        >
          <div
            className="flex items-center justify-center h-10 w-10 rounded-xl shrink-0"
            style={{ backgroundColor: `${BRAND_GOLD}15` }}
          >
            <CalendarDays size={20} style={{ color: BRAND_GOLD }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Apply Leave</p>
            <p className="text-[10px] text-gray-500">Submit request</p>
          </div>
        </Link>
      </div>

      {/* Recent Attendance */}
      <Card className="rounded-xl shadow-sm border-0">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-800">
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
            <p className="text-sm text-gray-400 text-center py-3">
              No attendance records this month
            </p>
          ) : (
            <div className="space-y-2">
              {data.recentAttendance.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0"
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
                    <span className="text-[8px] text-gray-500 leading-none mt-0.5">
                      {new Date(`${log.date}T00:00:00`).toLocaleDateString(
                        "en-IN",
                        { month: "short" }
                      )}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">
                      {log.siteName || "—"}
                    </p>
                    <p className="text-[10px] text-gray-500">{log.time}</p>
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
