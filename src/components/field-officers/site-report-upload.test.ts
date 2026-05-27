import { describe, expect, it } from "vitest";
import { hasSiteUploads, isSiteUploadRequired } from "./site-report-upload";

describe("site report upload rules", () => {
  it("requires uploads for submitted reports, not for drafts", () => {
    expect(isSiteUploadRequired("visit", "submitted")).toBe(true);
    expect(isSiteUploadRequired("visit", "draft")).toBe(false);
    expect(isSiteUploadRequired("training", "submitted")).toBe(true);
    expect(isSiteUploadRequired("training", "draft")).toBe(false);
    expect(isSiteUploadRequired("training")).toBe(false);  // no status = draft safe default
  });

  it("detects whether any uploaded files exist", () => {
    expect(hasSiteUploads([])).toBe(false);
    expect(hasSiteUploads([""])).toBe(false);
    expect(hasSiteUploads(["https://example.com/report.jpg"])).toBe(true);
  });
});
