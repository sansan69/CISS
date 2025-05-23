
"use client";

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation'; // Added useRouter
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
  Briefcase,
  LogOut,
  QrCode,
  FileUp,
  BarChart3
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import React from 'react';

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
      { href: '/employees/enroll', label: 'Enroll New', icon: UserPlus },
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
  const router = useRouter(); // Initialize router

  const handleLogout = () => {
    router.push('/admin-login');
  };

  return (
    <SidebarProvider defaultOpen>
      <Sidebar className="border-r">
        <SidebarHeader className="p-4 flex items-center gap-2">
          <Briefcase className="w-8 h-8 text-primary" />
          <h1 className="text-xl font-semibold text-sidebar-primary">CISS Workforce</h1>
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
                  <AvatarImage src="https://placehold.co/40x40.png" alt="User" data-ai-hint="user avatar" />
                  <AvatarFallback>AD</AvatarFallback>
                </Avatar>
                <div className="text-left">
                  <p className="text-sm font-medium text-sidebar-foreground">Admin User</p>
                  <p className="text-xs text-sidebar-foreground/70">admin@ciss.com</p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <UserPlus className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}> {/* Added onClick handler */}
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
