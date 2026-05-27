import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { storage } from "@/lib/firebaseAdmin";
import { requireAdminOrFieldOfficer, verifyRequestAuth } from "@/lib/server/auth";

export const runtime = "nodejs";

const MAX_FO_PHOTO_BYTES = 15 * 1024 * 1024;

function isSafeFoReportPath(path: string, uid: string) {
  const escapedUid = uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = `^foReports\\/(visitReports|trainingReports|trainingReportFiles)\\/${escapedUid}\\/[A-Za-z0-9._-]+$`;
  return new RegExp(pattern).test(path);
}

function parseDataUrl(dataUrl: string) {
  const imageMatch = dataUrl.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (imageMatch) {
    const buffer = Buffer.from(imageMatch[2], "base64");
    if (buffer.length === 0) throw new Error("Upload is empty.");
    if (buffer.length > MAX_FO_PHOTO_BYTES) throw new Error("Upload is too large. Max 15MB.");
    return { buffer, contentType: imageMatch[1] };
  }
  const genericMatch = dataUrl.match(/^data:([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (genericMatch) {
    const buffer = Buffer.from(genericMatch[2], "base64");
    if (buffer.length === 0) throw new Error("Upload is empty.");
    if (buffer.length > MAX_FO_PHOTO_BYTES) throw new Error("Upload is too large. Max 15MB.");
    return { buffer, contentType: genericMatch[1] };
  }
  throw new Error("Upload must be a base64 data URL.");
}

export async function POST(request: NextRequest) {
  try {
    const decoded = requireAdminOrFieldOfficer(await verifyRequestAuth(request));
    const uid = typeof decoded.uid === "string" ? decoded.uid : "";

    const body = (await request.json().catch(() => null)) as {
      path?: unknown;
      photoDataUrl?: unknown;
    } | null;

    const path = typeof body?.path === "string" ? body.path : "";
    const photoDataUrl = typeof body?.photoDataUrl === "string" ? body.photoDataUrl : "";

    if (!isSafeFoReportPath(path, uid)) {
      return NextResponse.json({ error: "Invalid report upload path." }, { status: 400 });
    }

    const { buffer, contentType } = parseDataUrl(photoDataUrl);
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

    const encPath = encodeURIComponent(path);
    const url = "https://firebasestorage.googleapis.com/v0/b/" + bucket.name + "/o/" + encPath + "?alt=media&token=" + downloadToken;
    return NextResponse.json({ url });
  } catch (error: any) {
    console.error("FO report photo upload failed:", error);
    return NextResponse.json(
      { error: error?.message || "Could not upload report photo." },
      { status: 500 },
    );
  }
}
