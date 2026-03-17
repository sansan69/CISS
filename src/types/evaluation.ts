import type { Timestamp } from "firebase/firestore";

export type AwardType = "best_guard_monthly" | "best_guard_quarterly" | "training_star" | "attendance_champion";

export interface EvaluationCriteria {
  punctuality: number;           // 0–10
  uniformCompliance: number;     // 0–10 (auto-populated from attendanceLogs)
  behaviorProfessionalism: number; // 0–10
  skillCompetency: number;       // 0–10
  clientFeedback: number;        // 0–10
}

export interface Evaluation {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  clientId: string;
  clientName: string;
  district: string;
  evaluatedBy: string;           // fieldOfficer uid
  evaluatedByName: string;
  period: string;                // YYYY-MM
  criteria: EvaluationCriteria;
  totalScore: number;            // sum of criteria (0–50)
  normalizedScore: number;       // (totalScore / 50) * 100 → 0–100
  uniformComplianceRate?: number; // 0–1, auto-fetched
  comments?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface GuardScore {
  id: string;                    // = employeeId
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  clientId: string;
  clientName: string;
  district: string;
  profilePicUrl?: string;
  currentMonthScore: number;     // 0–100
  previousMonthScore?: number;
  allTimeAvgScore: number;       // 0–100
  totalEvaluations: number;
  totalTrainingsCompleted: number;
  uniformComplianceRate: number; // 0–1
  attendanceRate: number;        // 0–1
  badges: string[];              // e.g. ['best_guard_2026-01', 'training_star_2025-12']
  lastUpdated: Timestamp;
}

export interface Award {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  district: string;
  clientId: string;
  clientName: string;
  profilePicUrl?: string;
  type: AwardType;
  period: string;                // YYYY-MM or YYYY-Q1
  score: number;
  awardedBy: string;
  awardedByName: string;
  awardedAt: Timestamp;
  notes?: string;
}
