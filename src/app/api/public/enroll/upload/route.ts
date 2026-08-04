import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { assertEnrollmentUploadSize, getEnrollmentFileSelectionError } from "@/lib/enrollmentFiles";
import { storage, db } from "@/lib/firebaseAdmin";
import {
  ENROLLMENT_DRAFT_MAX_UPLOADS,
  enrollmentDraftTokenMatches,
} from "@/lib/server/enrollment-draft";

export const runtime = "nodejs";

const ALLOWED_FOLDERS = new Set([
  "profilePictures",
  "signatures",
  "idProofs",
  "addressProofs",
  "serviceBooks",
  "armsLicenses",
  "aadharCards",
  "panCards",
  "passports",
  "bankDocuments",
  "policeCertificates",
  "qualificationCertificates",
]);

function isSafeEnrollmentPath(path: string) {
  return /^enrollments\/[A-Za-z0-9_-]+\/(profilePictures|signatures|idProofs|addressProofs|serviceBooks|armsLicenses|aadharCards|panCards|passports|bankDocuments|policeCertificates|qualificationCertificates)\/[A-Za-z0-9._-]+$/.test(
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
    const uploadToken = String(formData.get("uploadToken") || "");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File is required." }, { status: 400 });
    }

    const match = path.match(/^enrollments\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)\//);
    const folder = match?.[1] || "";
    if (!isSafeEnrollmentPath(path) || !ALLOWED_FOLDERS.has(folder)) {
      return NextResponse.json({ error: "Invalid enrollment upload path." }, { status: 400 });
    }

    // Verify the enrollment exists and is in a valid state for file uploads.
    const enrollmentId = path.split("/")[1];
    const enrollmentSnap = await db.collection("enrollments").doc(enrollmentId).get();
    if (!enrollmentSnap.exists) {
      return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
    }
    const enrollmentData = enrollmentSnap.data() as {
      status?: string;
      tokenHash?: string;
      expiresAt?: { toMillis?: () => number };
      uploadCount?: number;
    } | undefined;
    const expiresAt = enrollmentData?.expiresAt?.toMillis?.() ?? 0;
    if (
      enrollmentData?.status !== "draft" ||
      expiresAt <= Date.now() ||
      !enrollmentDraftTokenMatches(uploadToken, enrollmentData.tokenHash)
    ) {
      return NextResponse.json(
        { error: "This enrollment upload session is invalid or has expired." },
        { status: 403 },
      );
    }
    if ((enrollmentData.uploadCount ?? 0) >= ENROLLMENT_DRAFT_MAX_UPLOADS) {
      return NextResponse.json(
        { error: "The maximum number of enrollment files has been reached." },
        { status: 400 },
      );
    }

    const selectionError = getEnrollmentFileSelectionError(file);
    if (selectionError) {
      return NextResponse.json({ error: selectionError }, { status: 400 });
    }

    assertEnrollmentUploadSize(file);

    const bucket = storage.bucket();
    const storageFile = bucket.file(path);
    const buffer = Buffer.from(await file.arrayBuffer());

    // Aadhaar must never receive a bearer-style Firebase download token. The
    // enrollment API moves this temporary object into server-only storage.
    const isRestrictedDocument = folder === "aadharCards";
    const downloadToken = isRestrictedDocument ? null : crypto.randomUUID();

    await storageFile.save(buffer, {
      resumable: false,
      metadata: {
        contentType: file.type || "application/octet-stream",
        cacheControl: isRestrictedDocument ? "no-store, private, max-age=0" : undefined,
        metadata: downloadToken
          ? { firebaseStorageDownloadTokens: downloadToken }
          : {},
      },
    });
    await enrollmentSnap.ref.update({
      uploadCount: (enrollmentData.uploadCount ?? 0) + 1,
    });

    return NextResponse.json({
      url: isRestrictedDocument
        ? path
        : buildDownloadUrl(bucket.name, path, downloadToken!),
    });
  } catch (error: any) {
    console.error("Public enrollment upload failed:", error);
    return NextResponse.json(
      { error: error?.message || "Could not upload enrollment file." },
      { status: 500 },
    );
  }
}
