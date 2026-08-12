import { describe, expect, it } from "vitest";
import {
  getEnrollmentFileSelectionError,
  isEnrollmentFileSelectionValid,
} from "./enrollmentFiles";

describe("registration upload file validation", () => {
  it.each([
    "image/gif",
    "image/bmp",
    "image/tiff",
    "image/avif",
    "image/heic",
    "image/heif",
    "image/svg+xml",
  ])("accepts %s image files", (contentType) => {
    const file = new File(["image"], `document.${contentType.split("/")[1]}`, { type: contentType });
    expect(getEnrollmentFileSelectionError(file)).toBeNull();
    expect(isEnrollmentFileSelectionValid(file)).toBe(true);
  });

  it("continues to accept PDFs for document fields", () => {
    const file = new File(["pdf"], "document.pdf", { type: "application/pdf" });
    expect(getEnrollmentFileSelectionError(file)).toBeNull();
  });

  it("rejects non-image, non-PDF files", () => {
    const file = new File(["text"], "document.txt", { type: "text/plain" });
    expect(getEnrollmentFileSelectionError(file)).toContain("Invalid file type");
  });
});
