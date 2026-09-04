"use client";

import Link from "next/link";
import {
  ArrowRight,
  CaretRight,
  ShieldCheck,
  Warning as AlertTriangle,
  WarningCircle as AlertCircle,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export interface AttentionCoverageRow {
  clientName: string;
  activeGuards: number;
  checkedInToday: number;
  coveragePct: number;
  mockLocationAlerts: number;
}

type AttentionItem = {
  key: string;
  icon: Icon;
  tone: "destructive" | "warning";
  title: string;
  subtitle: string;
  href: string;
};

/**
 * "Needs Attention" strip — surfaces the handful of operational issues that
 * actually need a human right now: mock-location alerts and clients whose
 * on-duty coverage has dropped below the warning threshold. Renders nothing
 * when everything is nominal, keeping the dashboard calm.
 */
export function AttentionPanel({
  coverage,
  onDutyNow,
  totalActive,
}: {
  coverage: AttentionCoverageRow[];
  onDutyNow: number;
  totalActive: number;
}) {
  const items: AttentionItem[] = [];

  const mockAlertTotal = coverage.reduce((sum, row) => sum + (row.mockLocationAlerts || 0), 0);
  if (mockAlertTotal > 0) {
    items.push({
      key: "mock-alerts",
      icon: AlertTriangle,
      tone: "destructive",
      title: `${mockAlertTotal} mock-location alert${mockAlertTotal > 1 ? "s" : ""} flagged today`,
      subtitle: "Guards suspected of faking their GPS location — review attendance now.",
      href: "/attendance-logs",
    });
  }

  const lowCoverage = [...coverage]
    .filter((row) => row.activeGuards > 0 && row.coveragePct < 70)
    .sort((a, b) => a.coveragePct - b.coveragePct)
    .slice(0, 3);

  lowCoverage.forEach((row) => {
    items.push({
      key: `coverage:${row.clientName}`,
      icon: row.coveragePct < 35 ? AlertCircle : ShieldCheck,
      tone: row.coveragePct < 35 ? "destructive" : "warning",
      title: `${row.clientName} is at ${Math.round(row.coveragePct)}% on-duty coverage`,
      subtitle: `${row.checkedInToday} of ${row.activeGuards} active guards checked in today.`,
      href: "/attendance-logs",
    });
  });

  // Overall picture when there is something to watch but no single issue
  if (items.length === 0 && totalActive > 0 && onDutyNow < totalActive * 0.7) {
    items.push({
      key: "overall-coverage",
      icon: ShieldCheck,
      tone: "warning",
      title: `${onDutyNow} of ${totalActive} active guards on duty right now`,
      subtitle: "Overall on-duty coverage is below 70% — check for missing check-ins.",
      href: "/attendance-logs",
    });
  }

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="needs-attention-title" className="space-y-3">
      <div className="flex items-end justify-between gap-4 px-0.5">
        <div>
          <p
            id="needs-attention-title"
            className="section-label"
          >
            Needs attention
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Issues that need a decision right now
          </p>
        </div>
        <Link
          href="/attendance-logs"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-blue transition-colors hover:text-primary"
        >
          Review attendance
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {items.slice(0, 4).map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-brand-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-brand-sm",
                item.tone === "destructive"
                  ? "border-destructive/30 hover:border-destructive/50"
                  : "border-warning/30 hover:border-warning/50",
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  item.tone === "destructive"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-warning/10 text-warning-strong",
                )}
              >
                <Icon className="h-5 w-5" weight="duotone" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold leading-tight text-foreground">
                  {item.title}
                </span>
                <span className="mt-0.5 block line-clamp-1 text-xs leading-4 text-muted-foreground">
                  {item.subtitle}
                </span>
              </span>
              <CaretRight
                className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-blue"
                aria-hidden="true"
              />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
