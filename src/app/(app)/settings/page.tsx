
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUp, QrCode, BarChart3, ChevronRight, Briefcase } from "lucide-react"; // Added Briefcase for Client Management
import Link from "next/link";

const settingsOptions = [
  {
    title: "QR Code Management",
    description: "Manage and regenerate QR codes for employees.",
    icon: QrCode,
    href: "/settings/qr-management",
    aiHint: "qr admin"
  },
  {
    title: "Attendance Reports",
    description: "Generate and download detailed attendance reports.",
    icon: BarChart3,
    href: "/settings/reports",
    aiHint: "report generation"
  },
  {
    title: "Client Management",
    description: "Add, remove, or update client company names.",
    icon: Briefcase,
    href: "/settings/client-management",
    aiHint: "client companies"
  },
  {
    title: "Bulk Employee Import",
    description: "Upload a CSV file to add multiple employees at once.",
    icon: FileUp,
    href: "/settings/bulk-import",
    aiHint: "bulk upload employees"
  },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {settingsOptions.map((option) => (
          <Card key={option.title} className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-semibold">{option.title}</CardTitle>
              <option.icon className="h-6 w-6 text-primary" />
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">{option.description}</p>
            </CardContent>
            <CardContent> {/* Separated for consistent button placement */}
             <Button asChild variant="outline" className="w-full">
                <Link href={option.href} data-ai-hint={option.aiHint}>
                  Go to {option.title} <ChevronRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>Configure application-wide preferences and options.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Placeholder for general application settings like notification preferences, theme customization (if applicable), or API key management for integrations.
          </p>
          {/* Example of a general setting item */}
          <div className="mt-4 p-4 border rounded-md">
            <h3 className="font-medium">Notification Settings</h3>
            <p className="text-sm text-muted-foreground">Manage email and in-app notifications.</p>
            <Button variant="link" className="p-0 h-auto mt-1">Configure Notifications</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
