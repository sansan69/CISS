
"use client";

import React, { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { resolveAppUser } from "@/lib/auth/roles";
import { useAppAuth } from "@/context/auth-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, ChevronRight, Briefcase, Wallet, Globe, Wrench } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";

const settingsOptions = [
  {
    title: "Clients & Sites",
    description: "Manage clients, office locations, and duty sites from one workspace.",
    icon: Briefcase,
    href: "/settings/clients",
  },
  {
    title: "Admin Tools",
    description: "Access bulk imports, QR maintenance, and full data exports from one utility hub.",
    icon: Wrench,
    href: "/settings/admin-tools",
  },
  {
    title: "Wage Configuration",
    description: "Define salary component structures per client with AI-assisted Excel parsing.",
    icon: Wallet,
    href: "/settings/wage-config",
  },
  {
    title: "Attendance Reports",
    description: "Generate and download detailed attendance reports for analysis.",
    icon: BarChart3,
    href: "/settings/reports",
  },
];

export default function SettingsPage() {
  const { isSuperAdmin } = useAppAuth();
  const [authStatus, setAuthStatus] = useState<"loading" | "admin" | "other">("loading");

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (!user) { setAuthStatus("other"); return; }
      resolveAppUser(user)
        .then((appUser) => setAuthStatus(appUser.role === "admin" || appUser.role === "superAdmin" ? "admin" : "other"))
        .catch(() => setAuthStatus("other"));
    });
  }, []);

  const visibleOptions = isSuperAdmin
    ? [
        ...settingsOptions,
        {
          title: "Region Onboarding",
          description: "Connect and prepare separate Firebase backends for new regions without touching Kerala data.",
          icon: Globe,
          href: "/settings/state-management",
        },
      ]
    : settingsOptions;

  if (authStatus === "loading") {
    return <div className="flex justify-center items-center h-40"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (authStatus !== "admin") {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Permission Denied</AlertTitle>
        <AlertDescription>You do not have permission to access Settings.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Manage system-wide configurations, exports, client data, and location masters from one place."
      />
      
      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
        {visibleOptions.map((option) => (
          <Card key={option.title} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                    <CardTitle className="text-base font-semibold sm:text-lg">{option.title}</CardTitle>
                    <CardDescription className="mt-1">{option.description}</CardDescription>
                </div>
                 <option.icon className="h-7 w-7 shrink-0 text-muted-foreground sm:h-8 sm:w-8" />
              </div>
            </CardHeader>
            <CardContent className="mt-auto">
             <Button asChild variant="outline" className="w-full justify-between px-4 py-3">
                <Link href={option.href}>
                  <span className="text-left">Open {option.title}</span>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

    
