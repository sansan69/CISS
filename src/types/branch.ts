import type { Timestamp } from "firebase/firestore";
import type { ReportAttachment } from "@/lib/reports/report-schema";

export type VisitReportStatus = "draft" | "submitted" | "reviewed" | "superseded" | "archived";
export type TrainingReportStatus = "draft" | "submitted" | "acknowledged" | "superseded" | "archived";

export interface FoReportAuditEvent {
  id: string;
  action: string;
  actorId?: string;
  actorRole?: string;
  note?: string;
  revisionNumber?: number;
  eventAt?: Timestamp | string;
}

export interface FoVisitReport {
  id: string;
  fieldOfficerId: string;
  fieldOfficerName: string;
  stateCode: string;
  district: string;
  clientId: string;
  clientName: string;
  siteId?: string;
  siteName?: string;
  visitDate: Timestamp;
  visitStartedAt?: Timestamp;
  visitEndedAt?: Timestamp;
  visitPurpose?: string;
  visitMode?: "scheduled" | "surprise" | "follow_up" | "other";
  checkInTime?: Timestamp;
  checkOutTime?: Timestamp;
  checkInLocation?: { lat: number; lng: number; accuracyMeters?: number };
  checkOutLocation?: { lat: number; lng: number; accuracyMeters?: number };
  summary: string;
  issuesFound?: string;
  actionsRequired?: string;
  guardsPresentCount: number;
  guardsAbsentCount: number;
  photoUrls: string[];
  attachments?: ReportAttachment[];
  visitLocation?: { lat: number; lng: number; accuracyMeters?: number; capturedAt?: string };
  locationStatus?: "verified_on_site" | "captured_off_site" | "not_captured" | "legacy_unverified";
  distanceFromSiteMeters?: number | null;
  visibility?: "private_draft" | "client_visible" | "withdrawn";
  reviewStatus?: "unreviewed" | "reviewed" | "revision_requested";
  clientStatus?: "unseen" | "viewed" | "acknowledged" | "disputed";
  revisionNumber?: number;
  previousRevisionId?: string;
  auditEvents?: FoReportAuditEvent[];
  status: VisitReportStatus;
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  reviewNotes?: string;
  createdAt: Timestamp;
}

export interface FoTrainingReport {
  id: string;
  fieldOfficerId: string;
  fieldOfficerName: string;
  stateCode: string;
  district: string;
  clientId: string;
  clientName?: string;
  siteId?: string;
  siteName?: string;
  trainingDate: Timestamp;
  trainingStartedAt?: Timestamp;
  trainingEndedAt?: Timestamp;
  trainingVenue?: string;
  durationMinutes: number;
  topic: string;
  moduleName?: string;
  moduleVersion?: string;
  trainerName?: string;
  learningObjectives?: string;
  description?: string;
  attendeeIds: string[];
  attendeeCount: number;
  assessmentMethod?: string;
  assessmentResult?: "not_assessed" | "passed" | "failed" | "retraining_required";
  photoUrls: string[];
  attachmentUrls: string[];
  attachments?: ReportAttachment[];
  clientReportUrl?: string;
  visitLocation?: { lat: number; lng: number; accuracyMeters?: number; capturedAt?: string };
  locationStatus?: "verified_on_site" | "captured_off_site" | "not_captured" | "legacy_unverified";
  visibility?: "private_draft" | "client_visible" | "withdrawn";
  reviewStatus?: "unreviewed" | "reviewed" | "revision_requested";
  clientStatus?: "unseen" | "viewed" | "acknowledged" | "disputed";
  revisionNumber?: number;
  previousRevisionId?: string;
  auditEvents?: FoReportAuditEvent[];
  status: TrainingReportStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: Timestamp;
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  reviewNotes?: string;
  createdAt: Timestamp;
}
