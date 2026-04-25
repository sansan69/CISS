"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  CalendarCheck,
  CalendarDays,
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

interface NavTab {
  href: string;
  label: string;
  icon: React.ElementType;
}

const navTabs: NavTab[] = [
  { href: "/guard/dashboard",  label: "Home",       icon: LayoutDashboard },
  { href: "/guard/attendance", label: "Attendance", icon: CalendarCheck   },
  { href: "/guard/leave",      label: "Leave",      icon: CalendarDays    },
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

  const isActive = (href: string) => pathname.startsWith(href);
  const isMoreActive = moreOpen || moreItems.some(i => pathname.startsWith(i.href));

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      router.push("/guard-login");
    } catch {
      router.push("/guard-login");
    }
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
                  "transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                  "active:scale-[0.94] select-none rounded-xl",
                  active ? "text-[#014c85]" : "text-muted-foreground/60"
                )}
              >
                {/* Active dot beneath icon */}
                <div className="relative">
                  <tab.icon size={active ? 22 : 20} strokeWidth={active ? 2.2 : 1.8} />
                  {active && (
                    <span
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full"
                      style={{ backgroundColor: "#bd9c55" }}
                      aria-hidden
                    />
                  )}
                </div>
                <span
                  className="text-[10px] leading-none tracking-wide"
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
            className={cn(
              "flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 relative",
              "transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "active:scale-[0.94] select-none rounded-xl",
              isMoreActive ? "text-[#014c85]" : "text-muted-foreground/60"
            )}
          >
            <div className="relative">
              <MoreHorizontal size={isMoreActive ? 22 : 20} strokeWidth={isMoreActive ? 2.2 : 1.8} />
              {isMoreActive && (
                <span
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full"
                  style={{ backgroundColor: "#bd9c55" }}
                  aria-hidden
                />
              )}
            </div>
            <span
              className="text-[9px] leading-none tracking-wide"
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
            <p className="text-[11px] font-bold uppercase tracking-widest mb-3 mt-1 px-1"
               style={{ color: "#bd9c55" }}>
              More Options
            </p>

            <div className="space-y-0.5">
              {moreItems.map((item, i) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 px-3 py-3.5 rounded-lg transition-all duration-150 active:scale-[0.98] hover:bg-muted/60 animate-slide-up"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <span
                    className="flex items-center justify-center h-10 w-10 rounded-lg shrink-0"
                    style={{ backgroundColor: "hsl(206 98% 26% / 0.09)" }}
                  >
                    <item.icon size={18} style={{ color: "#014c85" }} />
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {item.label}
                  </span>
                </Link>
              ))}

              <button
                onClick={() => { setMoreOpen(false); handleSignOut(); }}
                className="w-full flex items-center gap-3 px-3 py-3.5 rounded-lg transition-all duration-150 active:scale-[0.98] hover:bg-red-50/80"
              >
                <span className="flex items-center justify-center h-10 w-10 rounded-lg bg-red-50 shrink-0">
                  <LogOut size={18} className="text-red-500" />
                </span>
                <span className="text-sm font-semibold text-red-600">
                  Sign Out
                </span>
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
