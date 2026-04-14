"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAppAuth } from "@/context/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Plus, GraduationCap, CheckCircle2, Eye, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FoTrainingReport, TrainingReportStatus } from "@/types/branch";
import { PhotoCapture } from "@/components/field-officers/photo-capture";

type Tab = "all" | "submitted" | "acknowledged";

const STATUS_CONFIG: Record<TrainingReportStatus, { label: string; className: string }> = {
  submitted:    { label: "Submitted",    className: "bg-amber-100 text-amber-700" },
  acknowledged: { label: "Acknowledged", className: "bg-green-100 text-green-700" },
};

const TABS: { key: Tab; label: string }[] = [
  { key: "all",          label: "All" },
  { key: "submitted",    label: "Submitted" },
  { key: "acknowledged", label: "Acknowledged" },
];

function formatDate(ts: { seconds: number } | string | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "string" ? new Date(ts) : new Date((ts as { seconds: number }).seconds * 1000);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

interface ClientOption { id: string; name: string; }

export function TrainingReportsPanel() {
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const isAdmin = userRole === "admin" || userRole === "superAdmin";
  const isFo = userRole === "fieldOfficer";

  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [reports, setReports] = useState<FoTrainingReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [form, setForm] = useState({
    clientId: "", clientName: "", siteId: "", trainingDate: "",
    durationMinutes: "60", topic: "", description: "", attendeeCount: "",
  });
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [detailReport, setDetailReport] = useState<FoTrainingReport | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  const loadReports = useCallback(async (tab: Tab) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (tab !== "all") params.set("status", tab);
      const res = await authorizedFetch(`/api/admin/training-reports?${params.toString()}`);
      const data = await res.json();
      setReports(data.reports ?? []);
    } catch {
      toast({ title: "Error", description: "Failed to load training reports", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadReports(activeTab); }, [activeTab, loadReports]);

  const loadClients = useCallback(async () => {
    try {
      const res = await authorizedFetch("/api/admin/clients");
      const data = await res.json();
      setClients((data.clients ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (newSheetOpen) loadClients();
  }, [newSheetOpen, loadClients]);

  const handleSubmit = async () => {
    if (!form.clientId || !form.trainingDate || !form.topic) {
      toast({ title: "Missing fields", description: "Client, training date, and topic are required.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await authorizedFetch("/api/admin/training-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: form.clientId,
          clientName: form.clientName,
          siteId: form.siteId,
          trainingDate: form.trainingDate,
          durationMinutes: parseInt(form.durationMinutes) || 60,
          topic: form.topic,
          description: form.description,
          attendeeCount: parseInt(form.attendeeCount) || 0,
          attendeeIds: [],
          status: "submitted",
          photoUrls,
        }),
      });
      if (!res.ok) throw new Error("Submit failed");
      toast({ title: "Report created", description: "Training report submitted." });
      setNewSheetOpen(false);
      setForm({ clientId: "", clientName: "", siteId: "", trainingDate: "", durationMinutes: "60", topic: "", description: "", attendeeCount: "" });
      setPhotoUrls([]);
      loadReports(activeTab);
    } catch {
      toast({ title: "Error", description: "Failed to save report", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAcknowledge = async (id: string) => {
    setAcknowledgingId(id);
    try {
      const res = await authorizedFetch(`/api/admin/training-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "acknowledged" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Acknowledged", description: "Training report acknowledged." });
      loadReports(activeTab);
    } catch {
      toast({ title: "Error", description: "Failed to acknowledge", variant: "destructive" });
    } finally {
      setAcknowledgingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {isFo && (
        <div className="flex justify-end">
          <Button onClick={() => setNewSheetOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New Training Report
          </Button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              activeTab === tab.key
                ? "border-brand-blue text-brand-blue"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <GraduationCap className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No training reports found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            const sc = STATUS_CONFIG[report.status];
            const isAcknowledging = acknowledgingId === report.id;
            return (
              <Card key={report.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", sc.className)}>
                          {sc.label}
                        </span>
                        <span className="font-semibold text-sm truncate">{report.fieldOfficerName}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">
                        {report.clientName}
                        {report.district ? ` · ${report.district}` : ""}
                      </p>
                      <p className="text-sm font-medium text-foreground mb-1">{report.topic}</p>
                      <p className="text-xs text-muted-foreground">
                        Date: {formatDate(report.trainingDate as unknown as { seconds: number })}
                        <span className="ml-3">Duration: {report.durationMinutes} min</span>
                        <span className="ml-3">Attendees: {report.attendeeCount}</span>
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setDetailReport(report); setDetailSheetOpen(true); }}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                      {isAdmin && report.status === "submitted" && (
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                          disabled={isAcknowledging}
                          onClick={() => handleAcknowledge(report.id)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          {isAcknowledging ? "..." : "Acknowledge"}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={detailSheetOpen} onOpenChange={setDetailSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Training Report</SheetTitle>
            <SheetDescription>
              {detailReport?.fieldOfficerName} · {formatDate(detailReport?.trainingDate as unknown as { seconds: number })}
            </SheetDescription>
          </SheetHeader>
          {detailReport && (
            <div className="space-y-4 mt-6">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Client</p>
                <p className="text-sm">{detailReport.clientName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Topic</p>
                <p className="text-sm font-semibold">{detailReport.topic}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Duration</p>
                  <p className="text-sm">{detailReport.durationMinutes} min</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Attendees</p>
                  <p className="text-sm">{detailReport.attendeeCount}</p>
                </div>
              </div>
              {detailReport.description && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm">{detailReport.description}</p>
                </div>
              )}
              {detailReport.photoUrls?.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
                    <ImageIcon className="inline h-3.5 w-3.5 mr-1" />Photos ({detailReport.photoUrls.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {detailReport.photoUrls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="h-20 w-20 rounded-md overflow-hidden border bg-muted shrink-0 block hover:opacity-80 transition-opacity">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {isAdmin && detailReport.status === "submitted" && (
                <Button
                  className="w-full bg-green-600 hover:bg-green-700"
                  disabled={acknowledgingId === detailReport.id}
                  onClick={async () => {
                    await handleAcknowledge(detailReport.id);
                    setDetailSheetOpen(false);
                  }}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  {acknowledgingId === detailReport.id ? "Saving..." : "Acknowledge"}
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* New Training Report Sheet */}
      <Sheet open={newSheetOpen} onOpenChange={setNewSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Training Report</SheetTitle>
            <SheetDescription>Log a training session with guards</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-1.5">
              <Label>Client *</Label>
              <Select
                value={form.clientId}
                onValueChange={(v) => {
                  const c = clients.find((x) => x.id === v);
                  setForm((f) => ({ ...f, clientId: v, clientName: c?.name ?? "" }));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Training Date *</Label>
              <Input
                type="date"
                value={form.trainingDate}
                onChange={(e) => setForm((f) => ({ ...f, trainingDate: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Topic *</Label>
              <Input
                value={form.topic}
                onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
                placeholder="e.g. Fire Safety Procedures"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Duration (minutes)</Label>
                <Input
                  type="number"
                  min="15"
                  value={form.durationMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Attendee Count</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.attendeeCount}
                  onChange={(e) => setForm((f) => ({ ...f, attendeeCount: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Training details..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Photos</Label>
              <PhotoCapture
                urls={photoUrls}
                onChange={setPhotoUrls}
                folder="trainingReports"
                disabled={isSubmitting}
              />
            </div>

            <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Submitting..." : "Submit Report"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
