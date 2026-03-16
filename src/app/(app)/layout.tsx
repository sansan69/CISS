
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
  Loader2,
  Landmark,
  MapPinned,
  DownloadCloud,
  ChevronLeft,
  ShieldAlert,
  ClipboardList,
  MoreHorizontal,
  X,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import React, { useEffect, useState } from 'react';
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
  fieldOfficerLabel?: string;
  icon: React.ElementType;
  exact?: boolean;
  adminOnly?: boolean;
  clientVisible?: boolean; // client users can see this
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
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, exact: true, clientVisible: true },
      { href: '/employees', label: 'Employees', icon: Users, clientVisible: true },
      { href: '/attendance-logs', label: 'Attendance', icon: CalendarCheck, clientVisible: true },
    ],
  },
  {
    label: 'Workforce',
    items: [
      { href: '/work-orders', label: 'Work Orders', fieldOfficerLabel: 'Upcoming Duties', icon: ClipboardList },
      { href: '/field-officers', label: 'Field Officers', icon: ShieldAlert, adminOnly: true },
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
  { href: '/settings/client-management', label: 'Clients', icon: Briefcase },
  { href: '/settings/client-locations', label: 'Client Locations', icon: MapPinned },
  { href: '/settings/site-management', label: 'Duty Sites', icon: Landmark },
  { href: '/settings/bulk-import', label: 'Bulk Import', icon: FileUp },
  { href: '/settings/data-export', label: 'Data Export', icon: DownloadCloud },
  { href: '/settings/qr-management', label: 'QR Codes', icon: QrCode },
  { href: '/settings/reports', label: 'Reports', icon: BarChart3 },
  { href: '/settings/assigned-guards-export', label: 'Assigned Guards Export', icon: Users },
];

// Bottom nav tabs (mobile only) — 4 main + "More"
const bottomNavItems: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard, exact: true },
  { href: '/employees', label: 'Guards', icon: Users },
  { href: '/attendance-logs', label: 'Attendance', icon: CalendarCheck },
  { href: '/work-orders', label: 'Orders', icon: ClipboardList },
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

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar NavLink
// ─────────────────────────────────────────────────────────────────────────────

