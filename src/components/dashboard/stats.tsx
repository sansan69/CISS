"use client";

import {
  Activity,
  Clock3,
  UserCheck,
  UserMinus,
  Users,
  type LucideIcon,
} from "lucide-react";

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
  };
}

type StatValueKey = "total" | "active" | "inactiveOrExited" | "checkedIn";

interface StatDefinition {
  label: string;
  valueKey: StatValueKey;
  icon: LucideIcon;
  tone: "brand" | "success" | "neutral" | "accent";
}

const workforceStats: StatDefinition[] = [
  { label: "Total employees", valueKey: "total", icon: Users, tone: "brand" },
  { label: "Active employees", valueKey: "active", icon: UserCheck, tone: "success" },
  { label: "Inactive / exited", valueKey: "inactiveOrExited", icon: UserMinus, tone: "neutral" },
];

const roleConfig: Record<UserRole, StatDefinition[]> = {
  admin: [
    ...workforceStats,
    { label: "Attendance checks", valueKey: "checkedIn", icon: Clock3, tone: "accent" },
  ],
  fieldOfficer: [
    { label: "Assigned guards", valueKey: "total", icon: Users, tone: "brand" },
    { label: "Active assigned", valueKey: "active", icon: UserCheck, tone: "success" },
    { label: "Inactive assigned", valueKey: "inactiveOrExited", icon: UserMinus, tone: "neutral" },
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
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    neutral: "bg-muted text-muted-foreground",
    accent: "bg-accent/15 text-brand-gold-dark dark:text-accent",
  };

  return (
    <section
      aria-label="Live workforce summary"
      className="animate-slide-up overflow-hidden rounded-2xl border border-border/70 bg-card shadow-brand-xs"
    >
      <div className="grid grid-cols-2 md:grid-cols-4">
      {config.map((item, index) => (
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
          {index === 0 && (
            <span className="absolute inset-y-0 left-0 w-1 bg-brand-blue dark:bg-primary" aria-hidden="true" />
          )}
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneStyles[item.tone]}`}>
            <item.icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-exo2 text-2xl font-bold leading-none tabular-nums text-foreground sm:text-[1.7rem]">
              {getValue(item.valueKey).toLocaleString()}
            </p>
            <p className="mt-1.5 text-[11px] font-semibold leading-tight text-muted-foreground">
              {item.label}
            </p>
          </div>
        </article>
      ))}
      </div>
      <div className="flex items-center gap-2 border-t border-border/70 bg-muted/25 px-4 py-2 text-[11px] text-muted-foreground sm:px-5">
        <Activity className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        Live data updates automatically
      </div>
    </section>
  );
}
