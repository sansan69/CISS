"use client";

import type { ReactNode } from "react";
import React, { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { AuthContext } from "@/context/auth-context";
import { GuardHeader } from "@/components/guard/guard-header";
import { GuardBottomNav } from "@/components/guard/guard-bottom-nav";
import { GuardLiveTracking } from "@/components/guard/guard-live-tracking";
import { PageTransition } from "@/components/motion/page-transition";
import { usePathname } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────────
// Loading Screen
// ─────────────────────────────────────────────────────────────────────────────

function GuardLoadingScreen() {
  return (
    <div
      className="flex min-h-[100dvh] w-full flex-col items-center justify-center bg-background"
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-primary/10 ring-1 ring-primary/15"
        >
          <Image src="/ciss-logo.png" alt="CISS" width={40} height={40} unoptimized />
        </div>
        <p className="font-exo2 text-lg font-bold tracking-wide text-foreground">
          CISS Workforce
        </p>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Guard Portal
        </p>
        <div className="flex gap-1.5 mt-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
              style={{
                animationDelay: `${i * 160}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Guard Layout Component
// ─────────────────────────────────────────────────────────────────────────────

export default function GuardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [employeeId, setEmployeeId] = useState<string | undefined>(undefined);
  const [employeeDocId, setEmployeeDocId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [displayName, setDisplayName] = useState("Guard Portal");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setIsLoading(true);

      if (!user) {
        router.replace("/guard-login");
        setIsLoading(false);
        return;
      }

      try {
        const tokenResult = await user.getIdTokenResult();
        const claims = tokenResult.claims;

        if (claims.role !== "guard") {
          // Not a guard — redirect to guard login
          router.replace("/guard-login");
          setIsLoading(false);
          return;
        }

        setAuthUser(user);
        const empId =
          typeof claims.employeeId === "string" ? claims.employeeId : undefined;
        const empDocId =
          typeof claims.employeeDocId === "string"
            ? claims.employeeDocId
            : undefined;
        setEmployeeId(empId);
        setEmployeeDocId(empDocId);

        // Use displayName from Firebase Auth if set, else fall back to employeeId
        if (user.displayName) {
          setDisplayName(user.displayName);
        } else if (empId) {
          setDisplayName(empId);
        }
      } catch {
        router.replace("/guard-login");
      }

      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  const authContextValue = useMemo(
    () => ({
      user: authUser,
      userRole: "guard",
      assignedDistricts: [],
      clientInfo: null,
      stateCode: null,
      isSuperAdmin: false,
      employeeId,
      employeeDocId,
    }),
    [authUser, employeeId, employeeDocId]
  );

  if (isLoading || !authUser) {
    return <GuardLoadingScreen />;
  }

  return (
    <AuthContext.Provider value={authContextValue}>
      <div className="flex min-h-[100dvh] flex-col app-shell-surface">
        {/* Sticky header */}
        <GuardHeader employeeName={displayName} />
        <GuardLiveTracking />

        {/* Main content — padded for floating pill nav, max-width constrained for tablets */}
        <main className="flex-1 overflow-y-auto pb-[96px]">
          <div className="mx-auto w-full max-w-lg">
            <PageTransition routeKey={pathname}>{children}</PageTransition>
          </div>
        </main>

        {/* Fixed bottom navigation */}
        <GuardBottomNav />
      </div>
    </AuthContext.Provider>
  );
}
