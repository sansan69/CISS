
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
  Menu,
  Briefcase,
  FileUp,
  BarChart3,
  QrCode,
  Loader2,
  ChevronLeft
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
import { Toaster } from "@/components/ui/toaster"
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/employees', label: 'Employees', icon: Users },
  { href: '/attendance-logs', label: 'Attendance', icon: CalendarCheck },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const settingsSubItems: NavItem[] = [
    { href: '/settings/client-management', label: 'Clients', icon: Briefcase },
    { href: '/settings/bulk-import', label: 'Bulk Import', icon: FileUp },
    { href: '/settings/qr-management', label: 'QR Codes', icon: QrCode },
    { href: '/settings/reports', label: 'Reports', icon: BarChart3 },
];

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary hover:bg-muted",
        isActive && "bg-primary/10 text-primary font-semibold"
      )}
    >
      <item.icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}


function DesktopNav({isSettingsPage}: {isSettingsPage: boolean}) {
    const items = isSettingsPage ? settingsSubItems : navItems;
    return (
        <nav className="grid items-start gap-1 p-4 text-sm font-medium">
            {isSettingsPage && (
                 <Link href="/dashboard" className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary mb-2">
                    <ChevronLeft className="h-4 w-4" />
                    Back to Main Menu
                 </Link>
            )}
            {items.map((item) => <NavLink key={item.href} item={item} />)}
        </nav>
    );
}

function MobileNav({isSettingsPage}: {isSettingsPage: boolean}) {
    const items = isSettingsPage ? settingsSubItems : navItems;
    return (
        <Sheet>
            <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 md:hidden">
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Toggle navigation menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col p-0">
                <div className="flex h-16 items-center border-b px-4">
                     <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
                        <Image src="/ciss-logo.png" alt="CISS Logo" width={32} height={32} unoptimized={true} />
                        <span className="text-lg">CISS Workforce</span>
                    </Link>
                </div>
                <nav className="grid gap-2 p-4 text-base font-medium">
                    {isSettingsPage && (
                         <Link href="/dashboard" className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary mb-2">
                            <ChevronLeft className="h-4 w-4" />
                            Back to Main Menu
                         </Link>
                    )}
                   {items.map((item) => <NavLink key={item.href} item={item} />)}
                </nav>
            </SheetContent>
        </Sheet>
    );
}

function UserNav({ user, onLogout }: { user: User, onLogout: () => void }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="rounded-full">
                    <Avatar className="h-8 w-8">
                         <AvatarImage src={user?.photoURL || undefined} alt={user?.displayName || user?.email || "User avatar"} />
                        <AvatarFallback>{user?.email?.[0]?.toUpperCase() || 'A'}</AvatarFallback>
                    </Avatar>
                    <span className="sr-only">Toggle user menu</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>Profile</DropdownMenuItem>
                <DropdownMenuItem disabled>Support</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter(); 
  const pathname = usePathname();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setIsLoadingAuth(false);
      if (!user) {
        const publicPaths = ['/admin-login', '/', '/enroll', '/profile', '/attendance'];
        const isPublicPath = publicPaths.some(path => pathname.startsWith(path) && path !== '/');
        if (!isPublicPath) {
          router.replace('/admin-login');
        }
      }
    });
    return () => unsubscribe();
  }, [pathname, router]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push('/admin-login');
    } catch (error) {
      console.error("Error signing out: ", error);
    }
  };

  const publicPaths = ['/admin-login', '/', '/enroll', '/profile', '/attendance'];
  const isPublicPath = publicPaths.some(path => pathname.startsWith(path) && path !== '/');
  
  // This layout is only for authenticated admin pages
  if (isPublicPath) {
    return <>{children}</>;
  }

  if (isLoadingAuth || !authUser) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary"/>
      </div>
    );
  }
  
  const isSettingsPage = pathname.startsWith('/settings');

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <div className="hidden border-r bg-muted/40 md:block">
        <div className="flex h-full max-h-screen flex-col">
          <div className="flex h-16 items-center border-b px-6">
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
              <Image src="/ciss-logo.png" alt="CISS Logo" width={32} height={32} unoptimized={true} />
              <span className="text-xl">CISS Workforce</span>
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto">
            <DesktopNav isSettingsPage={isSettingsPage} />
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <header className="flex h-16 items-center gap-4 border-b bg-background px-4 lg:px-6 sticky top-0 z-30">
            <MobileNav isSettingsPage={isSettingsPage}/>
            <div className="w-full flex-1">
                {/* Header content can go here */}
            </div>
            <UserNav user={authUser} onLogout={handleLogout} />
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6 bg-muted/30 overflow-auto">
          {children}
        </main>
        <Toaster />
      </div>
    </div>
  );
}

export default AppLayout;
