export type SiteReportKind = "visit" | "training";

export type VisitReportStatus = "draft" | "submitted" | "reviewed";

export function hasSiteUploads(urls: unknown[]): boolean {
  return urls.some((url) => typeof url === "string" && url.trim().length > 0);
}

export function isSiteUploadRequired(kind: SiteReportKind, status?: VisitReportStatus): boolean {
  return kind === "training" || status === "submitted";
}

export function getSiteUploadHint(kind: SiteReportKind, status?: VisitReportStatus): string {
  if (kind === "training") {
    return "Add one or more photos or files for this site report. Multiple uploads are supported and no duty-point-specific upload is needed.";
  }

  if (status === "submitted") {
    return "Add one or more photos or files for this site report before submitting. Multiple uploads are supported and no duty-point-specific upload is needed.";
  }

  return "Add one or more photos or files for this site report. Drafts can be saved without uploads. Multiple uploads are supported and no duty-point-specific upload is needed.";
}
