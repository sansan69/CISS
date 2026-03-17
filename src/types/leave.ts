import type { Timestamp } from "firebase/firestore";

export type LeaveType = "casual" | "sick" | "earned" | "unpaid";
export type LeaveStatus = "pending" | "approved" | "rejected";

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  clientId: string;
  clientName: string;
  district: string;
  managedBy: string; // fieldOfficer or admin uid
  type: LeaveType;
  fromDate: Timestamp;
  toDate: Timestamp;
  days: number;
  reason: string;
  status: LeaveStatus;
  approvedBy?: string;
  approvedByName?: string;
  respondedAt?: Timestamp;
  notes?: string;
  createdAt: Timestamp;
}

export interface LeaveBalance {
  id: string; // = employeeId_YYYY
  employeeId: string;
  year: number;
  casual: { entitled: number; taken: number; balance: number };
  sick: { entitled: number; taken: number; balance: number };
  earned: { entitled: number; taken: number; carried: number };
  updatedAt: Timestamp;
}
