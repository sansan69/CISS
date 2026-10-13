import { describe, expect, it } from "vitest";
import {
  getEnrollmentFileSelectionError,
  assertEnrollmentUploadSize,
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

  it("rejects PDFs that cannot fit through the hosted upload endpoint", () => {
    const file = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.pdf", {type: "application/pdf"});
    expect(getEnrollmentFileSelectionError(file)).toContain("4MB");
    expect(() => assertEnrollmentUploadSize(file)).toThrow("under 4MB");
  });

  it("requires a smaller image when browser compression cannot reduce it", () => {
    const file = new File([new Uint8Array(6 * 1024 * 1024)], "large.heic", {type: "image/heic"});
    expect(getEnrollmentFileSelectionError(file)).toBeNull();
    expect(() => assertEnrollmentUploadSize(file)).toThrow("retake the photo as JPEG");
  });

  it("rejects non-image, non-PDF files", () => {
    const file = new File(["text"], "document.txt", { type: "text/plain" });
    expect(getEnrollmentFileSelectionError(file)).toContain("Invalid file type");
  });
});
