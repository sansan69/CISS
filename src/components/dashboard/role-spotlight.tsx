"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  MapPin,
  Pulse,
  ShieldCheck,
  SuitcaseSimple,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type SpotlightRole = "admin" | "fieldOfficer";

interface UpcomingDuty {
  siteName: string;
  clientName: string;
  district: string;
  date: Date;
  totalManpower: number;
}

interface RoleSpotlightProps {
  role: SpotlightRole;
  checkedInToday: number;
  activeCount: number;
  onDutyPct: number;
  assignedDistricts?: string[];
  upcomingDuty?: UpcomingDuty;
  clientCount?: number;
}

function Metric({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "success" | "gold" }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={cn(
        "font-exo2 text-2xl font-bold leading-none tabular-nums",
        tone === "success" && "text-success",
        tone === "gold" && "text-brand-gold-dark dark:text-accent",
      )}>
        {value}
      </p>
    </div>
  );
}

export function RoleSpotlight({
  role,
  checkedInToday,
  activeCount,
  onDutyPct,
  assignedDistricts = [],
  upcomingDuty,
  clientCount,
}: RoleSpotlightProps) {
  if (role === "fieldOfficer") {
    return (
      <section
        aria-labelledby="field-spotlight-title"
        className="grid gap-0 overflow-hidden rounded-3xl border border-brand-blue/20 bg-card shadow-brand-sm lg:grid-cols-[1.15fr_0.85fr]"
      >
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex items-center gap-2 text-brand-blue">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-blue/10">
              <ShieldCheck className="h-4 w-4" weight="duotone" aria-hidden="true" />
            </span>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em]">Your field brief</p>
          </div>
          <div>
            <h2 id="field-spotlight-title" className="font-exo2 text-xl font-bold tracking-[-0.025em] text-foreground sm:text-2xl">
              Start with what is next.
            </h2>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
              Keep today&apos;s guard coverage close, then move straight into the next deployment that needs you.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {assignedDistricts.length > 0 ? assignedDistricts.map((district) => (
              <span key={district} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-semibold text-foreground">
                <MapPin className="h-3 w-3 text-brand-blue" aria-hidden="true" />
                {district}
              </span>
            )) : (
              <span className="text-xs text-muted-foreground">District assignment pending</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-border/70 bg-muted/35 p-5 sm:p-6 lg:border-l lg:border-t-0">
          <Metric label="Checked in today" value={checkedInToday} tone="success" />
          <Metric label="Active guards" value={activeCount} />
          <div className="col-span-2 flex items-end justify-between gap-3 border-t border-border/70 pt-4">
            <div className="flex items-center gap-2">
              <Pulse className="h-4 w-4 text-success" weight="bold" aria-hidden="true" />
              <span className="text-xs font-semibold text-muted-foreground">{onDutyPct}% on duty</span>
            </div>
            <Link
              href={upcomingDuty ? "/work-orders" : "/attendance-logs"}
              className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-brand-blue transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {upcomingDuty ? "Open duties" : "Review attendance"}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {upcomingDuty && (
          <div className="col-span-full flex flex-col gap-3 border-t border-border/70 bg-brand-blue/[0.035] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue">
                <SuitcaseSimple className="h-5 w-5" weight="duotone" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Next duty</p>
                <p className="truncate text-sm font-bold text-foreground">{upcomingDuty.siteName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {upcomingDuty.clientName} · {upcomingDuty.district}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
              <span className="font-semibold">{upcomingDuty.totalManpower} guards needed</span>
              <span className="font-mono font-semibold tabular-nums text-foreground">{upcomingDuty.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      aria-labelledby="admin-spotlight-title"
      className="grid gap-0 overflow-hidden rounded-3xl border border-brand-blue/20 bg-card shadow-brand-sm lg:grid-cols-[1.3fr_0.7fr]"
    >
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center gap-2 text-brand-blue">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-blue/10">
            <Pulse className="h-4 w-4" weight="bold" aria-hidden="true" />
          </span>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em]">Operations pulse</p>
        </div>
        <div>
          <h2 id="admin-spotlight-title" className="font-exo2 text-xl font-bold tracking-[-0.025em] text-foreground sm:text-2xl">
            Know where the operation stands.
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
            Live coverage first, then the people and client records that need a closer look.
          </p>
        </div>
        <Link
          href="/attendance-logs"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-brand-blue transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Open attendance review <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-border/70 bg-muted/35 p-5 sm:grid-cols-3 sm:p-6 lg:border-l lg:border-t-0 lg:grid-cols-2">
        <Metric label="Checked in" value={checkedInToday} tone="success" />
        <Metric label="Active employees" value={activeCount} />
        {clientCount !== undefined && <Metric label="Clients reporting" value={clientCount} tone="gold" />}
        <div className="col-span-2 flex items-center gap-2 border-t border-border/70 pt-4 sm:col-span-3 lg:col-span-2">
          <CalendarCheck className="h-4 w-4 text-brand-blue" weight="duotone" aria-hidden="true" />
          <span className="text-xs font-semibold text-muted-foreground">{onDutyPct}% of active employees checked in</span>
        </div>
      </div>
    </section>
  );
}
