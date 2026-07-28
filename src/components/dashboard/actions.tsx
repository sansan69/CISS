"use client";

import Link from "next/link";
import {
  Briefcase,
  DollarSign,
  FileText,
  Footprints,
  GraduationCap,
  ArrowUpRight,
  QrCode,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type UserRole = 'admin' | 'superAdmin' | 'hr' | 'accounts' | 'compliance' | 'fieldOfficer' | 'client';

interface QuickAction {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

const roleActions: Record<UserRole, QuickAction[]> = {
  admin: [
    { label: "Attendance", description: "Review daily records", href: "/attendance", icon: QrCode },
    { label: "Work orders", description: "Plan deployments", href: "/work-orders", icon: Briefcase },
    { label: "Visit reports", description: "Inspect field visits", href: "/visit-reports", icon: FileText },
    { label: "Training reports", description: "Track training", href: "/training-reports", icon: GraduationCap },
    { label: "Patrol activity", description: "Review patrols", href: "/patrol-activity", icon: Footprints },
  ],
  fieldOfficer: [
    { label: "Upcoming duties", description: "View deployments", href: "/work-orders", icon: Briefcase },
    { label: "My visits", description: "Submit and review", href: "/visit-reports", icon: FileText },
    { label: "Training reports", description: "Record training", href: "/training-reports", icon: GraduationCap },
    { label: "Attendance logs", description: "Check guard records", href: "/attendance-logs", icon: QrCode },
  ],
  client: [
    { label: "My guards", description: "View assigned staff", href: "/employees", icon: Users },
    { label: "Attendance", description: "Review daily records", href: "/attendance-logs", icon: QrCode },
    { label: "Deployments", description: "View site duties", href: "/work-orders", icon: Briefcase },
    { label: "Site reports", description: "Review field visits", href: "/visit-reports", icon: FileText },
    { label: "Patrol activity", description: "Review patrols", href: "/patrol-activity", icon: Footprints },
  ],
  accounts: [
    { label: "Run payroll", description: "Process monthly payroll", href: "/payroll/run", icon: DollarSign },
  ],
  hr: [
    { label: "Enroll employee", description: "Add a new employee", href: "/employees/enroll", icon: UserPlus },
    { label: "Training", description: "Manage training", href: "/training", icon: FileText },
  ],
  compliance: [],
  superAdmin: [
    { label: "Dashboard", description: "Open overview", href: "/dashboard", icon: QrCode },
    { label: "Regions", description: "Manage regions", href: "/settings/state-management", icon: Briefcase },
  ],
};

interface DashboardActionsProps {
  role: UserRole;
}

export function DashboardActions({ role }: DashboardActionsProps) {
  const actions = roleActions[role] || roleActions.admin;
  if (actions.length === 0) return null;

  return (
    <section aria-labelledby="quick-access-title" className="space-y-3">
      <div className="flex items-end justify-between gap-4 px-0.5">
        <div>
          <h2 id="quick-access-title" className="text-sm font-bold text-foreground">
            Quick access
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Common operational tasks
          </p>
        </div>
      </div>
      <nav
        aria-label="Quick access"
        className="grid grid-cols-1 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-brand-xs sm:grid-cols-2 xl:grid-cols-5"
      >
        {actions.map((action, index) => (
          <Link
            key={action.href}
            href={action.href}
            className={cn(
              "group flex min-h-[76px] items-center gap-3 border-border/70 px-4 py-3 text-left transition-colors hover:bg-muted/55 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              index > 0 && "border-t",
              index < 2 && "sm:border-t-0",
              index >= 2 && "sm:border-t",
              index % 2 === 1 && "sm:border-l",
              index > 0 && "xl:border-l",
              "xl:border-t-0",
              index === 0 && "bg-brand-blue/[0.045] dark:bg-primary/[0.07]",
            )}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue transition-colors group-hover:bg-brand-blue group-hover:text-white dark:bg-primary/15 dark:text-primary dark:group-hover:bg-primary dark:group-hover:text-primary-foreground">
              <action.icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">{action.label}</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{action.description}</span>
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-blue dark:group-hover:text-primary" aria-hidden="true" />
          </Link>
        ))}
      </nav>
    </section>
  );
}
