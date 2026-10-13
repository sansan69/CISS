const MB = 1024 * 1024;

export const MAX_ENROLLMENT_IMAGE_INPUT_SIZE_MB = 15;
export const MAX_ENROLLMENT_DOCUMENT_SIZE_MB = 4;

export const MAX_ENROLLMENT_IMAGE_INPUT_SIZE_BYTES =
  MAX_ENROLLMENT_IMAGE_INPUT_SIZE_MB * MB;
export const MAX_ENROLLMENT_DOCUMENT_SIZE_BYTES =
  MAX_ENROLLMENT_DOCUMENT_SIZE_MB * MB;

export function getEnrollmentFileSelectionError(file: File): string | null {
  if (file.type.startsWith("image/")) {
    if (file.size > MAX_ENROLLMENT_IMAGE_INPUT_SIZE_BYTES) {
      return `Image is too large. Max ${MAX_ENROLLMENT_IMAGE_INPUT_SIZE_MB}MB before compression.`;
    }

    return null;
  }

  if (file.type === "application/pdf") {
    if (file.size > MAX_ENROLLMENT_DOCUMENT_SIZE_BYTES) {
      return `PDF is too large. Max ${MAX_ENROLLMENT_DOCUMENT_SIZE_MB}MB.`;
    }

    return null;
  }

  return "Invalid file type. Use any image format or PDF.";
}

export function isEnrollmentFileSelectionValid(file: File): boolean {
  return getEnrollmentFileSelectionError(file) === null;
}

export function assertEnrollmentUploadSize(file: File): void {
  // Leave room for multipart headers below Vercel's 4.5 MB request limit.
  if (file.size > MAX_ENROLLMENT_DOCUMENT_SIZE_BYTES) {
    throw new Error(
      "Prepared file is too large to upload. Use a PDF or image under 4MB, or retake the photo as JPEG.",
    );
  }
}
