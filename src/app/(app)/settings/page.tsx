
"use client";

import React, { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { resolveAppUser } from "@/lib/auth/roles";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUp, QrCode, BarChart3, ChevronRight, Briefcase, DownloadCloud, Landmark, MapPinned, Users, ShieldCheck, Wallet, GraduationCap, Building2 } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";

const settingsOptions = [
  {
    title: "Client Management",
    description: "Add, remove, or update client company names for enrollment.",
    icon: Briefcase,
    href: "/settings/client-management",
  },
  {
    title: "Client Locations",
    description: "Manage branch, office, and center coordinates for each client.",
    icon: MapPinned,
    href: "/settings/client-locations",
  },
   {
    title: "Duty Sites",
    description: "Bulk upload and manage operational attendance/work-order sites.",
    icon: Landmark,
    href: "/settings/site-management",
  },
  {
    title: "Bulk Employee Import",
    description: "Upload a CSV file to add multiple new employees at once.",
    icon: FileUp,
    href: "/settings/bulk-import",
  },
  {
    title: "QR Code Management",
    description: "Manage and regenerate QR codes for employees in bulk.",
    icon: QrCode,
    href: "/settings/qr-management",
  },
  {
    title: "Attendance Reports",
    description: "Generate and download detailed attendance reports for analysis.",
    icon: BarChart3,
    href: "/settings/reports",
  },
  {
    title: "Export All Data",
    description: "Download all employee data and documents from the database.",
    icon: DownloadCloud,
    href: "/settings/data-export",
  },
  {
    title: "Assigned Guards Export",
    description: "Download assigned guard details to Excel with filters.",
    icon: Users,
    href: "/settings/assigned-guards-export",
  },
  {
    title: "Compliance Settings",
    description: "Manage EPF, ESIC, PT, TDS, Bonus & Gratuity statutory rates.",
    icon: ShieldCheck,
    href: "/settings/compliance-settings",
  },
  {
    title: "Wage Configuration",
    description: "Define salary component structures per client with AI-assisted Excel parsing.",
    icon: Wallet,
    href: "/settings/wage-config",
  },
  {
    title: "Salary Grades",
    description: "Create and manage reusable salary grade templates per client.",
    icon: GraduationCap,
    href: "/settings/salary-grades",
  },
  {
    title: "Branches",
    description: "Manage field branches, visit reports, training sessions, and expenses.",
    icon: Building2,
    href: "/branch-ops",
  },
];

export default function SettingsPage() {
  const [authStatus, setAuthStatus] = useState<"loading" | "admin" | "other">("loading");

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (!user) { setAuthStatus("other"); return; }
      resolveAppUser(user)
        .then((appUser) => setAuthStatus(appUser.role === "admin" ? "admin" : "other"))
        .catch(() => setAuthStatus("other"));
    });
  }, []);

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
        {settingsOptions.map((option) => (
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

    