function SidebarNavLink({
  item,
  userRole,
  onClick,
}: {
  item: NavItem;
  userRole: string | null;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const active = isActiveItem(pathname, item);
  const label =
    userRole === 'fieldOfficer' && item.fieldOfficerLabel
      ? item.fieldOfficerLabel
      : item.label;

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
        'text-white/70 hover:text-white hover:bg-white/10',
        active && 'bg-white/15 text-white border-l-2 border-brand-gold pl-[10px]'
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
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
}: {
  userRole: string | null;
  isSettingsPage: boolean;
  user: User;
  onLogout: () => void;
}) {
  const visibleGroups = getVisibleGroups(mainNavGroups, userRole);

  return (
    <aside className="hidden md:flex flex-col h-full max-h-screen bg-brand-blue">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5 shrink-0">
        <Image
          src="/ciss-logo.png"
          alt="CISS"
          width={32}
          height={32}
          unoptimized
          className="shrink-0"
        />
        <div className="min-w-0">
          <p className="text-white font-bold text-sm truncate leading-tight">CISS Workforce</p>
          <p className="text-white/50 text-xs truncate">Management Platform</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3">
        {isSettingsPage ? (
          <div className="space-y-1">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition-all mb-3"
            >
              <ChevronLeft className="h-4 w-4 shrink-0" />
              Back to Main Menu
            </Link>
            <p className="px-3 py-1 text-xs font-semibold text-brand-gold uppercase tracking-wider">
              Settings
            </p>
            {settingsSubItems.map(item => (
              <SidebarNavLink key={item.href} item={item} userRole={userRole} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {visibleGroups.map(group => (
              <div key={group.label}>
                <p className="px-3 py-1 text-xs font-semibold text-brand-gold uppercase tracking-wider">
                  {group.label}
                </p>
                <div className="space-y-0.5 mt-1">
                  {group.items.map(item => (
                    <SidebarNavLink key={item.href} item={item} userRole={userRole} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* User section at bottom */}
      <div className="border-t border-white/10 p-3 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-white/70 hover:text-white hover:bg-white/10 transition-all text-left">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={user?.photoURL || undefined} />
                <AvatarFallback className="text-xs bg-brand-gold text-white">
                  {user?.email?.[0]?.toUpperCase() || 'A'}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-white truncate">
                  {user?.displayName || user?.email?.split('@')[0] || 'Admin'}
                </p>
                <p className="text-xs text-white/50 truncate capitalize">{userRole ?? 'admin'}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-48">
            <DropdownMenuLabel className="text-xs truncate">{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile Bottom Navigation Bar
// ─────────────────────────────────────────────────────────────────────────────

function MobileBottomNav({
  userRole,
  onMoreClick,
}: {
  userRole: string | null;
  onMoreClick: () => void;
}) {
  const pathname = usePathname();
  const isSettingsPage = pathname.startsWith('/settings');

  if (isSettingsPage) return null;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-border pb-safe">
      <div className="flex items-center justify-around h-16">
        {bottomNavItems.map(item => {
          const active = isActiveItem(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 flex-1 h-full min-h-[48px] transition-colors',
                active ? 'text-brand-blue' : 'text-muted-foreground'
              )}
            >
              <item.icon className={cn('h-5 w-5', active && 'text-brand-blue')} />
              <span className="text-[10px] font-medium">{item.label}</span>
              {active && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-brand-blue rounded-t-full" />
              )}
            </Link>
          );
        })}
        {/* More button */}
        <button
          onClick={onMoreClick}
          className="flex flex-col items-center justify-center gap-1 flex-1 h-full min-h-[48px] text-muted-foreground"
        >
          <MoreHorizontal className="h-5 w-5" />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile "More" Sheet (full nav drawer)
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex flex-col p-0 w-72 bg-brand-blue border-r-0">
        <SheetTitle className="sr-only">Navigation Menu</SheetTitle>

        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-4 shrink-0">
          <Link href="/dashboard" onClick={close} className="flex items-center gap-2">
            <Image src="/ciss-logo.png" alt="CISS" width={28} height={28} unoptimized />
            <span className="text-white font-bold text-sm">CISS Workforce</span>
          </Link>
          <button onClick={close} className="text-white/60 hover:text-white p-1 rounded">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-3">
          {isSettingsPage ? (
            <div className="space-y-1">
              <Link
                href="/dashboard"
                onClick={close}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition-all mb-3"
              >
                <ChevronLeft className="h-4 w-4" />
                Back to Main Menu
              </Link>
              <p className="px-3 py-1 text-xs font-semibold text-brand-gold uppercase tracking-wider">
                Settings
              </p>
              {settingsSubItems.map(item => (
                <SidebarNavLink key={item.href} item={item} userRole={userRole} onClick={close} />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {visibleGroups.map(group => (
                <div key={group.label}>
                  <p className="px-3 py-1 text-xs font-semibold text-brand-gold uppercase tracking-wider">
                    {group.label}
                  </p>
                  <div className="space-y-0.5 mt-1">
                    {group.items.map(item => (
                      <SidebarNavLink key={item.href} item={item} userRole={userRole} onClick={close} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </nav>

        {/* User section */}
        <div className="border-t border-white/10 p-4 shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarImage src={user?.photoURL || undefined} />
              <AvatarFallback className="text-xs bg-brand-gold text-white">
                {user?.email?.[0]?.toUpperCase() || 'A'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {user?.displayName || user?.email?.split('@')[0]}
              </p>
              <p className="text-xs text-white/50 capitalize">{userRole ?? 'admin'}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start text-white/70 hover:text-white hover:bg-white/10 gap-3 px-3"
            onClick={() => { close(); onLogout(); }}
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile Header (settings page + top bar)
// ─────────────────────────────────────────────────────────────────────────────

function MobileHeader({
  isSettingsPage,
  onMenuClick,
  user,
  onLogout,
}: {
  isSettingsPage: boolean;
  onMenuClick: () => void;
  user: User;
  onLogout: () => void;
}) {
  return (
    <header className="md:hidden sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-white px-4 shrink-0">
      {isSettingsPage && (
        <Link href="/dashboard" className="p-1 text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-5 w-5" />
        </Link>
      )}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Image src="/ciss-logo.png" alt="CISS" width={24} height={24} unoptimized />
        <span className="font-semibold text-sm text-brand-blue truncate">
          {isSettingsPage ? 'Settings' : 'CISS Workforce'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full h-8 w-8">
              <Avatar className="h-7 w-7">
                <AvatarImage src={user?.photoURL || undefined} />
                <AvatarFallback className="text-xs bg-brand-blue text-white">
                  {user?.email?.[0]?.toUpperCase() || 'A'}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs">{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Menu button only shows on settings page (where bottom nav is hidden) */}
        {isSettingsPage && (
          <Button variant="ghost" size="icon" onClick={onMenuClick} className="h-8 w-8">
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        )}
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AppLayout
// ─────────────────────────────────────────────────────────────────────────────

export function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

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
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  if (isLoadingAuth || !authUser) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Image src="/ciss-logo.png" alt="CISS" width={48} height={48} unoptimized />
          <Loader2 className="h-6 w-6 animate-spin text-brand-blue" />
        </div>
      </div>
    );
  }

  const isSettingsPage = pathname.startsWith('/settings');

  return (
    <div className="flex min-h-screen w-full">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex w-[240px] lg:w-[260px] shrink-0 flex-col h-screen sticky top-0">
        <DesktopSidebar
          userRole={userRole}
          isSettingsPage={isSettingsPage}
          user={authUser}
          onLogout={handleLogout}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col flex-1 min-w-0 min-h-screen">
        {/* Mobile Header */}
        <MobileHeader
          isSettingsPage={isSettingsPage}
          onMenuClick={() => setMoreSheetOpen(true)}
          user={authUser}
          onLogout={handleLogout}
        />

        {/* Desktop top bar (minimal — just user info, page is identified by sidebar) */}
        <header className="hidden md:flex h-14 items-center justify-end gap-4 border-b bg-white px-6 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={authUser?.photoURL || undefined} />
                  <AvatarFallback className="text-xs bg-brand-blue text-white">
                    {authUser?.email?.[0]?.toUpperCase() || 'A'}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs truncate max-w-[200px]">
                {authUser.email}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page Content */}
        <main className="flex-1 bg-background p-4 sm:p-6 pb-24 md:pb-6 overflow-x-hidden">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav userRole={userRole} onMoreClick={() => setMoreSheetOpen(true)} />

      {/* Mobile "More" Sheet */}
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
