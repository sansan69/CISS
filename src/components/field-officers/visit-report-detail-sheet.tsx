"use client";

import React, { useState } from "react";
import { useAppAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PhotoCapture } from "@/components/field-officers/photo-capture";
import { CheckCircle as CheckCircle2, PencilSimple as Edit3, Eye, FileText, ImageIcon, MapPin, Calendar, Clock, User, Buildings as Building2, Shield, Warning as AlertTriangle, ListChecks } from "@phosphor-icons/react";
import type { FoVisitReport, VisitReportStatus } from "@/types/branch";

const STATUS_CONFIG: Record<VisitReportStatus, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-gray-100 text-gray-600" },
  submitted: { label: "Submitted", className: "bg-amber-100 text-amber-700" },
  reviewed:  { label: "Reviewed",  className: "bg-green-100 text-green-700" },
  superseded:{ label: "Superseded",className: "bg-slate-100 text-slate-600" },
  archived:  { label: "Archived",  className: "bg-slate-100 text-slate-600" },
};

function fmt(ts: { seconds: number } | string | null | undefined): string {
  if (!ts) return "—";
  const seconds = typeof ts === "object" ? (ts as { seconds?: number; _seconds?: number }).seconds ?? (ts as { _seconds?: number })._seconds : undefined;
  const d = typeof ts === "string" ? new Date(ts) : new Date((seconds ?? 0) * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateTime(ts: { seconds: number } | string | null | undefined): string {
  if (!ts) return "—";
  const seconds = typeof ts === "object" ? (ts as { seconds?: number; _seconds?: number }).seconds ?? (ts as { _seconds?: number })._seconds : undefined;
  const d = typeof ts === "string" ? new Date(ts) : new Date((seconds ?? 0) * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function isPdfUrl(url: string) {
  return decodeURIComponent(url).toLowerCase().includes(".pdf");
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: FoVisitReport | null;
  onUpdated: () => void;
}

export function VisitReportDetailSheet({ open, onOpenChange, report, onUpdated }: Props) {
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const isAdmin = userRole === "admin" || userRole === "superAdmin";
  const isClient = userRole === "client";
  const isOwner = report?.fieldOfficerId && userRole === "fieldOfficer";
  const canEdit = report?.status === "draft" && (isAdmin || isOwner);
  const canReview = isAdmin && report?.status === "submitted" && report.reviewStatus !== "reviewed";
  const canCreateRevision = Boolean(isOwner && report?.reviewStatus === "revision_requested" && report.status === "submitted");
  const canClientAcknowledge = Boolean(isClient && report?.status === "submitted" && report.clientStatus !== "acknowledged");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const [editSummary, setEditSummary] = useState("");
  const [editIssues, setEditIssues] = useState("");
  const [editActions, setEditActions] = useState("");
  const [editPresent, setEditPresent] = useState("0");
  const [editAbsent, setEditAbsent] = useState("0");
  const [editPhotoUrls, setEditPhotoUrls] = useState<string[]>([]);
  const [reviewNotes, setReviewNotes] = useState("");

  const startEditing = () => {
    if (!report) return;
    setEditSummary(report.summary ?? "");
    setEditIssues(report.issuesFound ?? "");
    setEditActions(report.actionsRequired ?? "");
    setEditPresent(String(report.guardsPresentCount ?? 0));
    setEditAbsent(String(report.guardsAbsentCount ?? 0));
    setEditPhotoUrls([...(report.photoUrls ?? [])]);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!report) return;
    setSaving(true);
    try {
      const res = await authorizedFetch(`/api/admin/visit-reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: editSummary,
          issuesFound: editIssues,
          actionsRequired: editActions,
          guardsPresentCount: parseInt(editPresent) || 0,
          guardsAbsentCount: parseInt(editAbsent) || 0,
          photoUrls: editPhotoUrls,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(data?.error || "Save failed");
      }
      toast({ title: "Updated", description: "Visit report saved." });
      setEditing(false);
      onUpdated();
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!report) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { status: "submitted" };
      if (editing) {
        body.summary = editSummary;
        body.issuesFound = editIssues;
        body.actionsRequired = editActions;
        body.guardsPresentCount = parseInt(editPresent) || 0;
        body.guardsAbsentCount = parseInt(editAbsent) || 0;
        body.photoUrls = editPhotoUrls;
      }
      const res = await authorizedFetch(`/api/admin/visit-reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Submit failed");
      toast({ title: "Submitted", description: "Visit report submitted for review." });
      setEditing(false);
      onUpdated();
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Submit failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleReview = async () => {
    if (!report) return;
    setReviewing(true);
    try {
      const res = await authorizedFetch(`/api/admin/visit-reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "reviewed", reviewNotes }),
      });
      if (!res.ok) throw new Error("Review failed");
      toast({ title: "Reviewed", description: "Report marked as reviewed." });
      onUpdated();
      onOpenChange(false);
    } catch {
      toast({ title: "Error", description: "Failed to update report", variant: "destructive" });
    } finally {
      setReviewing(false);
    }
  };

  const handleRequestRevision = async () => {
    if (!report) return;
    if (!reviewNotes.trim()) {
      toast({ title: "Reason required", description: "Explain what must be corrected.", variant: "destructive" });
      return;
    }
    setReviewing(true);
    try {
      const res = await authorizedFetch(`/api/admin/visit-reports/${report.id}`, {
        method: "PATCH",
        body: JSON.stringify({ reviewStatus: "revision_requested", reviewNotes }),
      });
      if (!res.ok) throw new Error("Failed to request revision");
      toast({ title: "Revision requested", description: "The original submission remains unchanged." });
      onUpdated();
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to request revision", variant: "destructive" });
    } finally {
      setReviewing(false);
    }
  };

  const handleCreateRevision = async () => {
    if (!report) return;
    setSaving(true);
    try {
      const res = await authorizedFetch(`/api/admin/visit-reports/${report.id}/revisions`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to create revision");
      toast({ title: "Revision draft created", description: "Edit the new private draft and submit when ready." });
      onUpdated();
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to create revision", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleClientAcknowledge = async () => {
    if (!report) return;
    setReviewing(true);
    try {
      const res = await authorizedFetch(`/api/admin/visit-reports/${report.id}`, {
        method: "PATCH",
        body: JSON.stringify({ clientStatus: "acknowledged" }),
      });
      if (!res.ok) throw new Error("Failed to acknowledge report");
      toast({ title: "Report acknowledged" });
      onUpdated();
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to acknowledge report", variant: "destructive" });
    } finally {
      setReviewing(false);
    }
  };

  if (!report) return null;

  const sc = STATUS_CONFIG[report.status] ?? STATUS_CONFIG.submitted;

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setEditing(false); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {/* Header */}
        <SheetHeader className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", sc.className)}>
              {sc.label}
            </span>
            {report.district && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />{report.district}
              </span>
            )}
          </div>
          <SheetTitle className="text-lg">Visit Report</SheetTitle>
          <SheetDescription className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1"><User className="h-3 w-3" />{report.fieldOfficerName}</span>
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{fmt(report.visitDate as unknown as { seconds: number })}</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Created {fmtDateTime(report.createdAt as unknown as { seconds: number })}</span>
          </SheetDescription>
        </SheetHeader>

        {/* Content */}
        <div className="space-y-5">
          {/* Client / Site */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
              <Building2 className="h-3.5 w-3.5" />Client & Site
            </div>
            <p className="text-sm font-semibold">{report.clientName}</p>
            {report.siteName && <p className="text-sm text-muted-foreground">{report.siteName}</p>}
          </div>

          {(report.visitStartedAt || report.visitEndedAt || report.visitPurpose || report.visitMode) && (
            <div className="rounded-lg border p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Visit details</p>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Type:</span> {report.visitMode?.replace("_", " ") || "—"}</div>
                <div><span className="text-muted-foreground">Purpose:</span> {report.visitPurpose || "—"}</div>
                <div><span className="text-muted-foreground">Arrival:</span> {fmtDateTime(report.visitStartedAt as unknown as { seconds: number })}</div>
                <div><span className="text-muted-foreground">Departure:</span> {fmtDateTime(report.visitEndedAt as unknown as { seconds: number })}</div>
              </div>
            </div>
          )}

          {/* Guard Counts */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                <User className="h-3.5 w-3.5" />Guards Present
              </div>
              <p className="text-2xl font-bold text-green-600">
                {editing ? (
                  <input
                    type="number" min="0" value={editPresent}
                    onChange={(e) => setEditPresent(e.target.value)}
                    className="w-20 text-2xl font-bold bg-transparent border-b border-border focus:outline-none focus:border-brand-blue"
                  />
                ) : report.guardsPresentCount}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                <User className="h-3.5 w-3.5" />Guards Absent
              </div>
              <p className="text-2xl font-bold text-red-500">
                {editing ? (
                  <input
                    type="number" min="0" value={editAbsent}
                    onChange={(e) => setEditAbsent(e.target.value)}
                    className="w-20 text-2xl font-bold bg-transparent border-b border-border focus:outline-none focus:border-brand-blue"
                  />
                ) : report.guardsAbsentCount}
              </p>
            </div>
          </div>

          {/* Summary */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
              <FileText className="h-3.5 w-3.5" />Summary
            </div>
            {editing ? (
              <Textarea rows={4} value={editSummary} onChange={(e) => setEditSummary(e.target.value)} className="text-sm" />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{report.summary || "—"}</p>
            )}
          </div>

          {/* Issues Found */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
              <AlertTriangle className="h-3.5 w-3.5" />Issues Found
            </div>
            {editing ? (
              <Textarea rows={3} value={editIssues} onChange={(e) => setEditIssues(e.target.value)} className="text-sm" placeholder="None reported" />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{report.issuesFound || "None reported"}</p>
            )}
          </div>

          {/* Actions Required */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
              <ListChecks className="h-3.5 w-3.5" />Actions Required
            </div>
            {editing ? (
              <Textarea rows={3} value={editActions} onChange={(e) => setEditActions(e.target.value)} className="text-sm" placeholder="None specified" />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{report.actionsRequired || "None specified"}</p>
            )}
          </div>

          {/* GPS Location */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
              <MapPin className="h-3.5 w-3.5" />GPS Location
            </div>
            {report.visitLocation ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-sm bg-muted px-2 py-1 rounded">
                  {report.visitLocation.lat.toFixed(5)}, {report.visitLocation.lng.toFixed(5)}
                </code>
                <a
                  href={`https://www.google.com/maps?q=${report.visitLocation.lat},${report.visitLocation.lng}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-brand-blue hover:underline"
                >
                  View on Map
                </a>
                <span className="text-xs text-muted-foreground">
                  {(report.locationStatus || "legacy_unverified").replaceAll("_", " ")}
                  {typeof report.distanceFromSiteMeters === "number"
                    ? ` · ${report.distanceFromSiteMeters} m from site`
                    : ""}
                  {typeof report.visitLocation.accuracyMeters === "number"
                    ? ` · ±${report.visitLocation.accuracyMeters} m`
                    : ""}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No GPS data captured</p>
            )}
          </div>

          {/* Photos */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
              <ImageIcon className="h-3.5 w-3.5" />
              Site Photos ({editing ? editPhotoUrls.length : (report.photoUrls?.length ?? 0)})
            </div>
            {editing ? (
              <div className="space-y-3">
                <PhotoCapture
                  urls={editing ? editPhotoUrls : [...(report.photoUrls ?? [])]}
                  onChange={(urls) => {
                    if (editing) setEditPhotoUrls(urls);
                    else setEditPhotoUrls(urls);
                  }}
                  folder="visitReports"
                  accept="image/*,.pdf"
                  timestampImages
                  allowSelfie
                  uploadLabel="Upload photo / file"
                  stampTitle="Site Visit"
                  stampLines={[report.clientName, report.siteName, report.district, `Visit: ${fmt(report.visitDate as unknown as { seconds: number })}`].filter(Boolean) as string[]}
                  maxPhotos={20}
                  fileTypeLabel="All image formats and PDF files accepted."
                />
              </div>
            ) : (report.photoUrls?.length ?? 0) > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {report.photoUrls!.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    className="aspect-square rounded-md overflow-hidden border bg-muted flex items-center justify-center hover:opacity-80 transition-opacity">
                    {isPdfUrl(url) ? (
                      <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                        <FileText className="h-6 w-6" />PDF
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                    )}
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No photos attached</p>
            )}
          </div>

          {/* Review Info */}
          {(report.status === "reviewed" || report.reviewStatus === "reviewed") && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="flex items-center gap-1.5 text-xs text-green-700 font-medium uppercase tracking-wide mb-2">
                <Shield className="h-3.5 w-3.5" />Reviewed
              </div>
              {report.reviewedBy && <p className="text-sm">By: {report.reviewedBy}</p>}
              {report.reviewedAt && <p className="text-xs text-muted-foreground">At: {fmtDateTime(report.reviewedAt as unknown as { seconds: number })}</p>}
              {report.reviewNotes && <p className="text-sm mt-2 whitespace-pre-wrap">{report.reviewNotes}</p>}
            </div>
          )}

          {/* Review Action (Admin only, submitted reports) */}
          {canReview && !editing && (
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-medium">Review Notes</p>
              <Textarea
                rows={3}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Add review comments..."
              />
              <Button onClick={handleReview} disabled={reviewing} className="w-full bg-green-600 hover:bg-green-700">
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                {reviewing ? "Saving..." : "Mark as Reviewed"}
              </Button>
              <Button onClick={handleRequestRevision} disabled={reviewing} variant="outline" className="w-full">
                Request revision
              </Button>
            </div>
          )}

          {report.reviewStatus === "revision_requested" && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Revision requested</p>
              {report.reviewNotes && <p className="mt-1 whitespace-pre-wrap">{report.reviewNotes}</p>}
            </div>
          )}

          {(report.auditEvents?.length ?? 0) > 0 && (
            <div className="rounded-lg border p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Report history</p>
              <div className="mt-3 space-y-3">
                {report.auditEvents!.map((event) => (
                  <div key={event.id} className="border-l-2 border-border pl-3 text-sm">
                    <p className="font-medium capitalize">{event.action.replaceAll("_", " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.actorRole || "System"} · {fmtDateTime(event.eventAt as string)}
                    </p>
                    {event.note && <p className="mt-1 whitespace-pre-wrap">{event.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {canClientAcknowledge && (
            <Button onClick={handleClientAcknowledge} disabled={reviewing} className="w-full">
              Acknowledge report
            </Button>
          )}
        </div>

        {/* Action Bar */}
        <div className="sticky bottom-0 bg-background pt-4 border-t mt-6 flex gap-2">
          {canEdit && !editing && (
            <Button onClick={startEditing} variant="outline" className="flex-1">
              <Edit3 className="h-4 w-4 mr-1.5" />Edit Draft
            </Button>
          )}
          {canEdit && editing && (
            <>
              <Button onClick={() => setEditing(false)} variant="outline" className="flex-1">Cancel</Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? "Saving..." : "Save Changes"}
              </Button>
              <Button onClick={handleSubmit} disabled={saving} variant="secondary" className="flex-1">
                Submit
              </Button>
            </>
          )}
          {canCreateRevision && (
            <Button onClick={handleCreateRevision} disabled={saving} className="flex-1">
              Create revision draft
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
