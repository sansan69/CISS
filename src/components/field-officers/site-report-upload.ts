export type SiteReportKind = "visit" | "training";

export type VisitReportStatus = "draft" | "submitted" | "reviewed";
export type TrainingReportStatus = "draft" | "submitted" | "acknowledged";
export type ReportStatus = VisitReportStatus | TrainingReportStatus;

export function hasSiteUploads(urls: unknown[]): boolean {
  return urls.some((url) => typeof url === "string" && url.trim().length > 0);
}

export function isSiteUploadRequired(kind: SiteReportKind, status?: ReportStatus): boolean {
  // Drafts never require uploads — only submitted reports do
  if (status === "draft" || !status) return false;
  return kind === "training" || status === "submitted";
}

export function getSiteUploadHint(kind: SiteReportKind, status?: ReportStatus): string {
  if (kind === "training") {
    return "Add one or more photos or files for this site report. Multiple uploads are supported and no duty-point-specific upload is needed.";
  }

  if (status === "submitted") {
    return "Add one or more photos or files for this site report before submitting. Multiple uploads are supported and no duty-point-specific upload is needed.";
  }

  return "Add one or more photos or files for this site report. Drafts can be saved without uploads. Multiple uploads are supported and no duty-point-specific upload is needed.";
}
