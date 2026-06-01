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
const UPLOAD_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };

function isSafeAttendancePath(path: string) {
  return /^employees\/[0-9A-Za-z_-]+\/attendance\/[A-Za-z0-9._-]+$/.test(path);
}

function parseImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error("Attendance photo must be an image data URL.");
  }

  const contentType = match[1];
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

    if (!path.startsWith("employees/" + tokenPayload.employeeId + "/")) {
      return NextResponse.json({ error: "Upload path does not match session." }, { status: 403 });
    }

    if (!isSafeAttendancePath(path)) {
      return NextResponse.json({ error: "Invalid attendance upload path." }, { status: 400 });
    }

    const { buffer, contentType } = parseImageDataUrl(photoDataUrl);
    const bucket = storage.bucket();
    const storageFile = bucket.file(path);
    const downloadToken = crypto.randomUUID();

    await storageFile.save(buffer, {
      resumable: false,
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    return NextResponse.json({
      url: buildDownloadUrl(bucket.name, path, downloadToken),
    });
  } catch (error: any) {
    console.error("Public attendance photo upload failed:", error);
    return NextResponse.json(
      { error: error?.message || "Could not upload attendance photo." },
      { status: 500 },
    );
  }
}
