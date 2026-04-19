import type { Timestamp } from "firebase/firestore";

export type TrainingCategory = "safety" | "legal" | "conduct" | "skills" | "emergency";
export type TrainingStatus = "assigned" | "inProgress" | "completed" | "failed";
export type TrainingContentType = "pdf" | "pptx" | "image";

export interface TrainingModule {
  id: string;
  title: string;
  description: string;
  category: TrainingCategory;
  contentUrl?: string;
  contentType?: TrainingContentType;
  contentPath?: string;
  contentFileName?: string;
  durationMinutes: number;
  passingScore: number;
  isActive: boolean;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt?: Timestamp;
}

export interface QuestionBank {
  id: string;
  title: string;
  moduleId: string;
  questionsPerAttempt: number;
  timeLimitMinutes: number;
  shuffle: boolean;
  maxAttempts: number;
  questionCount: number;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt?: Timestamp;
}

export interface Question {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  createdAt?: Timestamp;
}

export interface QuizAttempt {
  id: string;
  moduleId: string;
  bankId: string;
  employeeDocId: string;
  answers: { questionId: string; selectedIndex: number; correct: boolean }[];
  score: number;
  total: number;
  passed: boolean;
  startedAt: Timestamp;
  submittedAt: Timestamp;
  durationSeconds: number;
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
