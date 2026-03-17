import type { Timestamp } from "firebase/firestore";

export type TrainingCategory = "safety" | "legal" | "conduct" | "skills" | "emergency";
export type TrainingStatus = "assigned" | "inProgress" | "completed" | "failed";

export interface TrainingModule {
  id: string;
  title: string;
  description: string;
  category: TrainingCategory;
  contentUrl?: string;           // Storage URL for PDF/video
  durationMinutes: number;
  passingScore: number;          // 0–100
  isActive: boolean;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt?: Timestamp;
}

export interface TrainingAssignment {
  id: string;
  employeeId: string;
  employeeName: string;
  clientId: string;
  clientName: string;
  district: string;
  moduleId: string;
  moduleName: string;
  moduleCategory: TrainingCategory;
  assignedBy: string;
  assignedAt: Timestamp;
  dueDate?: Timestamp;
  status: TrainingStatus;
  score?: number;                // 0–100
  completedAt?: Timestamp;
  certificateUrl?: string;
}
