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
  // Training reports require photos; visit reports are optional
  return kind === "training";
}

export function getSiteUploadHint(kind: SiteReportKind, status?: ReportStatus): string {
  if (kind === "training") {
    return "Training reports require at least 3 photos of the session. You can snap photos from the app or upload from your gallery (photos taken with another phone or shared by others).";
  }

  if (status === "submitted") {
    return "Add one or more photos or files for this site report. Photos are recommended but not required — you can submit without them and add later. Multiple uploads are supported.";
  }

  return "Add one or more photos or files for this site report. Drafts can be saved without uploads. Multiple uploads are supported.";
}
