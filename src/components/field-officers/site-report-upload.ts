export type SiteReportKind = "visit" | "training";

export type VisitReportStatus = "draft" | "submitted" | "reviewed";
export type TrainingReportStatus = "draft" | "submitted" | "acknowledged";
export type ReportStatus = VisitReportStatus | TrainingReportStatus;

export function hasSiteUploads(urls: unknown[]): boolean {
  return urls.some((url) => typeof url === "string" && url.trim().length > 0);
}

export function isSiteUploadRequired(kind: SiteReportKind, status?: ReportStatus): boolean {
  // Drafts never require uploads
  if (status === "draft" || !status) return false;
  // Both visit and training reports require uploads when submitting
  return status === "submitted";
}

export function getSiteUploadHint(kind: SiteReportKind, status?: ReportStatus): string {
  if (kind === "training") {
    return "Training reports require at least 1 training photo and a client-signed report. Photos are timestamped with date, time and GPS location.";
  }

  if (status === "submitted") {
    return "Visit reports require at least one photo (guard photo or selfie with guards). Photos are timestamped with date, time and GPS location.";
  }

  return "Add photos or files for this report. Drafts can be saved without uploads.";
}
