"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  CalendarCheck,
  Wallet,
  MoreHorizontal,
  GraduationCap,
  Star,
  User,
  KeyRound,
  LogOut,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { cn } from "@/lib/utils";
import { LogoutDialog } from "@/components/common/logout-dialog";

interface NavTab {
  href: string;
  label: string;
  icon: React.ElementType;
}

const navTabs: NavTab[] = [
  { href: "/guard/dashboard",  label: "Home",       icon: LayoutDashboard },
  { href: "/guard/attendance", label: "Attendance", icon: CalendarCheck   },
  { href: "/guard/payslips",   label: "Pay",        icon: Wallet          },
];

const moreItems = [
  { href: "/guard/training",    label: "Training",    icon: GraduationCap },
  { href: "/guard/evaluations", label: "Evaluations", icon: Star          },
  { href: "/guard/profile",     label: "Profile",     icon: User          },
  { href: "/guard-login/reset", label: "Change PIN",  icon: KeyRound      },
];

export function GuardBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const isActive = (href: string) => pathname.startsWith(href);
  const isMoreActive = moreOpen || moreItems.some(i => pathname.startsWith(i.href));

  const handleSignOut = () => {
    setMoreOpen(false);
    setShowLogoutConfirm(true);
  };

  return (
    <>
      {/* Floating pill bottom nav */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 px-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
      >
        <nav
          aria-label="Guard navigation"
          className="flex items-stretch bg-card/97 backdrop-blur-xl rounded-xl border border-border/70 shadow-[0_10px_28px_hsl(214_40%_18%/0.14),0_2px_8px_hsl(214_30%_18%/0.08)]"
          style={{ height: 60 }}
        >
          {navTabs.map((tab) => {
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 relative",
                  "transition-all duration-150 ease-out",
                  "active:brightness-[0.92] select-none rounded-xl",
                  active ? "text-primary" : "text-muted-foreground/60"
                )}
              >
                {/* Active dot beneath icon */}
                <div className="relative">
                  <tab.icon size={active ? 22 : 20} strokeWidth={active ? 2.2 : 1.8} />
                  {active && (
                    <span
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-accent"
                      aria-hidden
                    />
                  )}
                </div>
                <span
                  className="text-[11px] leading-none tracking-wide"
                  style={{ fontWeight: active ? 700 : 500 }}
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}

          {/* Divider */}
          <div className="my-3 w-px bg-border/60 shrink-0" aria-hidden />

          {/* More button */}
          <button
            onClick={() => setMoreOpen(true)}
            aria-label="More options"
            className={cn(
              "flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 relative",
              "transition-all duration-150 ease-out",
              "active:brightness-[0.92] select-none rounded-xl",
              isMoreActive ? "text-primary" : "text-muted-foreground/60"
            )}
          >
            <div className="relative">
              <MoreHorizontal size={isMoreActive ? 22 : 20} strokeWidth={isMoreActive ? 2.2 : 1.8} />
              {isMoreActive && (
                <span
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-accent"
                  aria-hidden
                />
              )}
            </div>
            <span
              className="text-[11px] leading-none tracking-wide"
              style={{ fontWeight: isMoreActive ? 700 : 500 }}
            >
              More
            </span>
          </button>
        </nav>
      </div>

      {/* More Sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl p-0 max-h-[75vh] border-0 shadow-[0_-8px_40px_hsl(214_40%_18%/0.16)]">
          <SheetTitle className="sr-only">More Options</SheetTitle>

          {/* Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-8 h-1 rounded-full bg-muted-foreground/25" />
          </div>

          <div className="px-4 pb-6">
            <p className="text-[11px] font-bold uppercase tracking-widest mb-3 mt-1 px-1 text-accent">
              More Options
            </p>

            <div className="space-y-0.5">
              {moreItems.map((item, i) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 px-3 py-3.5 rounded-lg transition-all duration-150 active:brightness-[0.92] hover:bg-muted/60 animate-slide-up"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <span
                    className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 shrink-0"
                  >
                    <item.icon size={18} className="text-primary" />
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {item.label}
                  </span>
                </Link>
              ))}

              <button
                onClick={() => { setMoreOpen(false); handleSignOut(); }}
                className="w-full flex items-center gap-3 px-3 py-3.5 rounded-lg transition-all duration-150 active:brightness-[0.92] hover:bg-destructive/15"
              >
                <span className="flex items-center justify-center h-10 w-10 rounded-lg bg-destructive/10 shrink-0">
                  <LogOut size={18} className="text-destructive" />
                </span>
                <span className="text-sm font-semibold text-destructive">
                  Sign Out
                </span>
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <LogoutDialog
        open={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
        redirectTo="/guard-login"
      />
    </>
  );
}
