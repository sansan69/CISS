
"use client";

import type { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image'; 
import { usePathname, useRouter } from 'next/navigation'; 
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  LayoutDashboard,
  Users,
  UserPlus,
  CalendarCheck,
  Settings,
  ChevronDown,
  ChevronUp,
  LogOut,
  QrCode,
  FileUp,
  BarChart3,
  Briefcase
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
// Removed SheetTitle import as it's not correctly used here.
// If an accessible name is needed for the sidebar itself, aria-label or a generic sr-only span would be more appropriate.


interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  subItems?: NavItem[];
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    href: '/employees',
    label: 'Employees',
    icon: Users,
    subItems: [
      { href: '/employees', label: 'Directory', icon: Users },
      { href: '/enroll', label: 'Enroll New', icon: UserPlus },
    ],
  },
  { href: '/attendance', label: 'Attendance', icon: CalendarCheck },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    subItems: [
        { href: '/settings/bulk-import', label: 'Bulk Import', icon: FileUp },
        { href: '/settings/qr-management', label: 'QR Management', icon: QrCode },
        { href: '/settings/reports', label: 'Reports', icon: BarChart3 },
        { href: '/settings/client-management', label: 'Client Management', icon: Briefcase },
    ]
  },
];

function NavMenuItem({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname();
  const { open: sidebarOpen } = useSidebar();
  const [isSubMenuOpen, setIsSubMenuOpen] = React.useState(pathname.startsWith(item.href) && item.href !== '/');

  const isActive = item.subItems
    ? pathname.startsWith(item.href)
    : pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href) && pathname.split('/').length === item.href.split('/').length);

  const toggleSubMenu = () => setIsSubMenuOpen(!isSubMenuOpen);

  if (item.subItems) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={toggleSubMenu}
          isActive={isActive && !isSubMenuOpen}
          className="justify-between"
          tooltip={sidebarOpen ? undefined : item.label}
        >
          <div className="flex items-center gap-2">
            <item.icon />
            <span>{item.label}</span>
          </div>
          {isSubMenuOpen ? <ChevronUp /> : <ChevronDown />}
        </SidebarMenuButton>
        {isSubMenuOpen && sidebarOpen && (
          <SidebarMenuSub>
            {item.subItems.map((subItem) => (
              <SidebarMenuSubItem key={subItem.href}>
                <Link href={subItem.href} passHref legacyBehavior>
                  <SidebarMenuSubButton isActive={pathname === subItem.href || (subItem.href !== '/' && pathname.startsWith(subItem.href))}>
                    <subItem.icon />
                    <span>{subItem.label}</span>
                  </SidebarMenuSubButton>
                </Link>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        )}
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <Link href={item.href} passHref legacyBehavior>
        <SidebarMenuButton isActive={isActive} tooltip={sidebarOpen ? undefined : item.label}>
          <item.icon />
          <span>{item.label}</span>
        </SidebarMenuButton>
      </Link>
    </SidebarMenuItem>
  );
}


export function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter(); 
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setAuthUser(user);
      } else {
        setAuthUser(null);
        const publicPaths = ['/admin-login', '/', '/enroll']; 
        if (router.pathname && 
            !publicPaths.includes(router.pathname) && 
            !router.pathname.startsWith('/enroll')) { 
             router.push('/admin-login'); 
        }
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
      console.error("Error signing out: ", error);
      // Optionally, show a toast message to the user
    }
  };

  return (
    <SidebarProvider defaultOpen>
      <Sidebar className="border-r">
        <SidebarHeader className="p-4 flex items-center gap-3">
          <Image 
            src="/ciss-logo.png" 
            alt="CISS Logo"
            width={32}
            height={32}
            className="shrink-0"
            data-ai-hint="company logo"
            unoptimized={true}
          />
          {/* Removed SheetTitle from here as it's not within a Sheet/Dialog context */}
          <h1 className="text-xl font-semibold text-sidebar-primary truncate">CISS Workforce</h1>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {navItems.map((item) => (
              <NavMenuItem key={item.href} item={item} />
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="p-4">
           <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-2 p-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={authUser?.photoURL || undefined} alt={authUser?.displayName || authUser?.email || "User avatar"} data-ai-hint="user avatar" />
                  <AvatarFallback>
                    {isLoadingAuth ? 'L' : authUser?.email?.[0]?.toUpperCase() || 'A'}
                  </AvatarFallback>
                </Avatar>
                <div className="text-left truncate">
                  <p className="text-sm font-medium text-sidebar-foreground truncate">
                    {isLoadingAuth ? "Loading..." : authUser?.displayName || authUser?.email?.split('@')[0] || 'Admin User'}
                  </p>
                  <p className="text-xs text-sidebar-foreground/70 truncate">
                    {isLoadingAuth ? "..." : authUser?.email || 'admin@example.com'}
                  </p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <UserPlus className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}> 
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-background px-4 sm:h-16 sm:px-6">
          <SidebarTrigger className="md:hidden" />
          <div className="flex-1">
            {/* Breadcrumbs or page title can go here */}
          </div>
           <Button variant="outline" size="sm">
            Help
          </Button>
        </header>
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
