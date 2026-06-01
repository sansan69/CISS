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
    return "Training reports require at least 3 photos of the session. You can snap photos from the app or upload from your gallery (photos taken with another phone or shared by others).";
  }

  if (status === "submitted") {
    return "Visit reports require at least one photo or file. You can use the in-app camera, upload from your gallery, or attach a PDF. If you don't have them now, you can still submit and add them later by editing this report.";
  }

  return "Add one or more photos or files for this site report. Drafts can be saved without uploads. Multiple uploads are supported.";
}
