"use client";

import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  DownloadCloud,
  FileUp,
  Megaphone,
  QrCode,
  Wrench,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const toolCards = [
  {
    title: "Bulk Employee Import",
    description: "Upload employee spreadsheets and process large enrollment batches from one file.",
    icon: FileUp,
    href: "/settings/bulk-import",
    bullets: [
      "Download templates before preparing employee spreadsheets.",
      "Use this when onboarding many new guards or client-site records together.",
    ],
  },
  {
    title: "QR Code Management",
    description: "Regenerate employee QR assets used across attendance and profile lookup flows.",
    icon: QrCode,
    href: "/settings/qr-management",
    bullets: [
      "Run bulk QR refreshes when badge assets need to be replaced.",
      "Use employee profiles for one-off QR checks after the bulk pass.",
    ],
  },
  {
    title: "Export All Data",
    description: "Generate XLSX or PDF exports for filtered employee records and profile kits.",
    icon: DownloadCloud,
    href: "/settings/data-export",
    bullets: [
      "Filter exports by client, district, and joining date range.",
      "Use PDF exports for client-ready profile kits and XLSX for raw analysis.",
    ],
  },
  {
    title: "Broadcast Notifications",
    description: "Send push notifications to guards and field officers. Messages appear in the mobile app inbox.",
    icon: Megaphone,
    href: "/admin/notifications",
    bullets: [
      "Target all users, guards only, or field officers only.",
      "Optionally filter by district for location-specific announcements.",
    ],
  },
] as const;

export default function AdminToolsPage() {
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Admin Tools"
        description="Keep bulk operational utilities together so imports, QR maintenance, and exports are easy to find from one workspace."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Settings", href: "/settings" },
          { label: "Admin Tools" },
        ]}
        actions={
          <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
            <Link href="/settings">
              <ChevronLeft className="mr-2 h-4 w-4" />
              <span>Back to Settings</span>
            </Link>
          </Button>
        }
      />

      <Alert>
        <Wrench className="h-4 w-4" />
        <AlertTitle>Operational Utility Hub</AlertTitle>
        <AlertDescription>
          These tools are grouped here because admins use them occasionally but usually in the same maintenance window.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {toolCards.map((tool) => (
          <Card key={tool.title} className="flex h-full flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base font-semibold sm:text-lg">
                    {tool.title}
                  </CardTitle>
                  <CardDescription>{tool.description}</CardDescription>
                </div>
                <tool.icon className="h-7 w-7 shrink-0 text-muted-foreground sm:h-8 sm:w-8" />
              </div>
            </CardHeader>
            <CardContent className="mt-auto flex flex-1 flex-col gap-4">
              <div className="space-y-2 text-sm text-muted-foreground">
                {tool.bullets.map((bullet) => (
                  <p key={bullet}>{bullet}</p>
                ))}
              </div>
              <Button asChild variant="outline" className="mt-auto w-full justify-between px-4 py-3">
                <Link href={tool.href}>
                  <span className="text-left">Open {tool.title}</span>
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
