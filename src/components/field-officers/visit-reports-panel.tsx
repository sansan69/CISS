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
import { Plus, FileText, CheckCircle2, Clock, Eye, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FoVisitReport, VisitReportStatus } from "@/types/branch";
import { PhotoCapture } from "@/components/field-officers/photo-capture";

type Tab = "all" | "draft" | "submitted" | "reviewed";

const STATUS_CONFIG: Record<VisitReportStatus, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-gray-100 text-gray-600" },
  submitted: { label: "Submitted", className: "bg-amber-100 text-amber-700" },
  reviewed:  { label: "Reviewed",  className: "bg-green-100 text-green-700" },
};

const TABS: { key: Tab; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "draft",     label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "reviewed",  label: "Reviewed" },
];

function formatDate(ts: { seconds: number } | string | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "string" ? new Date(ts) : new Date((ts as { seconds: number }).seconds * 1000);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

interface ClientOption { id: string; name: string; }

export function VisitReportsPanel() {
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const isAdmin = userRole === "admin" || userRole === "superAdmin";
  const isFo = userRole === "fieldOfficer";

  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [reports, setReports] = useState<FoVisitReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [districtFilter, setDistrictFilter] = useState("");

  // New report sheet
  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [form, setForm] = useState({
    clientId: "", clientName: "", siteName: "", visitDate: "",
    guardsPresentCount: "", guardsAbsentCount: "", summary: "",
    issuesFound: "", actionsRequired: "", status: "draft" as VisitReportStatus,
  });
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  // Review sheet
  const [reviewSheetOpen, setReviewSheetOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<FoVisitReport | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [isReviewing, setIsReviewing] = useState(false);

  const loadReports = useCallback(async (tab: Tab) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (tab !== "all") params.set("status", tab);
      if (districtFilter) params.set("district", districtFilter);
      const res = await authorizedFetch(`/api/admin/visit-reports?${params.toString()}`);
      const data = await res.json();
      setReports(data.reports ?? []);
    } catch {
      toast({ title: "Error", description: "Failed to load visit reports", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast, districtFilter]);

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
    if (!form.clientId || !form.visitDate || !form.summary) {
      toast({ title: "Missing fields", description: "Client, visit date, and summary are required.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await authorizedFetch("/api/admin/visit-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: form.clientId,
          clientName: form.clientName,
          siteName: form.siteName,
          visitDate: form.visitDate,
          guardsPresentCount: parseInt(form.guardsPresentCount) || 0,
          guardsAbsentCount: parseInt(form.guardsAbsentCount) || 0,
          summary: form.summary,
          issuesFound: form.issuesFound,
          actionsRequired: form.actionsRequired,
          status: form.status,
          photoUrls,
        }),
      });
      if (!res.ok) throw new Error("Submit failed");
      toast({ title: "Report created", description: "Visit report saved." });
      setNewSheetOpen(false);
      setForm({ clientId: "", clientName: "", siteName: "", visitDate: "", guardsPresentCount: "", guardsAbsentCount: "", summary: "", issuesFound: "", actionsRequired: "", status: "draft" });
      setPhotoUrls([]);
      loadReports(activeTab);
    } catch {
      toast({ title: "Error", description: "Failed to save report", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkReviewed = async () => {
    if (!selectedReport) return;
    setIsReviewing(true);
    try {
      const res = await authorizedFetch(`/api/admin/visit-reports/${selectedReport.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "reviewed", reviewNotes }),
      });
      if (!res.ok) throw new Error("Review failed");
      toast({ title: "Reviewed", description: "Report marked as reviewed." });
      setReviewSheetOpen(false);
      setSelectedReport(null);
      setReviewNotes("");
      loadReports(activeTab);
    } catch {
      toast({ title: "Error", description: "Failed to update report", variant: "destructive" });
    } finally {
      setIsReviewing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {isFo && (
        <div className="flex justify-end">
          <Button onClick={() => setNewSheetOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New Report
          </Button>
        </div>
      )}

      {isAdmin && (
        <div className="flex gap-3 items-end">
          <div className="w-48 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Filter by District</Label>
            <Input
              placeholder="e.g. Ernakulam"
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => loadReports(activeTab)}>Apply</Button>
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
            <FileText className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No visit reports found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            const sc = STATUS_CONFIG[report.status];
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
                        {report.siteName ? ` · ${report.siteName}` : ""}
                        {report.district ? ` · ${report.district}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground mb-1">
                        Visit: {formatDate(report.visitDate as unknown as { seconds: number })}
                        <span className="ml-3">
                          Present: <strong>{report.guardsPresentCount}</strong> · Absent: <strong>{report.guardsAbsentCount}</strong>
                        </span>
                      </p>
                      {report.summary && (
                        <p className="text-sm text-foreground/80 line-clamp-2 mt-1">{report.summary}</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {isAdmin && report.status === "submitted" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setSelectedReport(report); setReviewNotes(""); setReviewSheetOpen(true); }}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          Review
                        </Button>
                      )}
                      {isAdmin && report.status === "reviewed" && (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Reviewed
                        </span>
                      )}
                      {isAdmin && report.status === "draft" && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" /> Draft
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Report Sheet (FO) */}
      <Sheet open={newSheetOpen} onOpenChange={setNewSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Visit Report</SheetTitle>
            <SheetDescription>Log a field officer site visit</SheetDescription>
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
              <Label>Site Name</Label>
              <Input
                value={form.siteName}
                onChange={(e) => setForm((f) => ({ ...f, siteName: e.target.value }))}
                placeholder="Site / location name"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Visit Date *</Label>
              <Input
                type="date"
                value={form.visitDate}
                onChange={(e) => setForm((f) => ({ ...f, visitDate: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Guards Present</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.guardsPresentCount}
                  onChange={(e) => setForm((f) => ({ ...f, guardsPresentCount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Guards Absent</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.guardsAbsentCount}
                  onChange={(e) => setForm((f) => ({ ...f, guardsAbsentCount: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Summary *</Label>
              <Textarea
                rows={3}
                value={form.summary}
                onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                placeholder="Brief summary of the visit..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Issues Found</Label>
              <Textarea
                rows={2}
                value={form.issuesFound}
                onChange={(e) => setForm((f) => ({ ...f, issuesFound: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Actions Required</Label>
              <Textarea
                rows={2}
                value={form.actionsRequired}
                onChange={(e) => setForm((f) => ({ ...f, actionsRequired: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Photos</Label>
              <PhotoCapture
                urls={photoUrls}
                onChange={setPhotoUrls}
                folder="visitReports"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as VisitReportStatus }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Save as Draft</SelectItem>
                  <SelectItem value="submitted">Submit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Saving..." : "Save Report"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Review Sheet (Admin) */}
      <Sheet open={reviewSheetOpen} onOpenChange={setReviewSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Review Visit Report</SheetTitle>
            <SheetDescription>
              {selectedReport?.fieldOfficerName} · {formatDate(selectedReport?.visitDate as unknown as { seconds: number })}
            </SheetDescription>
          </SheetHeader>
          {selectedReport && (
            <div className="space-y-4 mt-6">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Client / Site</p>
                <p className="text-sm">{selectedReport.clientName}{selectedReport.siteName ? ` — ${selectedReport.siteName}` : ""}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Guards Present</p>
                  <p className="text-sm font-semibold">{selectedReport.guardsPresentCount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Guards Absent</p>
                  <p className="text-sm font-semibold">{selectedReport.guardsAbsentCount}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Summary</p>
                <p className="text-sm">{selectedReport.summary}</p>
              </div>
              {selectedReport.issuesFound && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Issues Found</p>
                  <p className="text-sm">{selectedReport.issuesFound}</p>
                </div>
              )}
              {selectedReport.actionsRequired && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Actions Required</p>
                  <p className="text-sm">{selectedReport.actionsRequired}</p>
                </div>
              )}
              {selectedReport.photoUrls?.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
                    <ImageIcon className="inline h-3.5 w-3.5 mr-1" />Photos ({selectedReport.photoUrls.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedReport.photoUrls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="h-20 w-20 rounded-md overflow-hidden border bg-muted shrink-0 block hover:opacity-80 transition-opacity">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Review Notes</Label>
                <Textarea
                  rows={3}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Add review comments..."
                />
              </div>
              <Button onClick={handleMarkReviewed} disabled={isReviewing} className="w-full">
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                {isReviewing ? "Saving..." : "Mark as Reviewed"}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
