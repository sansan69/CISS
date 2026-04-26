import type { ElementType } from "react";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  FileClock,
  Globe,
  GraduationCap,
  LayoutDashboard,
  Settings,
  ShieldAlert,
  Trophy,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  shortLabel?: string;
  fieldOfficerLabel?: string;
  icon: ElementType;
  exact?: boolean;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  fieldOfficerVisible?: boolean;
  clientVisible?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  fieldOfficerVisible?: boolean;
};

export const mainNavGroups: NavGroup[] = [
  {
    label: "Core",
    items: [
      { href: "/dashboard", label: "Dashboard", shortLabel: "Home", icon: LayoutDashboard, exact: true, clientVisible: true },
      { href: "/employees", label: "Employees", shortLabel: "Guards", icon: Users, clientVisible: true },
      { href: "/attendance-logs", label: "Attendance", shortLabel: "Attendance", icon: CalendarCheck, clientVisible: true },
    ],
  },
  {
    label: "Workforce",
    items: [
      { href: "/work-orders", label: "Work Orders", fieldOfficerLabel: "Upcoming Duties", shortLabel: "Orders", icon: ClipboardList, fieldOfficerVisible: true },
      { href: "/field-officers", label: "Field Officers", icon: ShieldAlert, fieldOfficerVisible: true },
    ],
  },
  {
    label: "Training",
    items: [
      { href: "/training", label: "Training Modules", icon: GraduationCap, adminOnly: true },
      { href: "/training/assignments", label: "Training Assignments", icon: BookOpen, fieldOfficerVisible: true },
      { href: "/evaluations", label: "Evaluations", icon: BookOpen, adminOnly: true },
      { href: "/leaderboard", label: "Leaderboard", icon: Trophy, adminOnly: true },
    ],
  },
  {
    label: "Payroll",
    adminOnly: true,
    items: [
      { href: "/payroll", label: "Payroll Runs", icon: Wallet, adminOnly: true },
      { href: "/leave", label: "Leave", icon: CalendarDays, adminOnly: true },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [{ href: "/settings", label: "Settings", icon: Settings, adminOnly: true }],
  },
  {
    label: "Company",
    superAdminOnly: true,
    items: [{ href: "/settings/state-management", label: "Region Onboarding", icon: Globe, superAdminOnly: true }],
  },
];

export const settingsSubItems: NavItem[] = [
  { href: "/settings/clients", label: "Clients & Sites", icon: Briefcase },
  { href: "/settings/admin-tools", label: "Admin Tools", icon: Wrench },
  { href: "/settings/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings/wage-config", label: "Wage Config", icon: Wallet },
];

export const bottomNavItems: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, exact: true, clientVisible: true },
  { href: "/employees", label: "Guards", icon: Users, clientVisible: true },
  { href: "/attendance-logs", label: "Attendance", icon: CalendarCheck, clientVisible: true },
  { href: "/work-orders", label: "Orders", icon: ClipboardList, fieldOfficerVisible: true },
];

export function isVisibleNavItem(item: NavItem, userRole: string | null, isSuperAdmin?: boolean): boolean {
  if (item.superAdminOnly) return isSuperAdmin === true;
  if (item.adminOnly && userRole !== "admin" && !isSuperAdmin) return false;
  if (!item.clientVisible && userRole === "client") return false;
  if (item.fieldOfficerVisible && userRole === "fieldOfficer") return true;
  if (!item.clientVisible && !item.fieldOfficerVisible && userRole === "fieldOfficer") return false;
  return true;
}

export function getVisibleNavItems<T extends NavItem>(items: T[], userRole: string | null, isSuperAdmin?: boolean): T[] {
  return items.filter((item) => isVisibleNavItem(item, userRole, isSuperAdmin));
}

export function getVisibleGroups(groups: NavGroup[], userRole: string | null, isSuperAdmin?: boolean): NavGroup[] {
  return groups
    .filter((group) => {
      if (group.superAdminOnly) return isSuperAdmin === true;
      if (group.adminOnly) return userRole === "admin" || isSuperAdmin === true;
      return true;
    })
    .map((group) => ({
      ...group,
      items: getVisibleNavItems(group.items, userRole, isSuperAdmin),
    }))
    .filter((group) => group.items.length > 0);
}
