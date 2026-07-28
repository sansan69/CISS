"use client";

import type { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  CaretLeft,
  CaretRight,
  DotsThree,
  List,
  SignOut,
  SidebarSimple,
  X,
} from '@phosphor-icons/react';
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
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { requestNotificationPermission, registerFCMToken } from '@/lib/fcm';
import { cn } from '@/lib/utils';
import { canonicalizeDistrictList } from '@/lib/districts';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { resolveAppUser } from '@/lib/auth/roles';
import { useHaptics } from '@/hooks/use-haptics';
import { LogoutDialog } from '@/components/common/logout-dialog';
import { AuthContext } from '@/context/auth-context';
import { toast } from '@/hooks/use-toast';
import { PageTransition } from '@/components/motion/page-transition';
import {
  bottomNavItems,
  getVisibleGroups,
  getVisibleNavItems,
  mainNavGroups,
  settingsSubItems,
  type NavItem,
} from './navigation';

function isActiveItem(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
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
              'flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-200 active:scale-[0.97]',
              active
                ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                : 'text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            )}
            aria-current={active ? 'page' : undefined}
          >
            <item.icon
              className={cn(
                'h-5 w-5 shrink-0',
                active ? 'text-sidebar-primary-foreground' : ''
              )}
              weight={active ? 'fill' : 'regular'}
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
        'group relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold',
        'transition-colors duration-200 active:scale-[0.99]',
        active
          ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
          : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
      )}
      aria-current={active ? 'page' : undefined}
    >
      {active && (
        <span
          className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-brand-gold"
          aria-hidden
        />
      )}
      <item.icon
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-all duration-200',
          active ? 'text-sidebar-primary-foreground' : 'text-sidebar-foreground/50 group-hover:text-sidebar-accent-foreground'
        )}
        weight={active ? 'fill' : 'regular'}
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
  isSuperAdmin,
  clientInfo,
}: {
  userRole: string | null;
  isSettingsPage: boolean;
  user: User;
  onLogout: () => void;
  collapsed: boolean;
  isSuperAdmin?: boolean;
  clientInfo?: { clientId: string; clientName: string } | null;
}) {
  const visibleGroups = getVisibleGroups(mainNavGroups, userRole, isSuperAdmin, clientInfo);
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Admin';
  const initials = displayName.slice(0, 2).toUpperCase();
  const roleBadge = userRole === 'admin' ? 'Administrator'
    : userRole === 'fieldOfficer' ? 'Field Officer'
    : userRole === 'client' ? 'Client'
    : 'User';

  return (
    <TooltipProvider delayDuration={200}>
      <aside className="hidden h-full max-h-screen flex-col overflow-hidden border-r border-sidebar-border bg-sidebar md:flex">

        {/* Logo area */}
        <div className={cn(
          "flex h-[72px] shrink-0 items-center border-b border-sidebar-border transition-all duration-300",
          collapsed ? "justify-center px-0" : "gap-3 px-4"
        )}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
            <Image
              src="/ciss-logo.png"
              alt="CISS"
              width={26}
              height={26}
              className="h-auto w-auto"
              unoptimized
            />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 animate-fade-in">
              <p className="truncate font-exo2 text-[15px] font-bold leading-tight text-sidebar-foreground">
                CISS Workforce
              </p>
              <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-[0.16em] text-sidebar-foreground/45">
                Operations
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
                    className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    >
                      <CaretLeft className="h-5 w-5" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8} className="text-xs font-medium">Back to Main Menu</TooltipContent>
                </Tooltip>
              ) : (
                <>
                  <Link
                    href="/dashboard"
                    className="mb-3 flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  >
                    <CaretLeft className="h-4 w-4 shrink-0" />
                    Back to Main Menu
                  </Link>
                  <p className="section-label mb-2 px-3 text-sidebar-foreground/45">Settings</p>
                </>
              )}
              {settingsSubItems.map(item => (
                <SidebarNavLink key={item.href} item={item} userRole={userRole} collapsed={collapsed} />
              ))}
            </>
          ) : (
            visibleGroups.map((group, gi) => (
              <div key={group.label} className={cn(gi > 0 && (collapsed ? "mt-2 border-t border-sidebar-border pt-2" : "pt-4"))}>
                {!collapsed && (
                  <p className="section-label mb-1 px-3 text-sidebar-foreground/40">{group.label}</p>
                )}
                {collapsed && gi > 0 && <div className="mx-2 mb-2 h-px bg-sidebar-border" />}
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
        <div className="shrink-0 border-t border-sidebar-border p-2">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="group flex h-10 w-full items-center justify-center rounded-xl text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                      <Avatar className="h-7 w-7 shrink-0 ring-2 ring-sidebar-border transition-colors group-hover:ring-primary/30">
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
                      <SignOut className="mr-2 h-4 w-4" />
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
                <button className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                  <Avatar className="h-8 w-8 shrink-0 ring-2 ring-sidebar-border transition-colors group-hover:ring-primary/30">
                    <AvatarImage src={user?.photoURL || undefined} />
                    <AvatarFallback className="text-xs bg-brand-gold text-white font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 animate-fade-in">
                    <p className="truncate text-xs font-bold leading-tight text-sidebar-foreground">{displayName}</p>
                    <p className="truncate text-[10px] font-medium capitalize text-sidebar-foreground/45">{roleBadge}</p>
                  </div>
                  <CaretRight className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/35" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground truncate font-normal">{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                  <SignOut className="mr-2 h-4 w-4" />
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
  items,
  onMoreClick,
  moreActive,
}: {
  items: NavItem[];
  onMoreClick: () => void;
  moreActive: boolean;
}) {
  const pathname = usePathname();
  const { haptic } = useHaptics();
  const isSettingsPage = pathname.startsWith('/settings');
  if (isSettingsPage) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 px-3 md:hidden"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
    >
      <nav
        className={cn(
          "flex h-16 items-stretch rounded-[22px]",
          "border border-border/80 bg-card/95 backdrop-blur-xl",
          "shadow-[0_10px_28px_hsl(207_52%_13%/0.14)]"
        )}
      >
        {items.map(item => {
          const active = isActiveItem(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => haptic('light')}
              className={cn(
                "bottom-nav-item relative",
                "select-none rounded-[18px] transition-colors duration-150 active:scale-[0.97]",
                active ? "text-brand-blue" : "text-muted-foreground/60"
              )}
              aria-current={active ? "page" : undefined}
            >
              <div className={cn(
                "relative flex h-8 min-w-14 items-center justify-center rounded-full px-4 transition-colors",
                active && "bg-primary/10"
              )}>
                <item.icon
                  className="h-[22px] w-[22px]"
                  weight={active ? "fill" : "regular"}
                />
              </div>
              <span className={cn("text-[10px] leading-none tracking-wide", active ? "font-black" : "font-bold")}>
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* Divider */}
        <div className="my-3 w-px bg-border/60 shrink-0" aria-hidden />

        {/* More button */}
        <button
          onClick={() => { haptic('light'); onMoreClick(); }}
          className={cn(
            "bottom-nav-item relative",
            "select-none rounded-[18px] transition-colors duration-150 active:scale-[0.97]",
            moreActive ? "text-brand-blue" : "text-muted-foreground/60"
          )}
        >
          <div className={cn(
            "relative flex h-8 min-w-14 items-center justify-center rounded-full px-4 transition-colors",
            moreActive && "bg-primary/10"
          )}>
            <DotsThree
              className="h-[22px] w-[22px]"
              weight={moreActive ? "fill" : "bold"}
            />
          </div>
          <span className={cn("text-[10px] leading-none tracking-wide", moreActive ? "font-black" : "font-bold")}>
            More
          </span>
        </button>
      </nav>
    </div>
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
  isSuperAdmin,
  clientInfo,
}: {
  open: boolean;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  userRole: string | null;
  user: User;
  onLogout: () => void;
  isSettingsPage: boolean;
  isSuperAdmin?: boolean;
  clientInfo?: { clientId: string; clientName: string } | null;
}) {
  const visibleGroups = getVisibleGroups(mainNavGroups, userRole, isSuperAdmin, clientInfo);
  const { haptic } = useHaptics();
  const close = () => { haptic('light'); onOpenChange(false); };
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Admin';
  const initials = displayName.slice(0, 2).toUpperCase();
  const roleBadge = userRole === 'admin' ? 'Administrator'
    : userRole === 'fieldOfficer' ? 'Field Officer'
    : userRole === 'client' ? 'Client'
    : 'User';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex w-[min(88vw,320px)] flex-col border-r border-sidebar-border bg-sidebar p-0 shadow-brand-lg">
        <SheetTitle className="sr-only">Navigation Menu</SheetTitle>

        {/* Header */}
        <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-sidebar-border px-4">
          <Link href="/dashboard" onClick={close} className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
              <Image
                src="/ciss-logo.png"
                alt="CISS"
                width={22}
                height={22}
                className="h-auto w-auto"
                unoptimized
              />
            </div>
            <span className="font-exo2 text-sm font-bold tracking-wide text-sidebar-foreground">CISS Workforce</span>
          </Link>
          <button
            onClick={close}
            aria-label="Close menu"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-[0.97]"
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
                className="mb-3 flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <CaretLeft className="h-4 w-4" />
                Back to Main Menu
              </Link>
              <p className="section-label mb-1 px-3 text-sidebar-foreground/40">Settings</p>
              {settingsSubItems.map(item => (
                <SidebarNavLink key={item.href} item={item} userRole={userRole} onClick={close} />
              ))}
            </>
          ) : (
            visibleGroups.map((group, gi) => (
              <div key={group.label} className={cn(gi > 0 && "pt-3")}>
                <p className="section-label mb-1 px-3 text-sidebar-foreground/40">{group.label}</p>
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
        <div className="shrink-0 border-t border-sidebar-border p-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-sidebar-accent p-2">
            <Avatar className="h-9 w-9 shrink-0 ring-2 ring-brand-gold/40">
              <AvatarImage src={user?.photoURL || undefined} />
              <AvatarFallback className="text-sm bg-brand-gold text-white font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight text-sidebar-foreground">{displayName}</p>
              <p className="text-xs font-medium capitalize text-sidebar-foreground/50">{roleBadge}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 rounded-xl px-3 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => { close(); onLogout(); }}
          >
            <SignOut className="h-4 w-4" />
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
    <header className="sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-border/70 bg-card/92 px-4 backdrop-blur-xl md:hidden"
      style={{
        minHeight: 56,
        paddingTop: "env(safe-area-inset-top, 0px)",
        boxShadow: "0 1px 0 hsl(var(--border) / 0.5), 0 2px 8px hsl(0 0% 0% / 0.04)"
      }}>
      {isSettingsPage ? (
        <Link
          href="/dashboard"
          className="flex items-center justify-center h-8 w-8 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <CaretLeft className="h-5 w-5" />
        </Link>
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-blue-pale shrink-0">
          <Image
            src="/ciss-logo.png"
            alt="CISS"
            width={18}
            height={18}
            className="h-auto w-auto"
            unoptimized
          />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate font-exo2 tracking-tight">{pageLabel}</p>
      </div>

      <div className="flex items-center gap-1.5">
        {isSettingsPage && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onMenuClick}
            className="text-muted-foreground"
          >
            <List className="h-5 w-5" />
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
              <SignOut className="mr-2 h-4 w-4" />
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
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-5 bg-background">
      <div className="flex flex-col items-center gap-3 animate-scale-in">
        <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-primary/10 ring-1 ring-primary/15">
          <Image
            src="/ciss-logo.png"
            alt="CISS"
            width={40}
            height={40}
            className="h-auto w-auto"
            unoptimized
          />
        </div>
        <div>
          <p className="text-center font-exo2 text-lg font-bold tracking-wide text-foreground">CISS Workforce</p>
          <p className="mt-0.5 text-center text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Preparing workspace
          </p>
        </div>
      </div>
      <div className="flex gap-1.5 animate-fade-in stagger-3">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"
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
    <header className="sticky top-0 z-20 hidden h-16 shrink-0 items-center justify-between gap-4 border-b border-border/70 bg-background/92 px-5 backdrop-blur-xl md:flex">
      <div className="flex items-center gap-2 min-w-0">
        {/* Sidebar toggle */}
        <button
          onClick={onSidebarToggle}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <SidebarSimple className="h-[18px] w-[18px]" weight={sidebarCollapsed ? "fill" : "regular"} />
        </button>
        <h2 className="text-sm font-semibold text-foreground truncate">{pageLabel}</h2>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-muted transition-colors group">
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
              <SignOut className="mr-2 h-4 w-4" />
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

export default function AppLayout({ children }: { children: ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const { haptic } = useHaptics();
  const [authUser, setAuthUser]           = useState<User | null>(null);
  const [userRole, setUserRole]           = useState<string | null>(null);
  const [assignedDistricts, setAssignedDistricts] = useState<string[]>([]);
  const [clientInfo, setClientInfo]       = useState<{ clientId: string; clientName: string } | null>(null);
  const [stateCode, setStateCode]         = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin]   = useState<boolean>(false);
  const [employeeId, setEmployeeId]       = useState<string | undefined>(undefined);
  const [employeeDocId, setEmployeeDocId] = useState<string | undefined>(undefined);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
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

  // Use refs for values that should not cause re-subscription on every nav
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const isSuperAdminRef = useRef(isSuperAdmin);
  isSuperAdminRef.current = isSuperAdmin;

  useEffect(() => {
    const currentPathname = pathnameRef.current;
    const currentIsSuperAdmin = isSuperAdminRef.current;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setIsLoadingAuth(true);
      if (user) {
        setAuthUser(user);
        try {
          const appUser = await resolveAppUser(user);
          setUserRole(appUser.role);
          setAssignedDistricts(canonicalizeDistrictList(appUser.assignedDistricts));
          setStateCode(appUser.stateCode ?? null);
          setIsSuperAdmin(appUser.isSuperAdmin ?? false);
          setEmployeeId(appUser.employeeId);
          setEmployeeDocId(appUser.employeeDocId);
          setClientInfo(appUser.clientId && appUser.clientName
            ? { clientId: appUser.clientId, clientName: appUser.clientName }
            : null
          );

          if (appUser.role === 'guard') {
            router.replace('/guard/dashboard');
            return;
          }

          try {
            const token = await requestNotificationPermission();
            if (token) {
              await registerFCMToken(user.uid, token);
            }
          } catch {
            // FCM registration optional — non-fatal
          }

          // Regional setup wizard: redirect admin users if setup not complete
          if (appUser.role === 'admin' && !currentIsSuperAdmin && currentPathname !== '/wizard' && currentPathname !== '/admin-login') {
            try {
              const adminToken = await user.getIdToken();
              const wizardRes = await fetch('/api/wizard/profile', {
                headers: { Authorization: `Bearer ${adminToken}` },
              });
              if (wizardRes.ok) {
                const wizardData = await wizardRes.json();
                if (!wizardData.setupComplete) {
                  router.replace('/wizard');
                }
              }
            } catch {
              // Non-critical — if wizard check fails, let dashboard load
            }
          }
        } catch (err) {
          // Distinguish network/auth errors from "no role" case
          const isNetworkError = err instanceof TypeError ||
            (err instanceof Error && (
              err.message.includes('network') ||
              err.message.includes('fetch') ||
              err.message.includes('offline') ||
              err.message.includes('ERR_NAME_NOT_RESOLVED')
            ));

          setUserRole(isNetworkError ? null : 'user');
          setAssignedDistricts([]);
          setClientInfo(null);
          setStateCode(null);
          setIsSuperAdmin(false);
          setEmployeeId(undefined);
          setEmployeeDocId(undefined);

          if (isNetworkError) {
            toast({
              title: "Connection Error",
              description: "Could not verify your session. Please check your connection and try again.",
              variant: "destructive",
            });
          }
        }
      } else {
        setAuthUser(null);
        setUserRole(null);
        setAssignedDistricts([]);
        setClientInfo(null);
        setStateCode(null);
        setIsSuperAdmin(false);
        setEmployeeId(undefined);
        setEmployeeDocId(undefined);
        router.replace('/admin-login');
      }
      setIsLoadingAuth(false);
    });
    return () => unsubscribe();
  }, [router]);

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const authContextValue = useMemo(
    () => ({ user: authUser, userRole, assignedDistricts, clientInfo, stateCode, isSuperAdmin, employeeId, employeeDocId }),
    [authUser, userRole, assignedDistricts, clientInfo, stateCode, isSuperAdmin, employeeId, employeeDocId]
  );

  if (isLoadingAuth || !authUser) {
    return <LoadingScreen />;
  }

  const isSettingsPage = pathname.startsWith('/settings');
  const visibleBottomNavItems = getVisibleNavItems(bottomNavItems, userRole, isSuperAdmin, clientInfo);

  // Is the "More" sheet active state — active when showing non-bottom-nav routes
  const isMoreActive = moreSheetOpen || (
    !visibleBottomNavItems.some(i => isActiveItem(pathname, i)) && !isSettingsPage
  );

  return (
    <>
    <AuthContext.Provider value={authContextValue}>
      <div className="flex min-h-[100dvh] w-full app-shell-surface">
        {/* ── Desktop Sidebar ── */}
      <div
        className={cn(
          "sticky top-0 z-10 hidden h-[100dvh] shrink-0 flex-col md:flex",
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
          isSuperAdmin={isSuperAdmin}
          clientInfo={clientInfo}
        />
      </div>

      {/* ── Main Content ── */}
      <div className="flex min-h-[100dvh] min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <MobileHeader
          isSettingsPage={isSettingsPage}
          onMenuClick={() => { haptic('medium'); setMoreSheetOpen(true); }}
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
        <main className="flex-1 overflow-x-hidden px-4 pb-[104px] pt-4 sm:px-5 sm:pt-5 md:pb-8 lg:px-8 lg:pt-7">
          <PageTransition routeKey={pathname}>{children}</PageTransition>
        </main>
      </div>

      {/* ── Mobile Bottom Nav ── */}
      <MobileBottomNav
        items={visibleBottomNavItems}
        onMoreClick={() => { haptic('medium'); setMoreSheetOpen(true); }}
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
          isSuperAdmin={isSuperAdmin}
          clientInfo={clientInfo}
        />
      )}
    </div>
    </AuthContext.Provider>

    <LogoutDialog
      open={showLogoutConfirm}
      onOpenChange={setShowLogoutConfirm}
      redirectTo="/admin-login"
    />
    </>
  );
}
