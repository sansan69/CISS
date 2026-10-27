import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { storage } from "@/lib/firebaseAdmin";
import {
  checkRateLimit,
  buildRateLimitKey,
  getClientIp,
} from "@/lib/server/rate-limit";
import { verifyUploadToken } from "@/lib/server/upload-token";

export const runtime = "nodejs";

const MAX_ATTENDANCE_PHOTO_BYTES = 5 * 1024 * 1024;
const UPLOAD_RATE_LIMIT = { maxRequests: 120, windowMs: 60_000 };

function isSafeAttendancePath(path: string) {
  return /^employees\/[0-9A-Za-z_-]+\/attendance\/[0-9a-f-]{36}\/photo\.jpg$/i.test(path);
}

function parseImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error("Attendance photo must be an image data URL.");
  }

  const contentType = match[1].toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    throw new Error("Attendance photo must be JPEG, PNG, or WebP.");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0) {
    throw new Error("Attendance photo is empty.");
  }
  if (buffer.length > MAX_ATTENDANCE_PHOTO_BYTES) {
    throw new Error("Attendance photo is too large. Max 5MB.");
  }

  return { buffer, contentType };
}

function buildDownloadUrl(bucketName: string, path: string, token: string) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting per IP
    const ip = getClientIp(request);
    const rateLimitKey = buildRateLimitKey("attendance-upload", ip);
    const rateLimit = await checkRateLimit(rateLimitKey, UPLOAD_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Please wait a moment and try again." },
        { status: 429 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      path?: unknown;
      photoDataUrl?: unknown;
      uploadToken?: unknown;
    } | null;

    const path = typeof body?.path === "string" ? body.path : "";
    const photoDataUrl = typeof body?.photoDataUrl === "string" ? body.photoDataUrl : "";
    const uploadToken = typeof body?.uploadToken === "string" ? body.uploadToken : "";

    const tokenPayload = verifyUploadToken(uploadToken);
    if (!tokenPayload) {
      return NextResponse.json(
        { error: "Invalid or expired upload token. Please restart attendance." },
        { status: 401 },
      );
    }

    const expectedPath =
      `employees/${tokenPayload.employeeDocId}/attendance/` +
      `${tokenPayload.attemptId}/photo.jpg`;
    if (path !== expectedPath) {
      return NextResponse.json({ error: "Upload path does not match session." }, { status: 403 });
    }

    if (!isSafeAttendancePath(path)) {
      return NextResponse.json({ error: "Invalid attendance upload path." }, { status: 400 });
    }

    const { buffer, contentType } = parseImageDataUrl(photoDataUrl);
    const bucket = storage.bucket();
    const storageFile = bucket.file(path);

    // Attendance evidence is immutable for an attempt. A queued retry may run
    // after the first upload succeeded but its response was lost; return the
    // original object instead of replacing the photo and revoking the URL that
    // the committed attendance log already points at.
    const existingResponse = async () => {
      const [metadata] = await storageFile.getMetadata();
      const raw = metadata.metadata?.firebaseStorageDownloadTokens;
      const token = typeof raw === "string" ? raw.split(",")[0] : "";
      if (!token) return null;
      return NextResponse.json({
        url: buildDownloadUrl(bucket.name, path, token),
        path,
        reused: true,
      });
    };

    const [exists] = await storageFile.exists();
    if (exists) {
      const existing = await existingResponse();
      if (existing) return existing;
      return NextResponse.json(
        { error: "Attendance photo already exists but has no download token." },
        { status: 409 },
      );
    }

    const downloadToken = crypto.randomUUID();
    try {
      await storageFile.save(buffer, {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType,
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
          },
        },
      });
    } catch (error: any) {
      if (Number(error?.code) === 412) {
        const existing = await existingResponse();
        if (existing) return existing;
      }
      throw error;
    }

    return NextResponse.json({
      url: buildDownloadUrl(bucket.name, path, downloadToken),
      path,
    });
  } catch (error: any) {
    const { log } = await import("@/lib/server/log");
    log("error", "attendance-upload", "Public attendance photo upload failed", { error: error?.message });
    return NextResponse.json(
      { error: error?.message || "Could not upload attendance photo." },
      { status: 500 },
    );
  }
}
