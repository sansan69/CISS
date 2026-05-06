import { Timestamp } from "firebase/firestore";

export interface AppNotification {
  id?: string;
  type: "work_order" | "attendance_marked" | "leave_approved" | "training_assigned" | "broadcast" | "report_review";
  title: string;
  body: string;
  recipientUid?: string;       // single user
  recipientRole?: "guard" | "fieldOfficer" | "all"; // role-based broadcast
  recipientDistrict?: string;  // district filter
  data?: Record<string, string>; // FCM payload data (for navigation)
  read: boolean;
  createdAt: Timestamp;
  readAt?: Timestamp;
  createdBy?: string;          // admin uid who sent it
}
