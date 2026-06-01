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
  dutyPointId: z.string().optional(),
  dutyPointName: z.string().optional(),
  clientName: z.string().optional(),
  shiftCode: z.string().optional(),
  shiftLabel: z.string().optional(),
  shiftStartTime: z.string().optional(),
  shiftEndTime: z.string().optional(),
  nextShiftCode: z.string().optional(),
  nextShiftStartsAt: z.string().optional(),
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
  gpsAccuracyMeters: z.number().nullable().optional(),
  locationAccuracyMeters: z.number().nullable().optional(),
  geofenceRadiusAtTime: z.number().positive().optional(),
  isMockLocationSuspected: z.boolean().optional(),
  mockLocationReason: z.string().nullable().optional(),
  sourceCollection: z.enum(['sites', 'clientLocations']).optional(),
  photoUrl: z.string().url(),
  photoCapturedAt: z.string().datetime().optional(),
  photoCompliance: attendancePhotoComplianceSchema.optional(),
  deviceInfo: z.object({
    userAgent: z.string(),
  }),
  // Industry-standard idempotency key (UUID v4) — prevents duplicate submissions on retries
  clientRequestId: z.string().uuid().optional(),
  // Optional override reason when guard is outside geofence but has legitimate cause
  overrideReason: z.string().min(1).max(500).optional(),
  // QR token for verification when scanning another guard's QR code
  qrToken: z.string().optional(),
});

export type AttendanceSubmission = z.infer<typeof attendanceSubmissionSchema>;

const firestoreTimestampSchema = z.custom<
  | { seconds: number; nanoseconds: number; toDate: () => Date }
  | Date
  | null
  | undefined
>((val) => {
  if (val == null) return true;
  if (val instanceof Date) return true;
  if (typeof val === "object" && typeof (val as any).seconds === "number") return true;
  return false;
}, "Expected a Firestore Timestamp or Date");

export const attendanceLogSchema = attendanceSubmissionSchema.extend({
  id: z.string().optional(),
  siteClientName: z.string().nullable().optional(),
  crossClientRelief: z.boolean().optional(),
  attendanceDate: z.string().optional(),
  reportedAt: firestoreTimestampSchema.optional(),
  createdAt: firestoreTimestampSchema.optional(),
  // Server-populated deduplication marker
  processedClientRequestId: z.string().optional(),
});

export type AttendanceLog = z.infer<typeof attendanceLogSchema>;

export interface FirestoreAttendanceLog {
  id: string;
  employeeId: string;
  employeeName: string;
  employeePhoneNumber?: string;
  employeeClientName?: string | null;
  reportedAtClient?: string | null;
  status: "In" | "Out";
  district?: string;
  siteId?: string;
  siteName?: string;
  dutyPointId?: string | null;
  dutyPointName?: string | null;
  clientName?: string | null;
  siteClientName?: string | null;
  crossClientRelief?: boolean;
  sourceCollection?: string | null;
  shiftCode?: string | null;
  shiftLabel?: string | null;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
  locationText?: string;
  locationCoords?: { lat: number; lon: number; accuracyMeters?: number };
  siteCoords?: { lat: number; lng: number };
  distanceMeters?: number;
  gpsAccuracyMeters?: number | null;
  locationAccuracyMeters?: number | null;
  geofenceRadiusAtTime?: number | null;
  strictGeofence?: boolean;
  isMockLocationSuspected?: boolean;
  mockLocationReason?: string | null;
  requiresLocationReview?: boolean;
  photoUrl?: string;
  photoCapturedAt?: string | null;
  photoCompliance?: AttendancePhotoCompliance | null;
  deviceInfo?: { userAgent: string };
  reportedAt?: { seconds: number; nanoseconds: number; toDate: () => Date } | null;
  createdAt?: { seconds: number; nanoseconds: number; toDate: () => Date } | null;
  attendanceDate?: string;
  auditTrail?: unknown[];
}

export type AttendanceSyncStatus = "queued" | "synced" | "failed";

export interface DeviceAttendanceHistoryItem {
  id: string;
  employeeId: string;
  employeeName: string;
  status: "In" | "Out";
  time: string;
  reportedAtIso?: string;
  district: string;
  siteName: string;
  dutyPointName?: string;
  clientName?: string;
  employeeClientName?: string;
  siteClientName?: string;
  crossClientRelief?: boolean;
  shiftLabel?: string;
  location?: string;
  locationCoords?: {
    lat: number;
    lon: number;
    accuracyMeters?: number;
  };
  mockLocationWarning?: boolean;
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
