import type { Timestamp } from "firebase/firestore";

export type VisitReportStatus = "draft" | "submitted" | "reviewed";
export type TrainingReportStatus = "submitted" | "acknowledged";

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
  trainingDate: Timestamp;
  durationMinutes: number;
  topic: string;
  description?: string;
  attendeeIds: string[];
  attendeeCount: number;
  photoUrls: string[];
  attachmentUrls: string[];
  status: TrainingReportStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: Timestamp;
  createdAt: Timestamp;
}
