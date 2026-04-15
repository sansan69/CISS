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

const BRAND_BLUE = "hsl(206 98% 26%)";
const BRAND_GOLD = "hsl(41 44% 54%)";

interface NavTab {
  href: string;
  label: string;
  icon: React.ElementType;
}

const navTabs: NavTab[] = [
  { href: "/guard/dashboard",  label: "Home",       icon: LayoutDashboard },
  { href: "/guard/attendance", label: "Attendance", icon: CalendarCheck   },
  { href: "/guard/leave",      label: "Leave",      icon: CalendarDays    },
  { href: "/guard/payslips",   label: "Payslips",   icon: Wallet          },
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
    } catch (err) {
      console.error("Sign out error:", err);
      router.push("/guard-login");
    }
  };

  return (
    <>
      {/* Bottom Nav Bar */}
      <nav
        aria-label="Guard navigation"
        className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200"
        style={{
          height: 64,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="flex h-full items-stretch">
          {navTabs.map((tab) => {
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 relative transition-colors duration-150"
                )}
                style={{ color: active ? BRAND_BLUE : "#9ca3af" }}
              >
                {/* Top indicator */}
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 h-[2.5px] rounded-b-full transition-all duration-200"
                  style={{
                    width: active ? 24 : 0,
                    backgroundColor: active ? BRAND_GOLD : "transparent",
                  }}
                  aria-hidden
                />
                <tab.icon size={22} />
                <span
                  className="text-[10px] leading-none"
                  style={{ fontWeight: active ? 600 : 500 }}
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 relative transition-colors duration-150"
            style={{ color: isMoreActive ? BRAND_BLUE : "#9ca3af" }}
          >
            <span
              className="absolute top-0 left-1/2 -translate-x-1/2 h-[2.5px] rounded-b-full transition-all duration-200"
              style={{
                width: isMoreActive ? 24 : 0,
                backgroundColor: isMoreActive ? BRAND_GOLD : "transparent",
              }}
              aria-hidden
            />
            <MoreHorizontal size={22} />
            <span
              className="text-[10px] leading-none"
              style={{ fontWeight: isMoreActive ? 600 : 500 }}
            >
              More
            </span>
          </button>
        </div>
      </nav>

      {/* More Sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl p-0 max-h-[70vh]">
          <SheetTitle className="sr-only">More Options</SheetTitle>

          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-gray-300" />
          </div>

          <div className="px-4 pb-4">
            <p
              className="text-xs font-semibold uppercase tracking-wider mb-3 mt-2"
              style={{ color: BRAND_GOLD }}
            >
              More Options
            </p>

            <div className="space-y-1">
              {moreItems.map((item) => (
                <Link
                  key={`${item.href}-${item.label}`}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  <span
                    className="flex items-center justify-center h-9 w-9 rounded-xl"
                    style={{ backgroundColor: "hsl(206 98% 26% / 0.08)" }}
                  >
                    <item.icon size={18} style={{ color: BRAND_BLUE }} />
                  </span>
                  <span className="text-sm font-medium text-gray-800">
                    {item.label}
                  </span>
                </Link>
              ))}

              <button
                onClick={() => { setMoreOpen(false); handleSignOut(); }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-red-50 transition-colors"
              >
                <span className="flex items-center justify-center h-9 w-9 rounded-xl bg-red-50">
                  <LogOut size={18} className="text-red-500" />
                </span>
                <span className="text-sm font-medium text-red-600">
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
