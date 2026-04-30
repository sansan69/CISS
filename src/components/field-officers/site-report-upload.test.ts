import { describe, expect, it } from "vitest";
import { hasSiteUploads, isSiteUploadRequired } from "./site-report-upload";

describe("site report upload rules", () => {
  it("requires uploads for submitted visit reports and all training reports", () => {
    expect(isSiteUploadRequired("visit", "submitted")).toBe(true);
    expect(isSiteUploadRequired("visit", "draft")).toBe(false);
    expect(isSiteUploadRequired("training")).toBe(true);
  });

  it("detects whether any uploaded files exist", () => {
    expect(hasSiteUploads([])).toBe(false);
    expect(hasSiteUploads([""])).toBe(false);
    expect(hasSiteUploads(["https://example.com/report.jpg"])).toBe(true);
  });
});
