"use client";

import React, { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const BRAND_BLUE = "#014c85";
const BRAND_GOLD = "#bd9c55";

export interface AttendanceLog {
  id: string;
  date: string;       // YYYY-MM-DD
  status: "In" | "Out";
  siteName: string;
  time: string;
  distanceMeters?: number;
  shiftLabel?: string;
}

interface AttendanceCalendarProps {
  month: Date;
  logs: AttendanceLog[];
  onMonthChange: (direction: "prev" | "next") => void;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function isFutureDate(dateStr: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return dateStr > today;
}

function isToday(dateStr: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return dateStr === today;
}

function isSunday(dateStr: string): boolean {
  return new Date(dateStr + "T00:00:00").getDay() === 0;
}

export function AttendanceCalendar({
  month,
  logs,
  onMonthChange,
}: AttendanceCalendarProps) {
  // Build a map: date → status (prioritize "In")
  const dateStatusMap = useMemo(() => {
    const map: Record<string, "In" | "Out"> = {};
    for (const log of logs) {
      if (!map[log.date] || log.status === "In") {
        map[log.date] = log.status;
      }
    }
    return map;
  }, [logs]);

  // Compute the calendar grid for the month
  const calendarDays = useMemo(() => {
    const year = month.getFullYear();
    const m = month.getMonth();
    const firstDayOfMonth = new Date(year, m, 1);
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const firstWeekday = firstDayOfMonth.getDay(); // 0 = Sunday

    const days: Array<{ dateStr: string | null; dayNum: number | null }> = [];

    // Padding days before the first day
    for (let i = 0; i < firstWeekday; i++) {
      days.push({ dateStr: null, dayNum: null });
    }

    // Actual days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ dateStr, dayNum: d });
    }

    return days;
  }, [month]);

  // Can we go to next month? (Don't allow beyond current month)
  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const displayedMonthStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const canGoNext = displayedMonthStr < currentMonthStr;

  // Chunk days into weeks
  const weeks: typeof calendarDays[] = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7));
    // Pad last row to 7 if needed
    const lastWeek = weeks[weeks.length - 1];
    while (lastWeek.length < 7) {
      lastWeek.push({ dateStr: null, dayNum: null });
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      {/* Month header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: BRAND_BLUE }}
      >
        <button
          onClick={() => onMonthChange("prev")}
          className="flex items-center justify-center h-8 w-8 rounded-full transition-colors"
          style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
        >
          <ChevronLeft size={18} className="text-white" />
        </button>

        <span className="text-white font-semibold text-sm">
          {formatMonthYear(month)}
        </span>

        <button
          onClick={() => canGoNext ? onMonthChange("next") : undefined}
          className={cn(
            "flex items-center justify-center h-8 w-8 rounded-full transition-colors",
            canGoNext ? "opacity-100" : "opacity-30 cursor-not-allowed"
          )}
          style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
          disabled={!canGoNext}
        >
          <ChevronRight size={18} className="text-white" />
        </button>
      </div>

      {/* Day labels row */}
      <div className="grid grid-cols-7 border-b border-gray-100">
        {DAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-center text-[10px] font-semibold py-2"
            style={{ color: label === "Sun" ? "#ef4444" : "#6b7280" }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar weeks */}
      <div className="p-2 space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((cell, di) => {
              if (!cell.dateStr) {
                return <div key={di} className="h-9" />;
              }

              const status = dateStatusMap[cell.dateStr];
              const isPresent = status === "In";
              const isOut = status === "Out";
              const todayCell = isToday(cell.dateStr);
              const future = isFutureDate(cell.dateStr);
              const sunday = isSunday(cell.dateStr);

              let bgColor = "transparent";
              let textColor = future ? "#d1d5db" : sunday ? "#ef4444" : "#374151";
              let ringStyle = {};

              if (isPresent) {
                bgColor = "#22c55e";
                textColor = "white";
              } else if (isOut) {
                bgColor = "#f97316";
                textColor = "white";
              }

              if (todayCell && !isPresent && !isOut) {
                ringStyle = {
                  outline: `2px solid ${BRAND_GOLD}`,
                  outlineOffset: "-2px",
                };
              }

              return (
                <div
                  key={cell.dateStr}
                  className="h-9 flex items-center justify-center rounded-full text-xs font-medium transition-all"
                  style={{
                    backgroundColor: bgColor,
                    color: textColor,
                    ...ringStyle,
                  }}
                >
                  {cell.dayNum}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-3 border-t border-gray-100">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-full bg-green-500" />
          <span className="text-[10px] text-gray-500">Present</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-full bg-orange-500" />
          <span className="text-[10px] text-gray-500">Out</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-3 w-3 rounded-full border-2"
            style={{ borderColor: BRAND_GOLD }}
          />
          <span className="text-[10px] text-gray-500">Today</span>
        </div>
      </div>
    </div>
  );
}
