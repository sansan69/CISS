"use client";

import Link from "next/link";
import {
  Briefcase,
  DollarSign,
  FileText,
  Footprints,
  GraduationCap,
  QrCode,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type UserRole = 'admin' | 'superAdmin' | 'hr' | 'accounts' | 'compliance' | 'fieldOfficer' | 'client';

interface QuickAction {
  label: string;
  href: string;
  icon: LucideIcon;
  color: string;
}

const roleActions: Record<UserRole, QuickAction[]> = {
  admin: [
    { label: "Attendance", href: "/attendance", icon: QrCode, color: "bg-blue-50 text-blue-600" },
    { label: "Work Orders", href: "/work-orders", icon: Briefcase, color: "bg-amber-50 text-amber-700" },
    { label: "Visit Reports", href: "/visit-reports", icon: FileText, color: "bg-green-50 text-green-700" },
    { label: "Training Reports", href: "/training-reports", icon: GraduationCap, color: "bg-purple-50 text-purple-700" },
    { label: "Patrol Activity", href: "/patrol-activity", icon: Footprints, color: "bg-slate-100 text-slate-700" },
  ],
  fieldOfficer: [
    { label: "Upcoming Duties", href: "/work-orders", icon: Briefcase, color: "bg-blue-50 text-blue-600" },
    { label: "My Visits", href: "/visit-reports", icon: FileText, color: "bg-green-50 text-green-700" },
    { label: "Training Reports", href: "/training-reports", icon: GraduationCap, color: "bg-amber-50 text-amber-700" },
    { label: "Attendance Logs", href: "/attendance-logs", icon: QrCode, color: "bg-purple-50 text-purple-700" },
  ],
  client: [
    { label: "My Guards", href: "/employees", icon: Users, color: "bg-blue-50 text-blue-600" },
    { label: "Attendance", href: "/attendance-logs", icon: QrCode, color: "bg-green-50 text-green-700" },
    { label: "Deployments", href: "/work-orders", icon: Briefcase, color: "bg-amber-50 text-amber-700" },
    { label: "Site Reports", href: "/visit-reports", icon: FileText, color: "bg-purple-50 text-purple-700" },
    { label: "Patrol Activity", href: "/patrol-activity", icon: Footprints, color: "bg-slate-100 text-slate-700" },
  ],
  accounts: [
    { label: "Run Payroll", href: "/payroll/run", icon: DollarSign, color: "bg-green-50 text-green-700" },
  ],
  hr: [
    { label: "Enroll Employee", href: "/employees/enroll", icon: UserPlus, color: "bg-green-50 text-green-700" },
    { label: "Training", href: "/training", icon: FileText, color: "bg-purple-50 text-purple-700" },
  ],
  compliance: [],
  superAdmin: [
    { label: "Dashboard", href: "/dashboard", icon: QrCode, color: "bg-blue-50 text-blue-600" },
    { label: "Regions", href: "/settings/state-management", icon: Briefcase, color: "bg-amber-50 text-amber-700" },
  ],
};

interface DashboardActionsProps {
  role: UserRole;
}

export function DashboardActions({ role }: DashboardActionsProps) {
  const actions = roleActions[role] || roleActions.admin;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="group flex min-h-[116px] flex-col items-center justify-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-5 text-center shadow-brand-xs transition-[transform,box-shadow,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-brand-blue/30 hover:bg-card/95 hover:shadow-brand-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-0"
        >
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105",
              action.color,
            )}
          >
            <action.icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold leading-snug text-foreground text-balance">
            {action.label}
          </span>
        </Link>
      ))}
    </div>
  );
}
