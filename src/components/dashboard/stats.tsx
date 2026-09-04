"use client";

import {
  Pulse as Activity,
  Clock,
  TrendDown,
  TrendUp,
  UserCheck,
  UserMinus,
  UsersThree,
  type Icon,
} from "@phosphor-icons/react";
import { format } from "date-fns";

type UserRole = 'admin' | 'superAdmin' | 'hr' | 'accounts' | 'compliance' | 'fieldOfficer' | 'client';

interface DashboardStatsProps {
  role: UserRole;
  stats: {
    total: number;
    active: number;
    inactiveOrExited: number;
  };
  roleSpecific?: {
    checkedIn?: number;
    /** Unique employees with status=In / active guards, as a percentage */
    onDutyPct?: number;
    /** When the underlying attendance data last changed */
    lastUpdated?: Date;
    /** checkedIn vs the same point yesterday (trend baseline) */
    checkedInDelta?: number;
  };
}

type StatValueKey = "total" | "active" | "inactiveOrExited" | "checkedIn";

interface StatDefinition {
  label: string;
  valueKey: StatValueKey;
  icon: Icon;
  tone: "brand" | "success" | "neutral" | "accent";
}

const workforceStats: StatDefinition[] = [
  { label: "Total employees", valueKey: "total", icon: UsersThree, tone: "brand" },
  { label: "Active employees", valueKey: "active", icon: UserCheck, tone: "success" },
  { label: "Inactive / exited", valueKey: "inactiveOrExited", icon: UserMinus, tone: "neutral" },
];

const roleConfig: Record<UserRole, StatDefinition[]> = {
  admin: [
    ...workforceStats,
    { label: "Checked in today", valueKey: "checkedIn", icon: Clock, tone: "accent" },
  ],
  fieldOfficer: [
    { label: "Assigned guards", valueKey: "total", icon: UsersThree, tone: "brand" },
    { label: "Active assigned", valueKey: "active", icon: UserCheck, tone: "success" },
    { label: "Inactive assigned", valueKey: "inactiveOrExited", icon: UserMinus, tone: "neutral" },
    { label: "Checked in today", valueKey: "checkedIn", icon: Activity, tone: "accent" },
  ],
  client: workforceStats,
  accounts: workforceStats,
  hr: workforceStats,
  compliance: workforceStats,
  superAdmin: workforceStats,
};

export function DashboardStats({ role, stats, roleSpecific }: DashboardStatsProps) {
  const config = roleConfig[role] || roleConfig.admin;

  const getValue = (key: StatValueKey): number => {
    if (key === "checkedIn") return roleSpecific?.checkedIn ?? 0;
    return stats[key];
  };

  const toneStyles: Record<StatDefinition["tone"], string> = {
    brand: "bg-brand-blue/10 text-brand-blue dark:bg-primary/15 dark:text-primary",
    success: "bg-success/10 text-success ",
    neutral: "bg-muted text-muted-foreground",
    accent: "bg-accent/15 text-brand-gold-dark dark:text-accent",
  };

  const onDutyPct = roleSpecific?.onDutyPct;
  const lastUpdated = roleSpecific?.lastUpdated;
  const checkedInDelta = roleSpecific?.checkedInDelta;

  return (
    <section
      aria-label="Live workforce summary"
      className="animate-slide-up overflow-hidden rounded-2xl border border-border/70 bg-card shadow-brand-xs"
    >
      <div className="grid grid-cols-2 md:grid-cols-4">
      {config.map((item, index) => {
        const isCheckedInStat = item.valueKey === "checkedIn";
        return (
        <article
          key={item.label}
          className={[
            "relative flex min-h-[96px] items-center gap-3 border-border/70 px-4 py-4 sm:min-h-[108px] sm:px-5",
            index > 1 ? "border-t" : "",
            index % 2 === 1 ? "border-l" : "",
            index > 0 ? "md:border-l" : "md:border-l-0",
            "md:border-t-0",
          ].join(" ")}
        >
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneStyles[item.tone]}`}>
            <item.icon className="h-5 w-5" weight="duotone" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-exo2 text-2xl font-bold leading-none tabular-nums text-foreground sm:text-[1.7rem]">
              {getValue(item.valueKey).toLocaleString()}
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold leading-tight text-muted-foreground">
              {item.label}
              {isCheckedInStat && onDutyPct !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${
                    onDutyPct >= 70
                      ? "bg-success/10 text-success"
                      : onDutyPct >= 35
                        ? "bg-warning/10 text-warning-strong"
                        : "bg-destructive/10 text-destructive"
                  }`}
                  title="Unique guards checked in today as a share of active guards"
                >
                  {onDutyPct}% on duty
                </span>
              )}
              {isCheckedInStat && checkedInDelta !== undefined && checkedInDelta !== 0 && (
                <span
                  className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${
                    checkedInDelta > 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                  }`}
                  title="Compared with the same point yesterday"
                >
                  {checkedInDelta > 0 ? (
                    <TrendUp className="h-2.5 w-2.5" weight="bold" aria-hidden="true" />
                  ) : (
                    <TrendDown className="h-2.5 w-2.5" weight="bold" aria-hidden="true" />
                  )}
                  {Math.abs(checkedInDelta)} vs yesterday
                </span>
              )}
              {isCheckedInStat && checkedInDelta === 0 && (
                <span
                  className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground tabular-nums"
                  title="Compared with the same point yesterday"
                >
                  same as yesterday
                </span>
              )}
            </p>
          </div>
        </article>
        );
      })}
      </div>
      <div className="flex items-center gap-2 border-t border-border/70 bg-muted/25 px-4 py-2 text-[11px] text-muted-foreground sm:px-5">
        <Activity className="h-3.5 w-3.5 text-success " aria-hidden="true" />
        {lastUpdated ? (
          <>
            <span>Live data · updated</span>
            <span className="font-mono font-semibold tabular-nums text-foreground/70">
              {format(lastUpdated, "HH:mm:ss")}
            </span>
          </>
        ) : (
          <span>Live data updates automatically</span>
        )}
      </div>
    </section>
  );
}
