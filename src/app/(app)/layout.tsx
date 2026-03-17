"use client";

import type { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  Settings,
  LogOut,
  Briefcase,
  FileUp,
  BarChart3,
  QrCode,
  Landmark,
  MapPinned,
  DownloadCloud,
  ChevronLeft,
  ShieldAlert,
  ClipboardList,
  MoreHorizontal,
  X,
  GraduationCap,
  Trophy,
  Wallet,
  CalendarDays,
  FileText,
  BookOpen,
  Building2,
  ChevronRight,
  PanelLeft,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { resolveAppUser } from '@/lib/auth/roles';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  shortLabel?: string;        // used in mobile bottom bar
  fieldOfficerLabel?: string;
  icon: React.ElementType;
  exact?: boolean;
  adminOnly?: boolean;
  clientVisible?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
  adminOnly?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation Config
// ─────────────────────────────────────────────────────────────────────────────

const mainNavGroups: NavGroup[] = [
  {
    label: 'Core',
    items: [
      { href: '/dashboard',       label: 'Dashboard',   shortLabel: 'Home',       icon: LayoutDashboard, exact: true,   clientVisible: true },
      { href: '/employees',       label: 'Employees',   shortLabel: 'Guards',     icon: Users,                          clientVisible: true },
      { href: '/attendance-logs', label: 'Attendance',  shortLabel: 'Attendance', icon: CalendarCheck,                  clientVisible: true },
    ],
  },
  {
    label: 'Workforce',
    items: [
      { href: '/work-orders',   label: 'Work Orders',  fieldOfficerLabel: 'Upcoming Duties', shortLabel: 'Orders', icon: ClipboardList },
      { href: '/field-officers', label: 'Field Officers', icon: ShieldAlert, adminOnly: true },
    ],
  },
  {
    label: 'Training',
    adminOnly: true,
    items: [
      { href: '/training',    label: 'Training Modules', icon: GraduationCap, adminOnly: true },
      { href: '/evaluations', label: 'Evaluations',      icon: BookOpen,      adminOnly: true },
      { href: '/leaderboard', label: 'Leaderboard',      icon: Trophy,        adminOnly: true },
    ],
  },
  {
    label: 'Payroll',
    adminOnly: true,
    items: [
      { href: '/payroll', label: 'Payroll Runs', icon: Wallet,      adminOnly: true },
      { href: '/leave',   label: 'Leave',        icon: CalendarDays, adminOnly: true },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/visit-reports', label: 'Visit Reports', icon: FileText },
      { href: '/branch-ops',    label: 'Branch Ops',    icon: Building2, adminOnly: true },
    ],
  },
  {
    label: 'Admin',
    adminOnly: true,
    items: [
      { href: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
    ],
  },
];

const settingsSubItems: NavItem[] = [
  { href: '/settings/client-management',       label: 'Clients',                  icon: Briefcase  },
  { href: '/settings/client-locations',        label: 'Client Locations',         icon: MapPinned  },
  { href: '/settings/site-management',         label: 'Duty Sites',               icon: Landmark   },
  { href: '/settings/bulk-import',             label: 'Bulk Import',              icon: FileUp     },
  { href: '/settings/data-export',             label: 'Data Export',              icon: DownloadCloud },
  { href: '/settings/qr-management',           label: 'QR Codes',                 icon: QrCode     },
  { href: '/settings/reports',                 label: 'Reports',                  icon: BarChart3  },
  { href: '/settings/assigned-guards-export',  label: 'Assigned Guards Export',   icon: Users      },
];

// Bottom nav: 4 primary + More
const bottomNavItems: NavItem[] = [
  { href: '/dashboard',       label: 'Home',       icon: LayoutDashboard, exact: true },
  { href: '/employees',       label: 'Guards',     icon: Users },
  { href: '/attendance-logs', label: 'Attendance', icon: CalendarCheck },
  { href: '/work-orders',     label: 'Orders',     icon: ClipboardList },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isActiveItem(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

function getVisibleGroups(groups: NavGroup[], userRole: string | null): NavGroup[] {
  return groups
    .filter(g => !g.adminOnly || userRole === 'admin')
    .map(g => ({
      ...g,
      items: g.items.filter(item => {
        if (item.adminOnly && userRole !== 'admin') return false;
        if (!item.clientVisible && userRole === 'client') return false;
        return true;
      }),
    }))
    .filter(g => g.items.length > 0);
}

// Get current page label for mobile header
function getCurrentPageLabel(pathname: string, userRole: string | null): string {
  if (pathname === '/dashboard') return 'Dashboard';
  const allItems = [
    ...mainNavGroups.flatMap(g => g.items),
    ...settingsSubItems,
  ];
  const match = allItems.find(item =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)
  );
  if (match) {
    if (userRole === 'fieldOfficer' && match.fieldOfficerLabel) {
      return match.fieldOfficerLabel;
    }
    return match.label;
  }
  if (pathname.startsWith('/settings')) return 'Settings';
  return 'CISS Workforce';
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar NavLink
// ─────────────────────────────────────────────────────────────────────────────

function SidebarNavLink({
  item,
  userRole,
  onClick,
  collapsed = false,
}: {
  item: NavItem;
  userRole: string | null;
  onClick?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const active = isActiveItem(pathname, item);
  const label =
    userRole === 'fieldOfficer' && item.fieldOfficerLabel
      ? item.fieldOfficerLabel
      : item.label;

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={item.href}
            onClick={onClick}
            className={cn(
              'flex items-center justify-center h-10 w-10 mx-auto rounded-xl transition-all duration-200',
              active
                ? 'bg-white/15 text-white ring-1 ring-brand-gold/40'
                : 'text-white/55 hover:text-white hover:bg-white/10'
            )}
          >
            <item.icon
              className={cn(
                'h-5 w-5 shrink-0',
                active ? 'text-brand-gold-light' : ''
              )}
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8} className="font-medium text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        // border-l-2 for the gold accent — no overflow/clip issues at rounded corners
        'group flex items-center gap-3 rounded-xl py-2.5 pr-3 text-sm font-medium',
        'transition-all duration-200',
        active
          ? 'bg-white/15 text-white border-l-2 border-brand-gold pl-[10px]'
          : 'text-white/65 hover:text-white hover:bg-white/10 border-l-2 border-transparent pl-[10px]'
      )}
    >
      <item.icon
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-all duration-200',
          active ? 'text-brand-gold-light' : 'text-white/50 group-hover:text-white/80'
        )}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop Sidebar
// ─────────────────────────────────────────────────────────────────────────────

function DesktopSidebar({
  userRole,
  isSettingsPage,
  user,
  onLogout,
  collapsed,
  onToggle,
}: {
  userRole: string | null;
  isSettingsPage: boolean;
  user: User;
  onLogout: () => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const visibleGroups = getVisibleGroups(mainNavGroups, userRole);
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Admin';
  const initials = displayName.slice(0, 2).toUpperCase();
  const roleBadge = userRole === 'admin' ? 'Administrator'
    : userRole === 'fieldOfficer' ? 'Field Officer'
    : userRole === 'client' ? 'Client'
    : 'User';

  return (
    <TooltipProvider delayDuration={200}>
      <aside className="hidden md:flex flex-col h-full max-h-screen bg-brand-blue overflow-hidden">

        {/* Logo area */}
        <div className={cn(
          "flex h-16 items-center shrink-0 border-b border-white/10 transition-all duration-300",
          collapsed ? "justify-center px-0" : "gap-3 px-5"
        )}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 shrink-0">
            <Image src="/ciss-logo.png" alt="CISS" width={26} height={26} unoptimized />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 animate-fade-in">
              <p className="text-white font-bold text-sm truncate leading-tight tracking-wide">
                CISS Workforce
              </p>
              <p className="text-white/45 text-[10px] truncate uppercase tracking-widest font-medium">
                Management Platform
              </p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className={cn(
          "flex-1 overflow-y-auto scrollbar-none py-4 space-y-1 transition-all duration-300",
          collapsed ? "px-1.5" : "px-3"
        )}>
          {isSettingsPage ? (
            <>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/dashboard"
                      className="flex items-center justify-center h-10 w-10 mx-auto rounded-xl text-white/65 hover:text-white hover:bg-white/10 transition-all mb-2"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8} className="text-xs font-medium">Back to Main Menu</TooltipContent>
                </Tooltip>
              ) : (
                <>
                  <Link
                    href="/dashboard"
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-white/65 hover:text-white hover:bg-white/10 transition-all mb-3"
                  >
                    <ChevronLeft className="h-4 w-4 shrink-0" />
                    Back to Main Menu
                  </Link>
                  <p className="section-label text-brand-gold/80 px-3 mb-2">Settings</p>
                </>
              )}
              {settingsSubItems.map(item => (
                <SidebarNavLink key={item.href} item={item} userRole={userRole} collapsed={collapsed} />
              ))}
            </>
          ) : (
            visibleGroups.map((group, gi) => (
              <div key={group.label} className={cn(gi > 0 && (collapsed ? "pt-2 border-t border-white/10 mt-2" : "pt-4"))}>
                {!collapsed && (
                  <p className="section-label text-brand-gold/60 px-3 mb-1">{group.label}</p>
                )}
                {collapsed && gi > 0 && <div className="h-px bg-white/10 mx-2 mb-2" />}
                <div className={cn("space-y-0.5", collapsed && "space-y-1")}>
                  {group.items.map(item => (
                    <SidebarNavLink key={item.href} item={item} userRole={userRole} collapsed={collapsed} />
                  ))}
                </div>
              </div>
            ))
          )}
        </nav>

        {/* User section */}
        <div className="border-t border-white/10 p-2 shrink-0">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex w-full items-center justify-center rounded-xl h-10 text-white/70 hover:text-white hover:bg-white/10 transition-all group">
                      <Avatar className="h-7 w-7 shrink-0 ring-2 ring-white/20 group-hover:ring-brand-gold/60 transition-all">
                        <AvatarImage src={user?.photoURL || undefined} />
                        <AvatarFallback className="text-[10px] bg-brand-gold text-white font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="right" sideOffset={8} className="w-52">
                    <DropdownMenuLabel className="text-xs font-semibold">{displayName}</DropdownMenuLabel>
                    <DropdownMenuLabel className="text-xs text-muted-foreground truncate font-normal -mt-1 pt-0">{user.email}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onLogout} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8} className="text-xs font-medium">
                {displayName} · {roleBadge}
              </TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-white/70 hover:text-white hover:bg-white/10 transition-all text-left group">
                  <Avatar className="h-8 w-8 shrink-0 ring-2 ring-white/20 group-hover:ring-brand-gold/60 transition-all">
                    <AvatarImage src={user?.photoURL || undefined} />
                    <AvatarFallback className="text-xs bg-brand-gold text-white font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 animate-fade-in">
                    <p className="text-xs font-semibold text-white truncate leading-tight">{displayName}</p>
                    <p className="text-[10px] text-white/45 truncate capitalize font-medium">{roleBadge}</p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-white/40 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground truncate font-normal">{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile Bottom Navigation Bar
