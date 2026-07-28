"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChartBar,
  CalendarCheck,
  Wallet,
  DotsThree,
  GraduationCap,
  Star,
  User,
  SignOut,
} from "@phosphor-icons/react";
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
  { href: "/guard/dashboard",  label: "Home",       icon: ChartBar },
  { href: "/guard/attendance", label: "Attendance", icon: CalendarCheck   },
  { href: "/guard/payslips",   label: "Pay",        icon: Wallet          },
];

const moreItems = [
  { href: "/guard/training",    label: "Training",    icon: GraduationCap },
  { href: "/guard/evaluations", label: "Evaluations", icon: Star          },
  { href: "/guard/profile",     label: "Profile",     icon: User          },
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
          className="flex h-16 items-stretch rounded-[22px] border border-border/80 bg-card/95 shadow-[0_10px_28px_hsl(207_52%_13%/0.14)] backdrop-blur-xl"
        >
          {navTabs.map((tab) => {
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 relative",
                  "select-none rounded-[18px] transition-colors duration-150 active:scale-[0.97]",
                  active ? "text-primary" : "text-muted-foreground/60"
                )}
                aria-current={active ? "page" : undefined}
              >
                <div className={cn(
                  "flex h-8 min-w-14 items-center justify-center rounded-full px-4 transition-colors",
                  active && "bg-primary/10"
                )}>
                  <tab.icon size={22} weight={active ? "fill" : "regular"} />
                </div>
                <span
                  className="text-[11px] leading-none tracking-wide"
                  style={{ fontWeight: active ? 900 : 700 }}
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
              "select-none rounded-[18px] transition-colors duration-150 active:scale-[0.97]",
              isMoreActive ? "text-primary" : "text-muted-foreground/60"
            )}
          >
            <div className={cn(
              "flex h-8 min-w-14 items-center justify-center rounded-full px-4 transition-colors",
              isMoreActive && "bg-primary/10"
            )}>
              <DotsThree size={22} weight={isMoreActive ? "fill" : "bold"} />
            </div>
            <span
              className="text-[11px] leading-none tracking-wide"
              style={{ fontWeight: isMoreActive ? 900 : 700 }}
            >
              More
            </span>
          </button>
        </nav>
      </div>

      {/* More Sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[75vh] rounded-t-[28px] border-x-0 border-b-0 p-0 shadow-[0_-8px_40px_hsl(207_52%_13%/0.14)]">
          <SheetTitle className="sr-only">More Options</SheetTitle>

          {/* Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-8 h-1 rounded-full bg-muted-foreground/25" />
          </div>

          <div className="px-4 pb-6">
            <p className="mb-3 mt-1 px-1 text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">
              More Options
            </p>

            <div className="space-y-0.5">
              {moreItems.map((item, i) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-muted/60 active:scale-[0.99]"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10"
                  >
                    <item.icon size={19} className="text-primary" weight="duotone" />
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {item.label}
                  </span>
                </Link>
              ))}

              <button
                onClick={() => { setMoreOpen(false); handleSignOut(); }}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-destructive/10 active:scale-[0.99]"
              >
                <span className="flex items-center justify-center h-10 w-10 rounded-lg bg-destructive/10 shrink-0">
                  <SignOut size={18} className="text-destructive" />
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
