import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { assertEnrollmentUploadSize, getEnrollmentFileSelectionError } from "@/lib/enrollmentFiles";
import { storage } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const ALLOWED_FOLDERS = new Set([
  "profilePictures",
  "signatures",
  "idProofs",
  "addressProofs",
  "bankDocuments",
  "policeCertificates",
]);

function isSafeEnrollmentPath(path: string) {
  return /^enrollments\/[A-Za-z0-9_-]+\/(profilePictures|signatures|idProofs|addressProofs|bankDocuments|policeCertificates)\/[A-Za-z0-9._-]+$/.test(
    path,
  );
}

function buildDownloadUrl(bucketName: string, path: string, token: string) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const path = String(formData.get("path") || "");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File is required." }, { status: 400 });
    }

    const match = path.match(/^enrollments\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)\//);
    const folder = match?.[1] || "";
    if (!isSafeEnrollmentPath(path) || !ALLOWED_FOLDERS.has(folder)) {
      return NextResponse.json({ error: "Invalid enrollment upload path." }, { status: 400 });
    }

    const selectionError = getEnrollmentFileSelectionError(file);
    if (selectionError) {
      return NextResponse.json({ error: selectionError }, { status: 400 });
    }

    assertEnrollmentUploadSize(file);

    const bucket = storage.bucket();
    const storageFile = bucket.file(path);
    const downloadToken = crypto.randomUUID();
    const buffer = Buffer.from(await file.arrayBuffer());

    await storageFile.save(buffer, {
      resumable: false,
      metadata: {
        contentType: file.type || "application/octet-stream",
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    return NextResponse.json({
      url: buildDownloadUrl(bucket.name, path, downloadToken),
    });
  } catch (error: any) {
    console.error("Public enrollment upload failed:", error);
    return NextResponse.json(
      { error: error?.message || "Could not upload enrollment file." },
      { status: 500 },
    );
  }
}
