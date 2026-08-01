import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { fileTypeFromBuffer } from "file-type";
import { requireGuard } from "@/lib/server/guard-auth";
import { db, storage } from "@/lib/firebaseAdmin";
import {
  AADHAAR_CONSENT_TEXT_HASH,
  AADHAAR_CONSENT_VERSION,
  deleteStorageObjectIfPresent,
  documentCompletionFromEmployee,
  encryptAadhaarNumber,
  isAadhaarInfrastructureError,
  restrictedAadhaarPaths,
  saveRestrictedAadhaarBuffer,
  validateAadhaarNumber,
} from "@/lib/server/aadhaar";
import { ADDRESS_PROOF_TYPES, IDENTITY_PROOF_TYPES } from "@/lib/constants";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["application/pdf", "pdf"],
]);

async function validatedFile(value: FormDataEntryValue | null, required = true) {
  if (!(value instanceof File)) {
    if (!required) return null;
    throw new Error("Document file is required.");
  }
  const buffer = Buffer.from(await value.arrayBuffer());
  if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
    throw new Error("Document must be a non-empty file no larger than 5 MB.");
  }
  const detected = await fileTypeFromBuffer(buffer);
  const extension = detected && ALLOWED_TYPES.get(detected.mime);
  if (!detected || !extension) throw new Error("Only JPEG, PNG, and PDF documents are allowed.");
  return { buffer, contentType: detected.mime, extension, originalName: value.name };
}

function normalizedDocumentType(category: "identity" | "address", value: string) {
  const choices: readonly string[] =
    category === "identity" ? IDENTITY_PROOF_TYPES : ADDRESS_PROOF_TYPES;
  if (!choices.includes(value)) throw new Error(`Invalid ${category} proof type.`);
  return value;
}

