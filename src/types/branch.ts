import type { Timestamp } from "firebase/firestore";

export interface Branch {
  id: string;
  name: string; // e.g. "Kerala - Ernakulam Branch"
  stateCode: string;
  district: string;
  address?: string;
  phone?: string;
  email?: string;
  managedBy?: string; // admin uid
  managedByName?: string;
  fieldOfficerIds: string[];
  createdAt: Timestamp;
}

export type VisitReportStatus = "draft" | "submitted" | "reviewed";
export type TrainingReportStatus = "submitted" | "acknowledged";
export type ExpenseCategory =
  | "Travel"
  | "Fuel"
  | "Stationery"
  | "Communication"
  | "Equipment"
  | "Maintenance"
  | "Utilities"
  | "Miscellaneous";
export type ExpenseSheetStatus = "draft" | "submitted" | "approved";

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

export interface ExpenseEntry {
  id: string;
  date: string; // ISO date string
  category: ExpenseCategory;
  description: string;
  amount: number;
  receiptUrl?: string;
  vendor?: string;
  approvedBy?: string;
}

export interface BranchExpense {
  id: string;
  branchId: string;
  stateCode: string;
  month: string; // YYYY-MM
  enteredBy: string;
  entries: ExpenseEntry[];
  totalAmount: number;
  status: ExpenseSheetStatus;
  approvedBy?: string;
  approvedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}