// ─────────────────────────────────────────────────────────────────────────────

function MobileBottomNav({
  onMoreClick,
  moreActive,
}: {
  onMoreClick: () => void;
  moreActive: boolean;
}) {
  const pathname = usePathname();
  const isSettingsPage = pathname.startsWith('/settings');
  if (isSettingsPage) return null;

  return (
    <nav
      className={cn(
        "md:hidden fixed bottom-0 left-0 right-0 z-40",
        "bg-white/95 backdrop-blur-md border-t border-border/50",
        "pb-safe"
      )}
      style={{ boxShadow: "0 -1px 0 0 hsl(var(--border) / 0.6)" }}
    >
      <div className="flex items-stretch h-[56px]">
        {bottomNavItems.map(item => {
          const active = isActiveItem(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "bottom-nav-item relative transition-colors duration-150",
                active ? "text-brand-blue" : "text-muted-foreground/70"
              )}
            >
              {/* Slim top-border indicator — native iOS style, no blob */}
              <span
                className={cn(
                  "absolute top-0 left-1/2 -translate-x-1/2 h-[2.5px] rounded-b-full transition-all duration-200",
                  active ? "w-6 bg-brand-blue" : "w-0 bg-transparent"
                )}
                aria-hidden
              />
              <item.icon
                className={cn(
                  "transition-all duration-150",
                  active ? "h-[22px] w-[22px]" : "h-5 w-5"
                )}
              />
              <span
                className={cn(
                  "text-[10px] leading-none transition-all duration-150",
                  active ? "font-semibold" : "font-medium"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* More button */}
        <button
          onClick={onMoreClick}
          className={cn(
            "bottom-nav-item relative transition-colors duration-150",
            moreActive ? "text-brand-blue" : "text-muted-foreground/70"
          )}
        >
          <span
            className={cn(
              "absolute top-0 left-1/2 -translate-x-1/2 h-[2.5px] rounded-b-full transition-all duration-200",
              moreActive ? "w-6 bg-brand-blue" : "w-0 bg-transparent"
            )}
            aria-hidden
          />
          <MoreHorizontal
            className={cn(
              "transition-all duration-150",
              moreActive ? "h-[22px] w-[22px]" : "h-5 w-5"
            )}
          />
          <span
            className={cn(
              "text-[10px] leading-none transition-all duration-150",
              moreActive ? "font-semibold" : "font-medium"
            )}
          >
            More
          </span>
        </button>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile "More" Drawer
// ─────────────────────────────────────────────────────────────────────────────

function MobileMoreSheet({
  open,
  onOpenChange,
  userRole,
  user,
  onLogout,
  isSettingsPage,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userRole: string | null;
  user: User;
  onLogout: () => void;
  isSettingsPage: boolean;
}) {
  const visibleGroups = getVisibleGroups(mainNavGroups, userRole);
  const close = () => onOpenChange(false);
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Admin';
  const initials = displayName.slice(0, 2).toUpperCase();
  const roleBadge = userRole === 'admin' ? 'Administrator'
    : userRole === 'fieldOfficer' ? 'Field Officer'
    : userRole === 'client' ? 'Client'
    : 'User';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex flex-col p-0 w-[280px] bg-brand-blue border-r-0 shadow-brand-lg">
        <SheetTitle className="sr-only">Navigation Menu</SheetTitle>

        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-4 shrink-0">
          <Link href="/dashboard" onClick={close} className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
              <Image src="/ciss-logo.png" alt="CISS" width={22} height={22} unoptimized />
            </div>
            <span className="text-white font-bold text-sm tracking-wide">CISS Workforce</span>
          </Link>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto scrollbar-none py-4 px-3 space-y-1">
          {isSettingsPage ? (
            <>
              <Link
                href="/dashboard"
                onClick={close}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-white/65 hover:text-white hover:bg-white/10 transition-all mb-3"
              >
                <ChevronLeft className="h-4 w-4" />
                Back to Main Menu
              </Link>
              <p className="section-label text-brand-gold/60 px-3 mb-1">Settings</p>
              {settingsSubItems.map(item => (
                <SidebarNavLink key={item.href} item={item} userRole={userRole} onClick={close} />
              ))}
            </>
          ) : (
            visibleGroups.map((group, gi) => (
              <div key={group.label} className={cn(gi > 0 && "pt-3")}>
                <p className="section-label text-brand-gold/60 px-3 mb-1">{group.label}</p>
                <div className="space-y-0.5">
                  {group.items.map(item => (
                    <SidebarNavLink key={item.href} item={item} userRole={userRole} onClick={close} />
                  ))}
                </div>
              </div>
            ))
          )}
        </nav>

        {/* User section */}
        <div className="border-t border-white/10 p-4 shrink-0">
          <div className="flex items-center gap-3 mb-3 p-2 rounded-xl bg-white/8">
            <Avatar className="h-9 w-9 shrink-0 ring-2 ring-brand-gold/40">
              <AvatarImage src={user?.photoURL || undefined} />
              <AvatarFallback className="text-sm bg-brand-gold text-white font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate leading-tight">{displayName}</p>
              <p className="text-xs text-white/50 capitalize font-medium">{roleBadge}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start text-white/70 hover:text-white hover:bg-white/10 gap-3 px-3 rounded-xl"
            onClick={() => { close(); onLogout(); }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile Header
// ─────────────────────────────────────────────────────────────────────────────

function MobileHeader({
  isSettingsPage,
  onMenuClick,
  user,
  onLogout,
  userRole,
  pathname,
}: {
  isSettingsPage: boolean;
  onMenuClick: () => void;
  user: User;
  onLogout: () => void;
  userRole: string | null;
  pathname: string;
}) {
  const pageLabel = getCurrentPageLabel(pathname, userRole);
  const initials = (user?.displayName || user?.email || 'A').slice(0, 2).toUpperCase();

  return (
    <header className="md:hidden sticky top-0 z-30 flex h-14 items-center gap-3 bg-white/95 backdrop-blur-md border-b border-border/60 px-4 shrink-0 shadow-brand-xs">
      {isSettingsPage ? (
        <Link
          href="/dashboard"
          className="flex items-center justify-center h-8 w-8 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-blue-pale shrink-0">
          <Image src="/ciss-logo.png" alt="CISS" width={18} height={18} unoptimized />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{pageLabel}</p>
      </div>

      <div className="flex items-center gap-1.5">
        {isSettingsPage && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onMenuClick}
            className="text-muted-foreground"
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="rounded-full p-0 h-8 w-8">
              <Avatar className="h-7 w-7">
                <AvatarImage src={user?.photoURL || undefined} />
                <AvatarFallback className="text-[10px] bg-brand-blue text-white font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-xs text-muted-foreground font-normal truncate">
              {user.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onLogout}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading Screen
// ─────────────────────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-brand-blue gap-4">
      <div className="flex flex-col items-center gap-3 animate-scale-in">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 shadow-brand-md">
          <Image src="/ciss-logo.png" alt="CISS" width={40} height={40} unoptimized />
        </div>
        <div>
          <p className="text-white font-bold text-lg text-center tracking-wide">CISS Workforce</p>
          <p className="text-white/50 text-xs text-center tracking-widest uppercase font-medium mt-0.5">
            Management Platform
          </p>
        </div>
      </div>
      <div className="flex gap-1.5 animate-fade-in stagger-3">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-brand-gold animate-bounce"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop Top Bar
// ─────────────────────────────────────────────────────────────────────────────

function DesktopTopBar({
  user,
  onLogout,
  userRole,
  pathname,
  onSidebarToggle,
  sidebarCollapsed,
}: {
  user: User;
  onLogout: () => void;
  userRole: string | null;
  pathname: string;
  onSidebarToggle: () => void;
  sidebarCollapsed: boolean;
}) {
  const pageLabel = getCurrentPageLabel(pathname, userRole);
  const initials = (user?.displayName || user?.email || 'A').slice(0, 2).toUpperCase();

  return (
    <header className="hidden md:flex h-14 items-center justify-between gap-4 border-b border-border/60 bg-white/95 backdrop-blur-sm px-4 shrink-0 shadow-brand-xs">
      <div className="flex items-center gap-2 min-w-0">
        {/* Sidebar toggle */}
        <button
          onClick={onSidebarToggle}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <PanelLeft className={cn("h-4 w-4 transition-transform duration-300", sidebarCollapsed && "rotate-180")} />
        </button>
        <h2 className="text-sm font-semibold text-foreground truncate">{pageLabel}</h2>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 hover:bg-muted transition-colors group">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-semibold text-foreground leading-tight">
                {user?.displayName || user?.email?.split('@')[0] || 'Admin'}
              </p>
              <p className="text-[10px] text-muted-foreground capitalize leading-tight">
                {userRole === 'admin' ? 'Administrator' : userRole ?? 'User'}
              </p>
            </div>
            <Avatar className="h-8 w-8 ring-2 ring-border group-hover:ring-primary/30 transition-all">
              <AvatarImage src={user?.photoURL || undefined} />
              <AvatarFallback className="text-xs bg-brand-blue text-white font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal truncate">
            {user.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onLogout}
            className="text-destructive focus:text-destructive focus:bg-destructive/10"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AppLayout
// ─────────────────────────────────────────────────────────────────────────────

export function AppLayout({ children }: { children: ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [authUser, setAuthUser]           = useState<User | null>(null);
  const [userRole, setUserRole]           = useState<string | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const prevPathname = useRef(pathname);

  // Restore sidebar preference from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('ciss-sidebar-collapsed');
      if (stored !== null) setSidebarCollapsed(stored === 'true');
    } catch { /* SSR safety */ }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(c => {
      const next = !c;
      try { localStorage.setItem('ciss-sidebar-collapsed', String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  // Close more sheet on navigation
  useEffect(() => {
    if (pathname !== prevPathname.current) {
      setMoreSheetOpen(false);
      prevPathname.current = pathname;
    }
  }, [pathname]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setIsLoadingAuth(true);
      if (user) {
        setAuthUser(user);
        try {
          const appUser = await resolveAppUser(user);
          setUserRole(appUser.role);
        } catch {
          setUserRole('user');
        }
      } else {
        setAuthUser(null);
        setUserRole(null);
        router.replace('/admin-login');
      }
      setIsLoadingAuth(false);
    });
    return () => unsubscribe();
  }, [router]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push('/admin-login');
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  if (isLoadingAuth || !authUser) {
    return <LoadingScreen />;
  }

  const isSettingsPage = pathname.startsWith('/settings');

  // Is the "More" sheet active state — active when showing non-bottom-nav routes
  const isMoreActive = moreSheetOpen || (
    !bottomNavItems.some(i => isActiveItem(pathname, i)) && !isSettingsPage
  );

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* ── Desktop Sidebar ── */}
      <div
        className={cn(
          "hidden md:flex shrink-0 flex-col h-screen sticky top-0",
          "transition-[width] duration-300 ease-in-out will-change-[width]",
          sidebarCollapsed ? "w-[64px]" : "w-[240px] lg:w-[256px]"
        )}
      >
        <DesktopSidebar
          userRole={userRole}
          isSettingsPage={isSettingsPage}
          user={authUser}
          onLogout={handleLogout}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
        />
      </div>

      {/* ── Main Content ── */}
      <div className="flex flex-col flex-1 min-w-0 min-h-screen">
        {/* Mobile top bar */}
        <MobileHeader
          isSettingsPage={isSettingsPage}
          onMenuClick={() => setMoreSheetOpen(true)}
          user={authUser}
          onLogout={handleLogout}
          userRole={userRole}
          pathname={pathname}
        />

        {/* Desktop top bar */}
        <DesktopTopBar
          user={authUser}
          onLogout={handleLogout}
          userRole={userRole}
          pathname={pathname}
          onSidebarToggle={toggleSidebar}
          sidebarCollapsed={sidebarCollapsed}
        />

        {/* Page content */}
        <main className="flex-1 p-4 sm:p-5 lg:p-6 pb-[88px] md:pb-6 overflow-x-hidden">
          {children}
        </main>
      </div>

      {/* ── Mobile Bottom Nav ── */}
      <MobileBottomNav
        onMoreClick={() => setMoreSheetOpen(true)}
        moreActive={isMoreActive}
      />

      {/* ── More Drawer ── */}
      {authUser && (
        <MobileMoreSheet
          open={moreSheetOpen}
          onOpenChange={setMoreSheetOpen}
          userRole={userRole}
          user={authUser}
          onLogout={handleLogout}
          isSettingsPage={isSettingsPage}
        />
      )}
    </div>
  );
}

export default AppLayout;
