import type { ElementType } from "react";
import {
  Buildings,
  CalendarCheck,
  CalendarDots,
  ChartBar,
  ClipboardText,
  FileText,
  Footprints,
  Gear,
  GlobeHemisphereWest,
  GraduationCap,
  IdentificationCard,
  Medal,
  Notebook,
  ShieldCheck,
  SuitcaseSimple,
  UsersThree,
  Wallet,
  Wrench,
  BookOpen,
} from "@phosphor-icons/react";

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
  operationalClientOnly?: boolean;
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
      { href: "/dashboard", label: "Dashboard", shortLabel: "Home", icon: ChartBar, exact: true, clientVisible: true },
      { href: "/employees", label: "Employees", shortLabel: "Guards", icon: UsersThree, clientVisible: true },
      { href: "/attendance-logs", label: "Attendance", shortLabel: "Attendance", icon: CalendarCheck, clientVisible: true },
    ],
  },
  {
    label: "Workforce",
    items: [
      { href: "/work-orders", label: "Work Orders", fieldOfficerLabel: "Upcoming Duties", shortLabel: "Orders", icon: ClipboardText, fieldOfficerVisible: true, clientVisible: true, operationalClientOnly: true },
      { href: "/field-officers", label: "Field Officers", icon: ShieldCheck, fieldOfficerVisible: true },
    ],
  },
  {
    label: "Reports",
    items: [
      { href: "/visit-reports", label: "Visit Reports", icon: FileText, fieldOfficerVisible: true, clientVisible: true },
      { href: "/training-reports", label: "Training Reports", icon: GraduationCap, fieldOfficerVisible: true, clientVisible: true },
      { href: "/patrol-activity", label: "Patrol Activity", icon: Footprints, clientVisible: true },
    ],
  },
  {
    label: "Training",
    items: [
      { href: "/training", label: "Training Modules", icon: GraduationCap, adminOnly: true },
      { href: "/training/assignments", label: "Training Assignments", icon: BookOpen, fieldOfficerVisible: true },
      { href: "/evaluations", label: "Evaluations", icon: Notebook, adminOnly: true },
      { href: "/leaderboard", label: "Leaderboard", icon: Medal, adminOnly: true },
    ],
  },
  {
    label: "Payroll",
    adminOnly: true,
    items: [
      { href: "/payroll", label: "Payroll Runs", icon: Wallet, adminOnly: true },
      { href: "/leave", label: "Leave", icon: CalendarDots, adminOnly: true },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [{ href: "/settings", label: "Settings", icon: Gear, adminOnly: true }],
  },
  {
    label: "Company",
    superAdminOnly: true,
    items: [{ href: "/settings/state-management", label: "Region Onboarding", icon: GlobeHemisphereWest, superAdminOnly: true }],
  },
];

export const settingsSubItems: NavItem[] = [
  { href: "/settings/clients", label: "Clients & Sites", icon: Buildings },
  { href: "/settings/work-order-imports", label: "Work Order Imports", icon: IdentificationCard, adminOnly: true },
  { href: "/settings/admin-tools", label: "Admin Tools", icon: Wrench },
  { href: "/settings/reports", label: "Reports", icon: ChartBar },
  { href: "/settings/wage-config", label: "Wage Config", icon: Wallet },
];

export const bottomNavItems: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: ChartBar, exact: true, clientVisible: true },
  { href: "/employees", label: "Guards", icon: UsersThree, clientVisible: true },
  { href: "/attendance-logs", label: "Attendance", icon: CalendarCheck, clientVisible: true },
  { href: "/work-orders", label: "Orders", icon: SuitcaseSimple, fieldOfficerVisible: true, clientVisible: true, operationalClientOnly: true },
];

export function isVisibleNavItem(
  item: NavItem,
  userRole: string | null,
  isSuperAdmin?: boolean,
  clientInfo?: { clientId: string; clientName: string } | null,
): boolean {
  if (item.superAdminOnly) return isSuperAdmin === true;
  if (item.adminOnly && userRole !== "admin" && !isSuperAdmin) return false;
  if (!item.clientVisible && userRole === "client") return false;
  if (
    userRole === "client" &&
    item.operationalClientOnly &&
    clientInfo?.clientName?.trim().toLowerCase() !== "tcs"
  ) {
    return false;
  }
  if (item.fieldOfficerVisible && userRole === "fieldOfficer") return true;
  if (!item.clientVisible && !item.fieldOfficerVisible && userRole === "fieldOfficer") return false;
  return true;
}

export function getVisibleNavItems<T extends NavItem>(
  items: T[],
  userRole: string | null,
  isSuperAdmin?: boolean,
  clientInfo?: { clientId: string; clientName: string } | null,
): T[] {
  return items.filter((item) => isVisibleNavItem(item, userRole, isSuperAdmin, clientInfo));
}

export function getVisibleGroups(
  groups: NavGroup[],
  userRole: string | null,
  isSuperAdmin?: boolean,
  clientInfo?: { clientId: string; clientName: string } | null,
): NavGroup[] {
  return groups
    .filter((group) => {
      if (group.superAdminOnly) return isSuperAdmin === true;
      if (group.adminOnly) return userRole === "admin" || isSuperAdmin === true;
      return true;
    })
    .map((group) => ({
      ...group,
      items: getVisibleNavItems(group.items, userRole, isSuperAdmin, clientInfo),
    }))
    .filter((group) => group.items.length > 0);
}
