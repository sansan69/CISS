"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin, Clock, Users, FileText, ImageIcon, ArrowLeft, Send, GraduationCap, ClipboardCheck } from "lucide-react";

interface VisitPreviewData {
  type: "visit";
  clientName: string;
  siteName?: string;
  district?: string;
  visitDate: string;
  guardsPresentCount: number;
  guardsAbsentCount: number;
  summary: string;
  issuesFound?: string;
  actionsRequired?: string;
}

interface TrainingPreviewData {
  type: "training";
  clientName: string;
  siteName?: string;
  district?: string;
  trainingDate: string;
  topic: string;
  durationMinutes: number;
  attendeeCount: number;
  description?: string;
}

type PreviewData = VisitPreviewData | TrainingPreviewData;

interface ReportPreviewProps {
  data: PreviewData;
  photoUrls: string[];
  clientReportUrl?: string;
  visitLocation?: { lat: number; lng: number } | null;
  onEdit: () => void;
  onSubmit: () => void;
  isSubmitting?: boolean;
}

function isPdfUrl(url: string) {
  return decodeURIComponent(url).toLowerCase().includes(".pdf");
}

function formatDateLabel(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export function ReportPreview({
  data,
  photoUrls,
  clientReportUrl,
  visitLocation,
  onEdit,
  onSubmit,
  isSubmitting,
}: ReportPreviewProps) {
  const isVisit = data.type === "visit";
  const title = isVisit ? "Visit Report Preview" : "Training Report Preview";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {isVisit ? (
          <ClipboardCheck className="h-5 w-5 text-brand-blue" />
        ) : (
          <GraduationCap className="h-5 w-5 text-brand-blue" />
        )}
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Client</p>
              <p className="text-sm font-medium">{data.clientName}</p>
            </div>
            {data.siteName && (
              <div>
                <p className="text-xs text-muted-foreground">Site</p>
                <p className="text-sm font-medium">{data.siteName}</p>
              </div>
            )}
            {data.district && (
              <div>
                <p className="text-xs text-muted-foreground">District</p>
                <p className="text-sm font-medium">{data.district}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {isVisit ? "Visit Date" : "Training Date"}
              </p>
              <p className="text-sm font-medium">
                {formatDateLabel(isVisit ? (data as VisitPreviewData).visitDate : (data as TrainingPreviewData).trainingDate)}
              </p>
            </div>
          </div>

          {isVisit ? (
            <>
              <div className="flex gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Present: <strong>{(data as VisitPreviewData).guardsPresentCount}</strong>
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Absent: <strong>{(data as VisitPreviewData).guardsAbsentCount}</strong>
                </span>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Summary</p>
                <p className="text-sm">{(data as VisitPreviewData).summary}</p>
              </div>

              {(data as VisitPreviewData).issuesFound && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Issues Found</p>
                  <p className="text-sm">{(data as VisitPreviewData).issuesFound}</p>
                </div>
              )}

              {(data as VisitPreviewData).actionsRequired && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Actions Required</p>
                  <p className="text-sm">{(data as VisitPreviewData).actionsRequired}</p>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <p className="text-xs text-muted-foreground">Topic</p>
                <p className="text-sm font-medium">{(data as TrainingPreviewData).topic}</p>
              </div>
              <div className="flex gap-4 text-sm">
                <span>Duration: <strong>{(data as TrainingPreviewData).durationMinutes} min</strong></span>
                <span>Attendees: <strong>{(data as TrainingPreviewData).attendeeCount}</strong></span>
              </div>
              {(data as TrainingPreviewData).description && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Description</p>
                  <p className="text-sm">{(data as TrainingPreviewData).description}</p>
                </div>
              )}
            </>
          )}

          {visitLocation && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              GPS: {visitLocation.lat}, {visitLocation.lng}
            </div>
          )}
        </CardContent>
      </Card>

      {photoUrls.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2 flex items-center gap-1">
            <ImageIcon className="h-4 w-4" />
            Photos ({photoUrls.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {photoUrls.map((url, i) => (
              <div key={i} className="relative h-20 w-20 rounded-md overflow-hidden border bg-muted shrink-0">
                {isPdfUrl(url) ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
                    <FileText className="h-6 w-6" />
                    PDF
                  </a>
                ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isVisit && clientReportUrl && (
        <div>
          <p className="text-sm font-medium mb-2 flex items-center gap-1">
            <FileText className="h-4 w-4" />
            Client-Signed Report
          </p>
          <a href={clientReportUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-blue underline">
            View report
          </a>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={onEdit} className="flex-1" disabled={isSubmitting}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Edit
        </Button>
        <Button onClick={onSubmit} disabled={isSubmitting} className="flex-1">
          <Send className="h-4 w-4 mr-1.5" />
          {isSubmitting ? "Submitting..." : "Submit Report"}
        </Button>
      </div>
    </div>
  );
}
