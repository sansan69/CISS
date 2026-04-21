const MB = 1024 * 1024;

export const MAX_ENROLLMENT_IMAGE_INPUT_SIZE_MB = 15;
export const MAX_ENROLLMENT_DOCUMENT_SIZE_MB = 5;

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

  return "Invalid file type. Use JPG, PNG, WEBP, HEIC, HEIF or PDF.";
}

export function isEnrollmentFileSelectionValid(file: File): boolean {
  return getEnrollmentFileSelectionError(file) === null;
}

export function assertEnrollmentUploadSize(file: File): void {
  const limit = file.type.startsWith("image/")
    ? MAX_ENROLLMENT_IMAGE_INPUT_SIZE_BYTES
    : MAX_ENROLLMENT_DOCUMENT_SIZE_BYTES;

  if (file.size > limit) {
    const limitMb = file.type.startsWith("image/")
      ? MAX_ENROLLMENT_IMAGE_INPUT_SIZE_MB
      : MAX_ENROLLMENT_DOCUMENT_SIZE_MB;
    throw new Error(
      `Prepared file is too large to upload. Please use a smaller file or retake the photo. Max ${limitMb}MB.`,
    );
  }
}
