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

const optionalStringFromNull = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().optional(),
);
const optionalDateTimeStringFromNull = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().datetime().optional(),
);
const optionalUuidFromNull = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().uuid().optional(),
);
const optionalBoundedStringFromNull = (schema: z.ZodString) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());

export const attendanceSubmissionSchema = z.object({
  employeeId: z.string().min(1),
  employeeName: z.string().min(1),
  employeeDocId: z.string().min(1),
  reportedAtClient: optionalDateTimeStringFromNull,
  locationCapturedAt: z.string().datetime(),
  employeePhoneNumber: optionalStringFromNull,
  employeeClientName: optionalStringFromNull,
  status: attendanceStatusSchema,
  district: z.string().min(1),
  siteId: z.string().min(1),
  siteName: z.string().min(1),
  dutyPointId: optionalStringFromNull,
  dutyPointName: optionalStringFromNull,
  clientName: optionalStringFromNull,
  shiftCode: optionalStringFromNull,
  shiftLabel: optionalStringFromNull,
  shiftStartTime: optionalStringFromNull,
  shiftEndTime: optionalStringFromNull,
  nextShiftCode: optionalStringFromNull,
  nextShiftStartsAt: optionalStringFromNull,
  siteCoords: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  locationText: z.string().min(1),
  locationCoords: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
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
  photoStoragePath: z.string().min(1),
  photoCapturedAt: z.string().datetime(),
  photoCompliance: attendancePhotoComplianceSchema.optional(),
  deviceInfo: z.object({
    userAgent: z.string(),
  }),
  // Industry-standard idempotency key (UUID v4) — prevents duplicate submissions on retries
  clientRequestId: optionalUuidFromNull,
  attendanceAttemptId: z.string().uuid(),
  // Optional override reason when guard is outside geofence but has legitimate cause
  overrideReason: optionalBoundedStringFromNull(z.string().min(1).max(500)),
  // QR token for verification when scanning another guard's QR code
  qrToken: optionalStringFromNull,
  // Signed, short-lived identity proof returned after public identification.
  // Logged-in guards are verified from their Firebase identity instead.
  attendanceVerificationToken: optionalStringFromNull,
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
  requiresAdminReview: z.boolean().optional(),
  reviewStatus: z
    .enum(["pending", "approved", "corrected", "rejected"])
    .optional(),
  reviewNote: z.string().nullable().optional(),
});

export type AttendanceLog = z.infer<typeof attendanceLogSchema>;

export type FirestoreDateValue =
  | string
  | Date
  | {
      seconds?: number;
      nanoseconds?: number;
      _seconds?: number;
      _nanoseconds?: number;
      toDate?: () => Date;
    }
  | null;

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
  photoCapturedAt?: FirestoreDateValue;
  photoCompliance?: AttendancePhotoCompliance | null;
  deviceInfo?: { userAgent: string };
  reportedAt?: FirestoreDateValue;
  createdAt?: FirestoreDateValue;
  attendanceDate?: string;
  auditTrail?: unknown[];
  attendanceSessionId?: string | null;
  autoClosed?: boolean;
  closeReason?: string | null;
  requiresAdminReview?: boolean;
  attendanceReviewWarnings?: string[];
  reviewStatus?: "pending" | "approved" | "corrected" | "rejected";
  reviewNote?: string | null;
  reviewedByUid?: string | null;
  reviewedByRole?: string | null;
  reviewedAt?: { seconds: number; nanoseconds: number; toDate: () => Date } | null;
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
  payload: Omit<AttendanceSubmission, "photoUrl" | "photoStoragePath"> & {
    photoDataUrl?: string;
  };
  /**
   * When true, the photo was stripped before persisting to local storage.
   * The UI should re-capture or skip the photo when retrying.
   */
  photoStripped?: boolean;
}
