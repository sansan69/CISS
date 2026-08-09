"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const TIME_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "numeric",
  month: "short",
});

/**
 * Live IST clock with a pulsing "live" dot — a perpetual micro-loop that
 * keeps operations surfaces feeling current. Seconds tick; date refreshes
 * with the clock.
 */
export function LiveClock({
  showDate = true,
  pulse = true,
  className,
  align = "right",
}: {
  showDate?: boolean;
  pulse?: boolean;
  className?: string;
  align?: "left" | "right";
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className={cn("flex items-center gap-2", align === "left" ? "flex-row" : "flex-row-reverse", className)}
      role="status"
      aria-label="Current IST time"
    >
      {pulse && (
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
      )}
      <div className="leading-none">
        <p className="font-mono text-xs font-semibold tabular-nums text-foreground">
          {TIME_FMT.format(now)}
        </p>
        {showDate && (
          <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
            {DATE_FMT.format(now)}
          </p>
        )}
      </div>
    </div>
  );
}
