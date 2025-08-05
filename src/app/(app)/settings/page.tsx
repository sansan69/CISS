
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUp, QrCode, BarChart3, ChevronRight, Briefcase, DownloadCloud } from "lucide-react";
import Link from "next/link";

const settingsOptions = [
  {
    title: "Client Management",
    description: "Add, remove, or update client company names for enrollment.",
    icon: Briefcase,
    href: "/settings/client-management",
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
];

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage system-wide configurations and data.</p>
      </div>
      
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        {settingsOptions.map((option) => (
          <Card key={option.title} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                    <CardTitle className="text-lg font-semibold">{option.title}</CardTitle>
                    <CardDescription className="mt-1">{option.description}</CardDescription>
                </div>
                 <option.icon className="h-8 w-8 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent className="mt-auto">
             <Button asChild variant="outline" className="w-full justify-between">
                <Link href={option.href}>
                  <span>Go to {option.title}</span>
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
