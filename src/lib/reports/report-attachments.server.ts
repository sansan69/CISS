import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";

import { storage } from "@/lib/firebaseAdmin";
import type { ReportAttachment } from "@/lib/reports/report-schema";
import { ReportApiError } from "@/lib/reports/report-server";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

export async function validateReportAttachments({
  attachments,
  reportType,
  reportId,
  uid,
}: {
  attachments: ReportAttachment[];
  reportType: "visit" | "training";
  reportId: string;
  uid: string;
}) {
  const expectedPrefix = `foReports/${reportType}/${uid}/${reportId}/`;
  const bucket = storage.bucket();

  for (const attachment of attachments) {
    if (!attachment.storagePath.startsWith(expectedPrefix)) {
      throw new ReportApiError("An attachment does not belong to this report.", 400);
    }
    if (!ALLOWED_MIME_TYPES.has(attachment.contentType)) {
      throw new ReportApiError(`Unsupported attachment type: ${attachment.contentType}`, 400);
    }

    const file = bucket.file(attachment.storagePath);
    const [exists] = await file.exists();
    if (!exists) throw new ReportApiError("An uploaded attachment could not be found.", 400);
    const [metadata] = await file.getMetadata();
    const storedSize = Number(metadata.size ?? 0);
    const custom = metadata.metadata ?? {};
    if (
      storedSize !== attachment.size ||
      metadata.contentType !== attachment.contentType ||
      custom.reportId !== reportId ||
      custom.uploaderId !== uid ||
      custom.attachmentId !== attachment.id
    ) {
      throw new ReportApiError("Attachment metadata validation failed.", 400);
    }

    const [head] = await file.download({ start: 0, end: Math.min(storedSize - 1, 8_191) });
    const detected = await fileTypeFromBuffer(head);
    const detectedMime = detected?.mime;
    if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
      throw new ReportApiError(`The file ${attachment.originalName} is not an allowed document.`, 400);
    }
    if (
      detectedMime !== attachment.contentType &&
      !(detectedMime === "image/heic" && attachment.contentType === "image/heif")
    ) {
      throw new ReportApiError(`The file type for ${attachment.originalName} does not match.`, 400);
    }
    if (!/^[a-f0-9]{64}$/.test(attachment.sha256)) {
      throw new ReportApiError("Attachment checksum is invalid.", 400);
    }
  }
}

export async function addSignedAttachmentUrls(value: Record<string, unknown>) {
  const attachments = Array.isArray(value.attachments)
    ? (value.attachments as ReportAttachment[])
    : [];
  if (attachments.length === 0) return value;
  const expires = Date.now() + 15 * 60 * 1_000;
  const hydrated = await Promise.all(
    attachments.map(async (attachment) => {
      const [url] = await storage.bucket().file(attachment.storagePath).getSignedUrl({
        action: "read",
        expires,
      });
      return { ...attachment, url };
    }),
  );
  const photoCategories = new Set(["visit_photo", "training_photo"]);
  const securePhotoUrls = hydrated
    .filter((item) => photoCategories.has(item.category))
    .map((item) => item.url)
    .filter((url): url is string => Boolean(url));
  const secureSignedReport = hydrated.find((item) => item.category === "signed_report")?.url;
  const secureAttachmentUrls = hydrated
    .filter((item) => !photoCategories.has(item.category) && item.category !== "signed_report")
    .map((item) => item.url)
    .filter((url): url is string => Boolean(url));
  return {
    ...value,
    attachments: hydrated,
    photoUrls: securePhotoUrls.length > 0 ? securePhotoUrls : value.photoUrls,
    clientReportUrl: secureSignedReport || value.clientReportUrl,
    attachmentUrls:
      secureAttachmentUrls.length > 0 ? secureAttachmentUrls : value.attachmentUrls,
  };
}

export function sha256Hex(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
