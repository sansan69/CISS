"use client";

import type { ReactNode } from "react";
import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { AuthContext } from "@/context/auth-context";
import { GuardHeader } from "@/components/guard/guard-header";
import { GuardBottomNav } from "@/components/guard/guard-bottom-nav";

// ─────────────────────────────────────────────────────────────────────────────
// Loading Screen
// ─────────────────────────────────────────────────────────────────────────────

function GuardLoadingScreen() {
  return (
    <div
      className="flex h-screen w-full flex-col items-center justify-center"
      style={{ backgroundColor: "#014c85" }}
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ciss-logo.png" alt="CISS" width={40} height={40} />
        </div>
        <p className="text-white font-bold text-lg tracking-wide">
          CISS Workforce
        </p>
        <p className="text-white/50 text-xs uppercase tracking-widest font-medium">
          Guard Portal
        </p>
        <div className="flex gap-1.5 mt-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full animate-bounce"
              style={{
                backgroundColor: "#bd9c55",
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
      <div className="flex flex-col h-screen bg-gray-50">
        {/* Sticky header */}
        <GuardHeader employeeName={displayName} />

        {/* Main content — padded for bottom nav */}
        <main className="flex-1 overflow-y-auto pb-20">{children}</main>

        {/* Fixed bottom navigation */}
        <GuardBottomNav />
      </div>
    </AuthContext.Provider>
  );
}
