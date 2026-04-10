"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { QrCode, UserPlus, Briefcase, Star, CalendarClock, FileText, DollarSign } from "lucide-react";

type UserRole = 'admin' | 'superAdmin' | 'hr' | 'accounts' | 'compliance' | 'fieldOfficer' | 'client';

interface QuickAction {
  label: string;
  href: string;
  icon: any;
  color: string;
}

const roleActions: Record<UserRole, QuickAction[]> = {
  admin: [
    { label: "Attendance", href: "/attendance", icon: QrCode, color: "bg-blue-50 text-blue-600" },
    { label: "Enroll", href: "/employees/enroll", icon: UserPlus, color: "bg-green-50 text-green-700" },
    { label: "Work Orders", href: "/work-orders", icon: Briefcase, color: "bg-amber-50 text-amber-700" },
    { label: "Leaderboard", href: "/leaderboard", icon: Star, color: "bg-purple-50 text-purple-700" },
  ],
  fieldOfficer: [
    { label: "My Visits", href: "/visit-reports", icon: CalendarClock, color: "bg-blue-50 text-blue-600" },
    { label: "Leave Requests", href: "/leave", icon: FileText, color: "bg-amber-50 text-amber-700" },
  ],
  client: [
    { label: "My Guards", href: "/employees", icon: UserPlus, color: "bg-blue-50 text-blue-600" },
    { label: "Reports", href: "/settings/reports", icon: FileText, color: "bg-green-50 text-green-700" },
  ],
  accounts: [
    { label: "Run Payroll", href: "/payroll/run", icon: DollarSign, color: "bg-green-50 text-green-700" },
    { label: "View Salaries", href: "/payroll/salaries", icon: FileText, color: "bg-blue-50 text-blue-600" },
  ],
  hr: [
    { label: "Enroll Employee", href: "/employees/enroll", icon: UserPlus, color: "bg-green-50 text-green-700" },
    { label: "Leave Requests", href: "/leave", icon: CalendarClock, color: "bg-amber-50 text-amber-700" },
    { label: "Training", href: "/training", icon: FileText, color: "bg-purple-50 text-purple-700" },
  ],
  compliance: [
    { label: "Compliance Settings", href: "/settings/compliance-settings", icon: FileText, color: "bg-blue-50 text-blue-600" },
  ],
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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {actions.map((action) => (
        <Link key={action.href} href={action.href}>
          <Button variant="outline" className="w-full h-auto py-3 flex flex-col items-center gap-2">
            <div className={`p-2 rounded-lg ${action.color}`}>
              <action.icon className="h-5 w-5" />
            </div>
            <span className="text-sm">{action.label}</span>
          </Button>
        </Link>
      ))}
    </div>
  );
}