function sameBucketDocumentPath(value: unknown, bucketName: string) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^employees\/[A-Za-z0-9_-]+\/(idProofs|addressProofs)\/[A-Za-z0-9._-]+$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com") return null;
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
    if (!match || decodeURIComponent(match[1]!) !== bucketName) return null;
    const path = decodeURIComponent(match[2]!);
    return /^employees\/[A-Za-z0-9_-]+\/(idProofs|addressProofs)\/[A-Za-z0-9._-]+$/.test(path) ? path : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);
    const url = new URL(request.url);
    const category = url.searchParams.get("category");
    const side = url.searchParams.get("side") === "back" ? "back" : "front";
    if (category !== "identity" && category !== "address") {
      return NextResponse.json({ error: "Only identity and address proofs can be viewed." }, { status: 400 });
    }
    const employeeSnap = await db.collection("employees").doc(guard.employeeDocId).get();
    if (!employeeSnap.exists) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    const employee = employeeSnap.data() as Record<string, unknown>;
    const rawPath = category === "identity"
      ? side === "front"
        ? employee.identityProofUrlFront || employee.idProofDocumentUrlFront || employee.idProofDocumentUrl
        : employee.identityProofUrlBack || employee.idProofDocumentUrlBack
      : side === "front"
        ? employee.addressProofUrlFront || employee.addressProofDocumentUrlFront
        : employee.addressProofUrlBack || employee.addressProofDocumentUrlBack;
    const bucket = storage.bucket();
    const path = sameBucketDocumentPath(rawPath, bucket.name);
    if (!path) return NextResponse.json({ error: "This proof page is not available." }, { status: 404 });
    const [buffer] = await bucket.file(path).download();
    const [metadata] = await bucket.file(path).getMetadata();
    await db.collection("sensitiveDocumentAuditLogs").add({
      action: "guard_document_viewed",
      employeeDocId: guard.employeeDocId,
      category,
      actorUid: guard.uid,
      actorType: "guard",
      at: Timestamp.now(),
    });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Disposition": "inline",
        "Cache-Control": "no-store, private, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document view failed.";
    const status = message.includes("Guard access required") ? 403 : 400;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  let uploadedPaths: string[] = [];
  try {
    const guard = await requireGuard(request);
    const formData = await request.formData();
    const categoryValue = String(formData.get("category") || "");
    if (!new Set(["aadhaar", "identity", "address"]).has(categoryValue)) {
      return NextResponse.json({ error: "Invalid document category." }, { status: 400 });
    }
    const category = categoryValue as "aadhaar" | "identity" | "address";

    const employeeRef = db.collection("employees").doc(guard.employeeDocId);
    const [employeeSnap, aadhaarSnap] = await Promise.all([
      employeeRef.get(),
      db.collection("employeeAadhaarPrivate").doc(guard.employeeDocId).get(),
    ]);
    if (!employeeSnap.exists) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    const employee = employeeSnap.data() as Record<string, unknown>;
    const completion = documentCompletionFromEmployee(
      employee,
      aadhaarSnap.exists && aadhaarSnap.data()?.status === "complete",
    );
    if (completion[category as keyof typeof completion] === "complete") {
      return NextResponse.json(
        { error: "This document is already on file. Contact the administrator for corrections." },
        { status: 409 },
      );
    }

    const now = Timestamp.now();
    const batch = db.batch();

    if (category === "aadhaar") {
      if (
        formData.get("consentAccepted") !== "true" ||
        formData.get("consentVersion") !== AADHAAR_CONSENT_VERSION
      ) {
        return NextResponse.json({ error: "Aadhaar consent is required." }, { status: 400 });
      }
      const number = validateAadhaarNumber(String(formData.get("aadhaarNumber") || ""));
      const file = await validatedFile(formData.get("front"));
      if (!file) throw new Error("Aadhaar copy is required.");
      const encryption = await encryptAadhaarNumber(number);
      const stored = await saveRestrictedAadhaarBuffer({
        employeeDocId: guard.employeeDocId,
        buffer: file.buffer,
        originalFileName: file.originalName,
      });
      uploadedPaths = [stored.documentStoragePath];
      const consentRef = employeeRef.collection("consents").doc();
      batch.set(consentRef, {
        type: "aadhaar_esic_epf",
        noticeVersion: AADHAAR_CONSENT_VERSION,
        noticeTextHash: AADHAAR_CONSENT_TEXT_HASH,
        accepted: true,
        acceptedAt: now,
        employeeName: employee.fullName || employee.name || guard.employeeId,
        signatureStoragePath: employee.signatureUrl || employee.signature || null,
        source: "guard_profile",
        employeeId: guard.employeeId,
        uploaderUid: guard.uid,
        status: "active",
      });
      batch.set(db.collection("employeeAadhaarPrivate").doc(guard.employeeDocId), {
        employeeDocId: guard.employeeDocId,
        ...encryption,
        aadhaarLast4: number.slice(-4),
        documentStoragePath: stored.documentStoragePath,
        originalFileName: stored.originalFileName,
        contentType: stored.contentType,
        purpose: "esic_epf_registration",
        employeeProvided: true,
        verificationStatus: "not_independently_verified",
        consentId: consentRef.id,
        uploadedByType: "guard",
        uploadedByUid: guard.uid,
        uploadedAt: now,
        updatedAt: now,
        retentionPolicy: "employment_plus_90_days",
        status: "complete",
      });
    } else {
      const documentType = normalizedDocumentType(
        category,
        String(formData.get("documentType") || ""),
      );
      const otherType = String(
        category === "identity"
          ? employee.addressProofType || employee.addressProofTypeLegacy || ""
          : employee.identityProofType || employee.idProofType || "",
      );
      if (otherType && otherType === documentType) {
        return NextResponse.json(
          { error: "Identity and address proof types must be different." },
          { status: 400 },
        );
      }
      const documentNumber = String(formData.get("documentNumber") || "").trim();
      if (!documentNumber || documentNumber.length > 64) {
        return NextResponse.json({ error: "A valid document number is required." }, { status: 400 });
      }
      const front = await validatedFile(formData.get("front"));
      const back = await validatedFile(formData.get("back"), false);
      if (!front) throw new Error("Front document is required.");
      const folder = category === "identity" ? "idProofs" : "addressProofs";
      const save = async (file: NonNullable<typeof front>, side: "front" | "back") => {
        const path = `employees/${guard.employeeDocId}/${folder}/${crypto.randomUUID()}_${side}.${file.extension}`;
        await storage.bucket().file(path).save(file.buffer, {
          resumable: false,
          metadata: { contentType: file.contentType, cacheControl: "no-store, private, max-age=0", metadata: {} },
        });
        uploadedPaths.push(path);
        return path;
      };
      const frontPath = await save(front, "front");
      const backPath = back ? await save(back, "back") : null;
      const fields = category === "identity"
        ? {
            identityProofType: documentType,
            identityProofNumber: documentNumber,
            identityProofUrlFront: frontPath,
            ...(backPath && { identityProofUrlBack: backPath }),
          }
        : {
            addressProofType: documentType,
            addressProofNumber: documentNumber,
            addressProofUrlFront: frontPath,
            ...(backPath && { addressProofUrlBack: backPath }),
          };
      batch.update(employeeRef, fields);
      batch.set(employeeRef.collection("documents").doc(), {
        category,
        documentType,
        documentNumberMasked: documentNumber.slice(-4).padStart(documentNumber.length, "*"),
        frontStoragePath: frontPath,
        backStoragePath: backPath,
        purpose: category === "identity" ? "client_identity_registration" : "client_address_registration",
        employeeProvided: true,
        verificationStatus: "not_independently_verified",
        uploadedAt: now,
        uploadedThroughEnrollmentId: null,
        retentionPolicy: "employment_plus_90_days",
        accessClassification: "client_shareable_with_grant",
        status: "active",
      });
    }

    batch.set(db.collection("sensitiveDocumentAuditLogs").doc(), {
      action: "guard_document_submitted",
      employeeDocId: guard.employeeDocId,
      category,
      purpose: category === "aadhaar" ? "esic_epf_registration" : `client_${category}_registration`,
      actorUid: guard.uid,
      actorType: "guard",
      at: now,
    });
    batch.update(employeeRef, {
      [`documentCompletion.${category}`]: "complete",
      "documentCompletion.updatedAt": now,
      updatedAt: now,
    });
    await batch.commit();
    if (category === "aadhaar") {
      const previousPaths = restrictedAadhaarPaths(
        aadhaarSnap.data() as Record<string, unknown> | undefined,
        guard.employeeDocId,
      ).filter((path) => !uploadedPaths.includes(path));
      await Promise.all(previousPaths.map(deleteStorageObjectIfPresent));
    }
    return NextResponse.json(
      { status: "complete", category },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    await Promise.all(uploadedPaths.map((path) => deleteStorageObjectIfPresent(path)));
    const internal = isAadhaarInfrastructureError(error);
    const message = internal ? "Aadhaar could not be securely stored." : error instanceof Error ? error.message : "Document upload failed.";
    const status = internal ? 500 : message.includes("Guard access required") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
