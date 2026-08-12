"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  CalendarCheck,
  CurrencyInr,
  FileText,
  Footprints,
  GraduationCap,
  QrCode,
  SuitcaseSimple,
  UserPlus,
  UsersThree,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type UserRole = 'admin' | 'superAdmin' | 'hr' | 'accounts' | 'compliance' | 'fieldOfficer' | 'client';

interface QuickAction {
  label: string;
  description: string;
  href: string;
  icon: Icon;
}

const roleActions: Record<UserRole, QuickAction[]> = {
  admin: [
    { label: "Attendance", description: "Review daily records", href: "/attendance-logs", icon: CalendarCheck },
    { label: "Work orders", description: "Plan deployments", href: "/work-orders", icon: SuitcaseSimple },
    { label: "Visit reports", description: "Inspect field visits", href: "/visit-reports", icon: FileText },
    { label: "Training reports", description: "Track training", href: "/training-reports", icon: GraduationCap },
    { label: "Patrol activity", description: "Review patrols", href: "/patrol-activity", icon: Footprints },
  ],
  fieldOfficer: [
    { label: "Upcoming duties", description: "View deployments", href: "/work-orders", icon: SuitcaseSimple },
    { label: "My visits", description: "Submit and review", href: "/visit-reports", icon: FileText },
    { label: "Training reports", description: "Record training", href: "/training-reports", icon: GraduationCap },
    { label: "Attendance logs", description: "Check guard records", href: "/attendance-logs", icon: QrCode },
  ],
  client: [
    { label: "My guards", description: "View assigned staff", href: "/employees", icon: UsersThree },
    { label: "Attendance", description: "Review daily records", href: "/attendance-logs", icon: QrCode },
    { label: "Deployments", description: "View site duties", href: "/work-orders", icon: SuitcaseSimple },
    { label: "Site reports", description: "Review field visits", href: "/visit-reports", icon: FileText },
    { label: "Patrol activity", description: "Review patrols", href: "/patrol-activity", icon: Footprints },
  ],
  accounts: [
    { label: "Run payroll", description: "Process monthly payroll", href: "/payroll/run", icon: CurrencyInr },
  ],
  hr: [
    { label: "Enroll employee", description: "Add a new employee", href: "/employees/enroll", icon: UserPlus },
    { label: "Training", description: "Manage training", href: "/training", icon: FileText },
  ],
  compliance: [],
  superAdmin: [
    { label: "Dashboard", description: "Open overview", href: "/dashboard", icon: QrCode },
    { label: "Regions", description: "Manage regions", href: "/settings/state-management", icon: SuitcaseSimple },
  ],
};

interface DashboardActionsProps {
  role: UserRole;
}

export function DashboardActions({ role }: DashboardActionsProps) {
  const actions = roleActions[role] || roleActions.admin;
  if (actions.length === 0) return null;

  return (
    <section aria-labelledby="quick-access-title" className="space-y-4">
      <div className="flex items-end justify-between gap-4 px-0.5">
        <div>
          <h2 id="quick-access-title" className="text-base font-bold tracking-tight text-foreground sm:text-lg">
            Quick access
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Common operational tasks, one click away
          </p>
        </div>
      </div>
      <nav
        aria-label="Quick access"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      >
        {actions.map((action, index) => (
          <Link
            key={action.href}
            href={action.href}
            className={cn(
              "group flex min-h-[112px] flex-col justify-between gap-5 rounded-2xl border border-border/70 bg-card p-4 text-left shadow-brand-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-blue/30 hover:bg-brand-blue/[0.025] hover:shadow-brand-sm focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              index === 0 && "border-brand-blue/25 bg-brand-blue/[0.035] dark:bg-primary/[0.08]",
            )}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue transition-colors group-hover:bg-brand-blue group-hover:text-white dark:bg-primary/15 dark:text-primary dark:group-hover:bg-primary dark:group-hover:text-primary-foreground">
                <action.icon className="h-5 w-5" weight="duotone" aria-hidden="true" />
              </span>
              <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-blue dark:group-hover:text-primary" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-5 text-foreground">{action.label}</span>
              <span className="mt-1 block line-clamp-1 text-xs leading-4 text-muted-foreground">{action.description}</span>
            </span>
          </Link>
        ))}
      </nav>
    </section>
  );
}
