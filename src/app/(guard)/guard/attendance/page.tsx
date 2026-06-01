"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AttendanceCalendar,
  type CalendarAttendanceEntry,
} from "@/components/guard/attendance-calendar";
import { useAppAuth } from "@/context/auth-context";


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AttendanceResponse {
  month: string;
  logs: CalendarAttendanceEntry[];
  presentDays: number;
  workingDays?: number;
  absentDays?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function dateToMonthStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthStrToDate(monthStr: string): Date {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

function formatLogDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

function AttendanceSkeleton() {
  return (
    <div className="p-4 space-y-4">
      <Skeleton className="h-64 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 4].map((i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Attendance Page
// ─────────────────────────────────────────────────────────────────────────────

export default function GuardAttendancePage() {
  const { user } = useAppAuth();

  // Initialize to current month
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAttendance = useCallback(
    async (monthDate: Date) => {
      if (!user) return;
      try {
        setLoading(true);
        setError(null);
        const token = await user.getIdToken();
        const monthStr = dateToMonthStr(monthDate);
        const res = await fetch(`/api/guard/attendance?month=${monthStr}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json: AttendanceResponse = await res.json();
        setData(json);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load.");
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  useEffect(() => {
    fetchAttendance(currentMonthDate);
  }, [fetchAttendance, currentMonthDate]);

  const handleMonthChange = (direction: "prev" | "next") => {
    setCurrentMonthDate((prev) => {
      const next = new Date(prev);
      if (direction === "prev") {
        next.setMonth(next.getMonth() - 1);
      } else {
        next.setMonth(next.getMonth() + 1);
      }
      return next;
    });
  };

  if (loading) return <AttendanceSkeleton />;

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-red-600 text-sm font-medium">Failed to load</p>
          <p className="text-red-500 text-xs mt-1">{error}</p>
          <button
            onClick={() => fetchAttendance(currentMonthDate)}
            className="mt-3 text-xs font-semibold text-red-600 underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const logs = data?.logs ?? [];
  const presentDays = data?.presentDays ?? 0;

  return (
    <div className="p-4 space-y-4 pb-6">
      <h1 className="text-base font-bold text-foreground">Attendance</h1>

      {/* Calendar */}
      <AttendanceCalendar
        month={currentMonthDate}
        logs={logs}
        onMonthChange={handleMonthChange}
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{presentDays}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Present</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-red-500">{data?.absentDays ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Absent</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 text-center">
          <p className="text-2xl font-bold" className="text-primary">{data?.workingDays ?? data?.absentDays != null ? (presentDays + (data?.absentDays ?? 0)) : presentDays}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Working days</p>
        </div>
      </div>

      {/* Log list */}
      {logs.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No attendance records for this month
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 px-1">
            All Records
          </h2>
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-center gap-3 bg-white rounded-xl shadow-sm p-3"
            >
              {/* Date badge */}
              <div
                className="flex flex-col items-center justify-center h-11 w-11 rounded-xl shrink-0 text-center"
                className="bg-primary/10"
              >
                <span
                  className="text-sm font-bold leading-none"
                  className="text-primary"
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
                <p className="text-xs font-semibold text-foreground truncate">
                  {formatLogDate(log.date)}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {log.siteName || "—"}
                  {log.dutyPointName ? ` • ${log.dutyPointName}` : ""}
                  {log.time ? ` · ${log.time}` : ""}
                </p>
                {log.shiftLabel && (
                  <p className="text-[11px] text-muted-foreground">{log.shiftLabel}</p>
                )}
                {log.distanceMeters != null && (
                  <p className="text-[11px] text-muted-foreground">
                    {log.distanceMeters < 1000
                      ? `${Math.round(log.distanceMeters)} m`
                      : `${(log.distanceMeters / 1000).toFixed(1)} km`}
                    {log.distanceMeters > 200 && (
                      <span className="text-red-400 ml-1">• Outside fence</span>
                    )}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {(log as any).photoUrl && (
                  <a
                    href={(log as any).photoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-10 w-10 rounded-lg overflow-hidden border bg-muted shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={(log as any).photoUrl}
                      alt="Attendance"
                      className="h-full w-full object-cover"
                    />
                  </a>
                )}
                <Badge
                variant="outline"
                className={
                  log.status === "In"
                    ? "text-green-700 border-green-300 bg-green-50 text-[11px] px-2 py-0.5 shrink-0"
                    : "text-orange-700 border-orange-300 bg-orange-50 text-[11px] px-2 py-0.5 shrink-0"
                }
              >
                {log.status}
              </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
