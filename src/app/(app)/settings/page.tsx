"use client";

import React, { useEffect, useState } from "react";
import { useAppAuth } from "@/context/auth-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, BarChart3, Briefcase, ChevronRight, FileEdit, Globe, Loader2, ShieldCheck, Wallet, Wrench, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";

type SettingsCard = {
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  roles: ("admin" | "superAdmin")[];
  group: "app" | "region";
};

const settingsOptions: SettingsCard[] = [
  {
    title: "Clients & Sites",
    description: "Manage clients, office locations, and duty sites from one workspace.",
    icon: Briefcase,
    href: "/settings/clients",
    roles: ["admin", "superAdmin"],
    group: "app",
  },
  {
    title: "Enrollment Form",
    description: "Customize guard enrollment fields — toggle visibility, mark required, reorder.",
    icon: FileEdit,
    href: "/settings/enrollment-form",
    roles: ["admin", "superAdmin"],
    group: "app",
  },
  {
    title: "Admin Tools",
    description: "Access bulk imports, QR maintenance, and full data exports.",
    icon: Wrench,
    href: "/settings/admin-tools",
    roles: ["admin", "superAdmin"],
    group: "app",
  },
  {
    title: "Wage Configuration",
    description: "Define salary component structures per client with Excel parsing.",
    icon: Wallet,
    href: "/settings/wage-config",
    roles: ["admin", "superAdmin"],
    group: "app",
  },
  {
    title: "Attendance Reports",
    description: "Generate and download detailed attendance reports.",
    icon: BarChart3,
    href: "/settings/reports",
    roles: ["admin", "superAdmin"],
    group: "app",
  },
  {
    title: "State Management",
    description: "Onboard new states with separate Firebase projects and Vercel deployments. Super admin only.",
    icon: Globe,
    href: "/settings/state-management",
    roles: ["superAdmin"],
    group: "region",
  },
  {
    title: "Region Overview",
    description: "Consolidated cross-region health monitoring and metrics dashboard.",
    icon: ShieldCheck,
    href: "/dashboard",
    roles: ["superAdmin"],
    group: "region",
  },
];

export default function SettingsPage() {
  const { isSuperAdmin, userRole, stateCode } = useAppAuth();
  const [authStatus, setAuthStatus] = useState<"loading" | "admin" | "other">("loading");

  useEffect(() => {
    if (userRole === "admin" || userRole === "superAdmin") {
      setAuthStatus("admin");
    } else if (userRole === null) {
      setAuthStatus("loading");
    } else {
      setAuthStatus("other");
    }
  }, [userRole]);

  const visibleOptions = settingsOptions.filter(
    (opt) => isSuperAdmin || opt.roles.includes("admin"),
  );

  const appSettings = visibleOptions.filter((opt) => opt.group === "app");
  const regionSettings = visibleOptions.filter((opt) => opt.group === "region");

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
        description={
          isSuperAdmin
            ? "System-wide configurations, multi-state management, and regional oversight."
            : "Manage clients, enrollment form, wages, and reports for your state."
        }
      />

      {/* Role badge */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="outline" className="gap-1.5">
          {isSuperAdmin ? <ShieldCheck className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
          {isSuperAdmin ? "Super Admin — HQ Control Plane" : `Admin — ${stateCode || "Regional"}`}
        </Badge>
      </div>

      {/* App Settings group */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Application Settings
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {appSettings.map((option) => (
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

      {/* Region Settings group — super admin only */}
      {regionSettings.length > 0 && isSuperAdmin && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Multi-State Management
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
            {regionSettings.map((option) => (
              <Card key={option.title} className="flex flex-col border-amber-200/50">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <CardTitle className="text-base font-semibold sm:text-lg">{option.title}</CardTitle>
                        <Badge variant="outline" className="text-[10px] h-5 border-amber-300 text-amber-700 bg-amber-50">Super Admin</Badge>
                      </div>
                      <CardDescription className="mt-1">{option.description}</CardDescription>
                    </div>
                    <option.icon className="h-7 w-7 shrink-0 text-amber-500 sm:h-8 sm:w-8" />
                  </div>
                </CardHeader>
                <CardContent className="mt-auto">
                  <Button asChild variant="outline" className="w-full justify-between px-4 py-3 border-amber-300/50">
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
      )}
    </div>
  );
}
