"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Users, UserCheck, UserMinus, Clock, Building2, Briefcase, TrendingUp } from "lucide-react";

type UserRole = 'admin' | 'superAdmin' | 'hr' | 'accounts' | 'compliance' | 'fieldOfficer' | 'client';

interface DashboardStatsProps {
  role: UserRole;
  stats: {
    total: number;
    active: number;
    onLeave: number;
    inactiveOrExited: number;
  };
  roleSpecific?: {
    checkedIn?: number;
    payrollPending?: number;
    guardsAssigned?: number;
    complianceClear?: number;
  };
}

const roleConfig: Record<UserRole, { label: string; icon: any; color: string }[]> = {
  admin: [
    { label: 'Total Employees', icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: 'Active', icon: UserCheck, color: 'bg-green-50 text-green-600' },
    { label: 'On Leave', icon: Clock, color: 'bg-amber-50 text-amber-600' },
    { label: 'Inactive', icon: UserMinus, color: 'bg-gray-50 text-gray-600' },
  ],
  fieldOfficer: [
    { label: 'Assigned Guards', icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: 'Present Today', icon: UserCheck, color: 'bg-green-50 text-green-600' },
    { label: 'On Leave', icon: Clock, color: 'bg-amber-50 text-amber-600' },
  ],
  client: [
    { label: 'My Guards', icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: 'Checked In', icon: UserCheck, color: 'bg-green-50 text-green-600' },
    { label: 'On Leave', icon: Clock, color: 'bg-amber-50 text-amber-600' },
    { label: 'Compliance', icon: Building2, color: 'bg-purple-50 text-purple-600' },
  ],
  accounts: [
    { label: 'Total Employees', icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: 'Payroll Pending', icon: Briefcase, color: 'bg-amber-50 text-amber-600' },
    { label: 'Processed This Month', icon: TrendingUp, color: 'bg-green-50 text-green-600' },
  ],
  hr: [
    { label: 'Total Employees', icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: 'New This Month', icon: TrendingUp, color: 'bg-green-50 text-green-600' },
    { label: 'Pending Leave', icon: Clock, color: 'bg-amber-50 text-amber-600' },
  ],
  compliance: [
    { label: 'Total Employees', icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: 'Compliance Clear', icon: UserCheck, color: 'bg-green-50 text-green-600' },
  ],
  superAdmin: [
    { label: 'Total Employees', icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: 'Active', icon: UserCheck, color: 'bg-green-50 text-green-600' },
    { label: 'On Leave', icon: Clock, color: 'bg-amber-50 text-amber-600' },
    { label: 'Inactive', icon: UserMinus, color: 'bg-gray-50 text-gray-600' },
  ],
};

export function DashboardStats({ role, stats, roleSpecific }: DashboardStatsProps) {
  const config = roleConfig[role] || roleConfig.admin;
  
  const getValue = (index: number): number => {
    const values = [stats.total, stats.active, stats.onLeave, stats.inactiveOrExited];
    if (role === 'client' && roleSpecific) {
      return [roleSpecific.guardsAssigned ?? 0, roleSpecific.checkedIn ?? 0, stats.onLeave, roleSpecific.complianceClear ?? 0][index] || values[index];
    }
    return values[index] || 0;
  };

  const staggerClass = ["stagger-1","stagger-2","stagger-3","stagger-4"] as const;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {config.map((item, index) => (
        <Card
          key={item.label}
          className={`overflow-hidden animate-slide-up ${staggerClass[index] ?? "stagger-4"} ${index === 0 ? "border-l-4 border-l-primary" : ""}`}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${item.color}`}>
                <item.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <p className="text-2xl font-bold font-exo2">{getValue(index)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}