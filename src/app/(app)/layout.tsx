
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
  UserPlus,
  CalendarCheck,
  Settings,
  LogOut,
  ChevronLeft,
  Menu,
  Briefcase,
  FileUp,
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
import { useIsMobile } from '@/hooks/use-mobile';


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

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary",
        isActive && "bg-muted text-primary"
      )}
    >
      <item.icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}


function MobileNav() {
    return (
        <Sheet>
            <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 md:hidden">
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Toggle navigation menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col">
                <nav className="grid gap-2 text-lg font-medium">
                    <Link href="/dashboard" className="flex items-center gap-2 text-lg font-semibold mb-4">
                        <Image src="/ciss-logo.png" alt="CISS Logo" width={32} height={32} unoptimized={true} />
                        <span>CISS Workforce</span>
                    </Link>
                    {navItems.map((item) => <NavLink key={item.href} item={item} />)}
                </nav>
                <div className="mt-auto">
                    <Button asChild>
                        <Link href="/employees/enroll">
                            <UserPlus className="mr-2 h-4 w-4" /> Enroll Employee
                        </Link>
                    </Button>
                </div>
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
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
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
        // Redirect to login if not authenticated and not on a public page
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

  if (isLoadingAuth || !authUser) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Image src="/ciss-logo.png" alt="CISS Logo" width={60} height={60} className="animate-pulse" unoptimized={true} />
      </div>
    );
  }

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <div className="hidden border-r bg-muted/40 md:block">
        <div className="flex h-full max-h-screen flex-col gap-2">
          <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
              <Image src="/ciss-logo.png" alt="CISS Logo" width={32} height={32} unoptimized={true} />
              <span className="">CISS Workforce</span>
            </Link>
          </div>
          <div className="flex-1">
            <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
              {navItems.map((item) => <NavLink key={item.href} item={item} />)}
            </nav>
          </div>
          <div className="mt-auto p-4">
             <Button asChild size="sm" className="w-full">
                <Link href="/employees/enroll">
                    <UserPlus className="mr-2 h-4 w-4" /> Enroll New Employee
                </Link>
             </Button>
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
            <MobileNav />
            <div className="w-full flex-1">
                {/* Header content like a global search can go here */}
            </div>
            <UserNav user={authUser} onLogout={handleLogout} />
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 bg-background">
          {children}
        </main>
        <Toaster />
      </div>
    </div>
  );
}

export default AppLayout;

    