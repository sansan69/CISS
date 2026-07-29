import { z } from "zod";

export const REPORT_SCHEMA_VERSION = 2;

export const reportWorkflowStatusSchema = z.enum([
  "draft",
  "submitted",
  "superseded",
  "archived",
]);

export const reportReviewStatusSchema = z.enum([
  "unreviewed",
  "reviewed",
  "revision_requested",
]);

export const reportClientStatusSchema = z.enum([
  "unseen",
  "viewed",
  "acknowledged",
  "disputed",
]);

export const reportVisibilitySchema = z.enum([
  "private_draft",
  "client_visible",
  "withdrawn",
]);

export const reportLocationStatusSchema = z.enum([
  "verified_on_site",
  "captured_off_site",
  "not_captured",
  "legacy_unverified",
]);

const trimmedText = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => trimmedText(max).min(1);
const nonNegativeInteger = z.number().int().min(0).max(100_000);

export const reportLocationSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().min(0).max(100_000).optional(),
  capturedAt: z.string().datetime().optional(),
}).strict();

export const reportAttachmentSchema = z.object({
  id: z.string().trim().min(8).max(160),
  storagePath: z.string().trim().min(1).max(1_024),
  category: z.enum([
    "visit_photo",
    "training_photo",
    "signed_report",
    "attendance_sheet",
    "assessment_sheet",
    "certificate",
    "supporting_document",
  ]),
  originalName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  size: z.number().int().min(1).max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  uploadedAt: z.string().datetime(),
  caption: trimmedText(500).optional(),
  captureLocation: reportLocationSchema.optional(),
}).strict();

export type ReportAttachment = z.infer<typeof reportAttachmentSchema> & {
  url?: string;
};

const commonReportInputSchema = z.object({
  reportId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
  clientId: requiredText(160),
  clientName: trimmedText(300).optional(),
  siteId: trimmedText(160).optional(),
  siteName: trimmedText(300).optional(),
  district: trimmedText(160).optional(),
  status: z.enum(["draft", "submitted"]).default("draft"),
  submissionIdempotencyKey: z.string().trim().min(8).max(160).optional(),
  photoUrls: z.array(z.string().url().max(4_096)).max(30).default([]),
  attachmentUrls: z.array(z.string().url().max(4_096)).max(20).default([]),
  attachments: z.array(reportAttachmentSchema).max(50).default([]),
  visitLocation: reportLocationSchema.nullable().optional(),
});

export const visitReportInputSchema = commonReportInputSchema.extend({
  visitDate: requiredText(40).refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Visit date must be valid.",
  }),
  visitStartedAt: z.string().datetime().optional(),
  visitEndedAt: z.string().datetime().optional(),
  visitPurpose: trimmedText(500).optional(),
  visitMode: z.enum(["scheduled", "surprise", "follow_up", "other"]).optional(),
  summary: requiredText(5_000),
  issuesFound: trimmedText(10_000).optional(),
  actionsRequired: trimmedText(10_000).optional(),
  guardsPresentCount: nonNegativeInteger.default(0),
  guardsAbsentCount: nonNegativeInteger.default(0),
});

export const trainingReportInputSchema = commonReportInputSchema.extend({
  trainingDate: requiredText(40).refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Training date must be valid.",
  }),
  trainingStartedAt: z.string().datetime().optional(),
  trainingEndedAt: z.string().datetime().optional(),
  trainingVenue: trimmedText(500).optional(),
  durationMinutes: z.number().int().min(1).max(24 * 60).default(60),
  topic: requiredText(500),
  moduleName: trimmedText(500).optional(),
  moduleVersion: trimmedText(120).optional(),
  trainerName: trimmedText(300).optional(),
  learningObjectives: trimmedText(5_000).optional(),
  description: trimmedText(10_000).optional(),
  attendeeIds: z.array(z.string().trim().min(1).max(160)).max(1_000).default([]),
  attendeeCount: nonNegativeInteger.default(0),
  assessmentMethod: trimmedText(500).optional(),
  assessmentResult: z.enum(["not_assessed", "passed", "failed", "retraining_required"]).optional(),
  clientReportUrl: z.string().url().max(4_096).nullable().optional(),
});

export const reportReviewUpdateSchema = z.object({
  reviewStatus: reportReviewStatusSchema.optional(),
  reviewNotes: trimmedText(5_000).optional(),
  status: z.enum(["reviewed", "acknowledged"]).optional(),
}).strict();

export const reportClientUpdateSchema = z.object({
  clientStatus: z.enum(["acknowledged", "disputed"]),
  clientNote: trimmedText(5_000).optional(),
}).strict();

export const visitDraftUpdateSchema = visitReportInputSchema.partial().extend({
  status: z.enum(["draft", "submitted"]).optional(),
}).strict();

export const trainingDraftUpdateSchema = trainingReportInputSchema.partial().extend({
  status: z.enum(["draft", "submitted"]).optional(),
}).strict();

export type VisitReportInput = z.infer<typeof visitReportInputSchema>;
export type TrainingReportInput = z.infer<typeof trainingReportInputSchema>;

export function firstZodError(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return "Invalid report data.";
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

export function isLegacyClientVisibleStatus(value: unknown) {
  return value === "submitted" || value === "reviewed" || value === "acknowledged";
}

export function isClientVisibleReport(report: Record<string, unknown>) {
  if (report.status === "superseded" || report.status === "archived") return false;
  if (report.visibility === "withdrawn" || report.visibility === "private_draft") return false;
  if (report.visibility === "client_visible") return true;
  return isLegacyClientVisibleStatus(report.status);
}
