"use client";

import React, { useState } from "react";
import { useAppAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PhotoCapture } from "@/components/field-officers/photo-capture";
import { CheckCircle2, Edit3, FileText, ImageIcon, MapPin, Calendar, Clock, User, Building2, Shield, Timer, Users, BookOpen } from "lucide-react";
import type { FoTrainingReport, TrainingReportStatus } from "@/types/branch";

const STATUS_CONFIG: Record<TrainingReportStatus, { label: string; className: string }> = {
  draft:        { label: "Draft",        className: "bg-gray-100 text-gray-600" },
  submitted:    { label: "Submitted",    className: "bg-amber-100 text-amber-700" },
  acknowledged: { label: "Acknowledged", className: "bg-green-100 text-green-700" },
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
  report: FoTrainingReport | null;
  onUpdated: () => void;
}

export function TrainingReportDetailSheet({ open, onOpenChange, report, onUpdated }: Props) {
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const isAdmin = userRole === "admin" || userRole === "superAdmin";
  const isOwner = report?.fieldOfficerId && userRole === "fieldOfficer";
  const canEdit = report?.status === "draft" && (isAdmin || isOwner);
  const canAddMedia = report && (isAdmin || (isOwner && report.status !== "draft"));
  const canAcknowledge = isAdmin && report?.status === "submitted";

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);

  const [editTopic, setEditTopic] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDuration, setEditDuration] = useState("60");
  const [editAttendeeCount, setEditAttendeeCount] = useState("0");
  const [editPhotoUrls, setEditPhotoUrls] = useState<string[]>([]);
  const [editAttachmentUrls, setEditAttachmentUrls] = useState<string[]>([]);
  const [editClientReportUrl, setEditClientReportUrl] = useState<string[]>([]);

  const startEditing = () => {
    if (!report) return;
    setEditTopic(report.topic ?? "");
    setEditDescription(report.description ?? "");
    setEditDuration(String(report.durationMinutes ?? 60));
    setEditAttendeeCount(String(report.attendeeCount ?? 0));
    setEditPhotoUrls([...(report.photoUrls ?? [])]);
    setEditAttachmentUrls([...(report.attachmentUrls ?? [])]);
    setEditClientReportUrl(report.clientReportUrl ? [report.clientReportUrl] : []);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!report) return;
    setSaving(true);
    try {
      const res = await authorizedFetch(`/api/admin/training-reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: editTopic,
          description: editDescription,
          durationMinutes: parseInt(editDuration) || 60,
          attendeeCount: parseInt(editAttendeeCount) || 0,
          photoUrls: editPhotoUrls,
          attachmentUrls: editAttachmentUrls,
          clientReportUrl: editClientReportUrl[0] ?? null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(data?.error || "Save failed");
      }
      toast({ title: "Updated", description: "Training report saved." });
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
        body.topic = editTopic;
        body.description = editDescription;
        body.durationMinutes = parseInt(editDuration) || 60;
        body.attendeeCount = parseInt(editAttendeeCount) || 0;
        body.photoUrls = editPhotoUrls;
        body.attachmentUrls = editAttachmentUrls;
        body.clientReportUrl = editClientReportUrl[0] ?? null;
      }
      const res = await authorizedFetch(`/api/admin/training-reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Submit failed");
      toast({ title: "Submitted", description: "Training report submitted." });
      setEditing(false);
      onUpdated();
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Submit failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddMedia = async () => {
    if (!report) return;
    setSaving(true);
    try {
      const res = await authorizedFetch(`/api/admin/training-reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoUrls: editPhotoUrls,
          attachmentUrls: editAttachmentUrls,
          clientReportUrl: editClientReportUrl[0] ?? null,
        }),
      });
      if (!res.ok) throw new Error("Update failed");
      toast({ title: "Updated", description: "Media added to report." });
      setEditing(false);
      onUpdated();
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Update failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleAcknowledge = async () => {
    if (!report) return;
    setAcknowledging(true);
    try {
      const res = await authorizedFetch(`/api/admin/training-reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "acknowledged" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Acknowledged", description: "Training report acknowledged." });
      onUpdated();
      onOpenChange(false);
    } catch {
      toast({ title: "Error", description: "Failed to acknowledge", variant: "destructive" });
    } finally {
      setAcknowledging(false);
    }
  };

  if (!report) return null;

  const sc = STATUS_CONFIG[report.status];

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
          <SheetTitle className="text-lg">Training Report</SheetTitle>
          <SheetDescription className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1"><User className="h-3 w-3" />{report.fieldOfficerName}</span>
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{fmt(report.trainingDate as unknown as { seconds: number })}</span>
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

          {/* Topic */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
              <BookOpen className="h-3.5 w-3.5" />Topic
            </div>
            {editing ? (
              <Input value={editTopic} onChange={(e) => setEditTopic(e.target.value)} className="text-sm" placeholder="Training topic" />
            ) : (
              <p className="text-base font-semibold">{report.topic}</p>
            )}
          </div>

          {/* Duration & Attendees */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                <Timer className="h-3.5 w-3.5" />Duration
              </div>
              <p className="text-2xl font-bold">
                {editing ? (
                  <input
                    type="number" min="15" value={editDuration}
                    onChange={(e) => setEditDuration(e.target.value)}
                    className="w-20 text-2xl font-bold bg-transparent border-b border-border focus:outline-none focus:border-brand-blue"
                  />
                ) : report.durationMinutes}
                <span className="text-sm font-normal text-muted-foreground ml-1">min</span>
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                <Users className="h-3.5 w-3.5" />Attendees
              </div>
              <p className="text-2xl font-bold text-brand-blue">
                {editing ? (
                  <input
                    type="number" min="0" value={editAttendeeCount}
                    onChange={(e) => setEditAttendeeCount(e.target.value)}
                    className="w-20 text-2xl font-bold bg-transparent border-b border-border focus:outline-none focus:border-brand-blue"
                  />
                ) : report.attendeeCount}
              </p>
            </div>
          </div>

          {/* Description */}
          {((report.description || editing) || report.description === "") && (
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
                <FileText className="h-3.5 w-3.5" />Description
              </div>
              {editing ? (
                <Textarea rows={4} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="text-sm" placeholder="Training details, outcomes..." />
              ) : (
                <p className="text-sm whitespace-pre-wrap">{report.description || "—"}</p>
              )}
            </div>
          )}

          {/* GPS Location */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
              <MapPin className="h-3.5 w-3.5" />GPS Location
            </div>
            {report.visitLocation ? (
              <div className="flex items-center gap-2 flex-wrap">
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
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No GPS data captured</p>
            )}
          </div>

          {/* Training Photos */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
              <ImageIcon className="h-3.5 w-3.5" />
              Training Photos ({(editing ? editPhotoUrls.length : (report.photoUrls?.length ?? 0))})
            </div>
            {(editing || canAddMedia) ? (
              <div className="space-y-3">
                <PhotoCapture
                  urls={editing || canAddMedia ? (editing ? editPhotoUrls : [...(report.photoUrls ?? [])]) : [...(report.photoUrls ?? [])]}
                  onChange={(urls) => setEditPhotoUrls(urls)}
                  folder="trainingReports"
                  accept="image/*,.pdf"
                  timestampImages
                  allowSelfie
                  uploadLabel="Upload photo / file"
                  stampTitle="Training Session"
                  stampLines={[report.clientName ?? "", report.siteName ?? "", report.district, report.topic ? `Topic: ${report.topic}` : "", `Date: ${fmt(report.trainingDate as unknown as { seconds: number })}`].filter(Boolean) as string[]}
                  maxPhotos={30}
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

          {/* Client Report */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
              <FileText className="h-3.5 w-3.5" />Client-Signed Report
            </div>
            {(editing || canAddMedia) ? (
              <div className="space-y-3">
                <PhotoCapture
                  urls={editClientReportUrl}
                  onChange={setEditClientReportUrl}
                  folder="trainingReportFiles"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                  maxPhotos={1}
                  allowCamera={false}
                  allowSelfie={false}
                  uploadLabel="Upload report"
                  fileTypeLabel="PDF or image files allowed."
                />
              </div>
            ) : report.clientReportUrl ? (
              <a href={report.clientReportUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-brand-blue hover:underline">
                <FileText className="h-4 w-4" />View Client Report
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">No client report attached</p>
            )}
          </div>

          {/* Attachments */}
          {(editing || (report.attachmentUrls && report.attachmentUrls.length > 0)) && (
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
                <FileText className="h-3.5 w-3.5" />
                Attachments ({(editing ? editAttachmentUrls.length : (report.attachmentUrls?.length ?? 0))})
              </div>
              {(report.attachmentUrls?.length ?? 0) > 0 && !editing ? (
                <div className="space-y-2">
                  {report.attachmentUrls!.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      className="block text-sm text-brand-blue hover:underline break-all">
                      <FileText className="h-3.5 w-3.5 inline mr-1" />Attachment {i + 1}
                    </a>
                  ))}
                </div>
              ) : editing ? (
                <PhotoCapture
                  urls={editAttachmentUrls}
                  onChange={setEditAttachmentUrls}
                  folder="trainingReportFiles"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*,.doc,.docx,.ppt,.pptx"
                  maxPhotos={10}
                  allowCamera={false}
                  allowSelfie={false}
                  uploadLabel="Upload attachment"
                  fileTypeLabel="PDF, documents, and images allowed."
                />
              ) : null}
            </div>
          )}

          {/* Acknowledged Info */}
          {report.status === "acknowledged" && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="flex items-center gap-1.5 text-xs text-green-700 font-medium uppercase tracking-wide mb-2">
                <Shield className="h-3.5 w-3.5" />Acknowledged
              </div>
              {report.acknowledgedBy && <p className="text-sm">By: {report.acknowledgedBy}</p>}
              {report.acknowledgedAt && <p className="text-xs text-muted-foreground">At: {fmtDateTime(report.acknowledgedAt as unknown as { seconds: number })}</p>}
            </div>
          )}

          {/* Acknowledge Action (Admin only, submitted reports) */}
          {canAcknowledge && !editing && (
            <Button onClick={handleAcknowledge} disabled={acknowledging} className="w-full bg-green-600 hover:bg-green-700">
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              {acknowledging ? "Saving..." : "Acknowledge Report"}
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
          {canAddMedia && !canEdit && !editing && (
            <Button onClick={() => { setEditPhotoUrls([...(report.photoUrls ?? [])]); setEditAttachmentUrls([...(report.attachmentUrls ?? [])]); setEditClientReportUrl(report.clientReportUrl ? [report.clientReportUrl] : []); setEditing(true); }} variant="outline" className="flex-1">
              <ImageIcon className="h-4 w-4 mr-1.5" />Add Photos/Files
            </Button>
          )}
          {canAddMedia && editing && !canEdit && (
            <>
              <Button onClick={() => setEditing(false)} variant="outline" className="flex-1">Cancel</Button>
              <Button onClick={handleAddMedia} disabled={saving} className="flex-1">
                {saving ? "Saving..." : "Save Media"}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
