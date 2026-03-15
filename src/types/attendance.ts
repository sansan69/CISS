import { z } from "zod";

export const attendanceStatusSchema = z.enum(["In", "Out"]);

export const attendancePhotoComplianceSchema = z.object({
  overallStatus: z.enum(["clear", "warning", "analysis_failed"]),
  adminFlag: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
  summary: z.string().default(""),
  missingShoes: z.boolean().default(false),
  missingIdCard: z.boolean().default(false),
  uniformIssue: z.boolean().default(false),
  fullBodyVisible: z.boolean().default(false),
  onePersonVisible: z.boolean().default(true),
});

export type AttendancePhotoCompliance = z.infer<
  typeof attendancePhotoComplianceSchema
>;

export const attendanceSubmissionSchema = z.object({
  employeeId: z.string().min(1),
  employeeName: z.string().min(1),
  employeeDocId: z.string().min(1),
  reportedAtClient: z.string().datetime().optional(),
  employeePhoneNumber: z.string().optional(),
  employeeClientName: z.string().optional(),
  status: attendanceStatusSchema,
  district: z.string().min(1),
  siteId: z.string().min(1),
  siteName: z.string().min(1),
  clientName: z.string().optional(),
  siteCoords: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
  locationText: z.string().min(1),
  locationCoords: z.object({
    lat: z.number(),
    lon: z.number(),
    accuracyMeters: z.number().optional(),
  }),
  distanceMeters: z.number().nonnegative(),
  locationAccuracyMeters: z.number().nullable().optional(),
  photoUrl: z.string().url(),
  photoCapturedAt: z.string().datetime().optional(),
  photoCompliance: attendancePhotoComplianceSchema.optional(),
  deviceInfo: z.object({
    userAgent: z.string(),
  }),
});

export type AttendanceSubmission = z.infer<typeof attendanceSubmissionSchema>;

export const attendanceLogSchema = attendanceSubmissionSchema.extend({
  id: z.string().optional(),
  attendanceDate: z.string().optional(),
  createdAt: z.any().optional(),
});

export type AttendanceLog = z.infer<typeof attendanceLogSchema>;

export type AttendanceSyncStatus = "queued" | "synced" | "failed";

export interface DeviceAttendanceHistoryItem {
  id: string;
  employeeId: string;
  employeeName: string;
  status: "In" | "Out";
  time: string;
  district: string;
  siteName: string;
  clientName?: string;
  location?: string;
  photoUrl?: string;
  syncStatus: AttendanceSyncStatus;
}

export interface QueuedAttendanceSubmission {
  id: string;
  createdAt: string;
  payload: Omit<AttendanceSubmission, "photoUrl"> & {
    photoDataUrl: string;
  };
}
