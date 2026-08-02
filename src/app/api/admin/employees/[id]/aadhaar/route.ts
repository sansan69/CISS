import { NextResponse } from "next/server";
import { requireAadhaarAdministrator } from "@/lib/server/auth";
import {
  AADHAAR_CONSENT_TEXT_HASH,
  AADHAAR_CONSENT_VERSION,
  deleteStorageObjectIfPresent,
  decryptAadhaarNumber,
  encryptAadhaarNumber,
  isAadhaarInfrastructureError,
  restrictedAadhaarPaths,
  restrictedAadhaarDocument,
  saveRestrictedAadhaarBuffer,
  validateAadhaarNumber,
} from "@/lib/server/aadhaar";
import crypto from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { Timestamp } from "firebase-admin/firestore";
import {
  findEmployeeById,
  requireRecentAuthentication,
} from "@/lib/server/employee-document-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAadhaarAdministrator(request);
    const { id } = await params;
    const { db } = await import("@/lib/firebaseAdmin");
    const employee = await findEmployeeById(db, id);
    if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    const privateSnap = await db.collection("employeeAadhaarPrivate").doc(employee.id).get();
    const privateData = privateSnap.data() as Record<string, unknown> | undefined;
    const frontDocument = restrictedAadhaarDocument(privateData, employee.id, "front");
    const backDocument = restrictedAadhaarDocument(privateData, employee.id, "back");
    if (!privateSnap.exists || privateData?.status !== "complete" || !frontDocument) {
      return NextResponse.json(
        { status: "missing", hasFrontDocument: Boolean(frontDocument), hasBackDocument: Boolean(backDocument) },
        { headers: { "Cache-Control": "no-store, private" } },
      );
    }
    const pendingCorrections = await employee.ref
      .collection("aadhaarCorrectionRequests")
      .where("status", "==", "pending")
      .limit(1)
      .get();
    const pendingCorrection = pendingCorrections.docs[0];
    const correctionRequest = pendingCorrection
      ? {
          id: pendingCorrection.id,
          reason: String(pendingCorrection.data().reason || "Correction requested."),
          requestedAt: pendingCorrection.data().requestedAt || null,
        }
      : null;
    const url = new URL(request.url);
    const reveal = url.searchParams.get("reveal") === "true";
    if (!reveal) {
      return NextResponse.json(
        {
          status: "complete",
          canReveal: true,
          hasDocument: true,
          hasFrontDocument: true,
          hasBackDocument: Boolean(backDocument),
          hasConsent: typeof privateSnap.data()?.consentId === "string",
          correctionRequest,
        },
        { headers: { "Cache-Control": "no-store, private" } },
      );
    }
    requireRecentAuthentication(admin);
    const data = privateSnap.data() as Parameters<typeof decryptAadhaarNumber>[0];
    const aadhaarNumber = await decryptAadhaarNumber(data);
    await db.collection("sensitiveDocumentAuditLogs").add({
      action: "aadhaar_number_revealed",
      employeeDocId: employee.id,
      category: "aadhaar",
      purpose: "esic_epf_registration",
      actorUid: admin.uid,
      actorType: "admin",
      at: new Date(),
    });
    return NextResponse.json(
      { status: "complete", aadhaarNumber },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    const internal = isAadhaarInfrastructureError(error);
    const message = internal ? "Aadhaar could not be securely retrieved." : error instanceof Error ? error.message : "Aadhaar request failed.";
    const status = internal ? 500 : message.includes("access required") ? 403 : message.includes("Recent authentication") ? 401 : 400;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let newAadhaarPaths: string[] = [];
  let consentEvidencePath: string | null = null;
  try {
    const admin = await requireAadhaarAdministrator(request);
    const { id } = await params;
    const formData = await request.formData();
    const { db, storage } = await import("@/lib/firebaseAdmin");
    const employee = await findEmployeeById(db, id);
    if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    const employeeData = employee.data() as Record<string, unknown>;
    const existing = await db.collection("employeeAadhaarPrivate").doc(employee.id).get();
    const replace = formData.get("replace") === "true";
    const backOnly = formData.get("backOnly") === "true";
    const correctionRequestId = String(formData.get("correctionRequestId") || "").trim();
    const existingComplete = existing.exists && existing.data()?.status === "complete";
    if (backOnly) {
      if (!existingComplete || replace || correctionRequestId) {
        return NextResponse.json({ error: "A complete Aadhaar record is required before adding the back side." }, { status: 400 });
      }
      const backFile = formData.get("back");
      if (!(backFile instanceof File)) {
        return NextResponse.json({ error: "Aadhaar back side is required." }, { status: 400 });
      }
      const storedBack = await saveRestrictedAadhaarBuffer({
        employeeDocId: employee.id,
        buffer: Buffer.from(await backFile.arrayBuffer()),
        originalFileName: backFile.name,
      });
      newAadhaarPaths = [storedBack.documentStoragePath];
      const now = Timestamp.now();
      const existingData = existing.data() as Record<string, unknown>;
      const existingAdditionalDocuments = Array.isArray(existingData.additionalDocuments)
        ? existingData.additionalDocuments.filter((value): value is Record<string, unknown> => !!value && typeof value === "object" && (value as Record<string, unknown>).side !== "back")
        : [];
      const batch = db.batch();
      batch.update(db.collection("employeeAadhaarPrivate").doc(employee.id), {
        additionalDocuments: [
          ...existingAdditionalDocuments,
          {
            side: "back",
            documentStoragePath: storedBack.documentStoragePath,
            originalFileName: storedBack.originalFileName,
            contentType: storedBack.contentType,
          },
        ],
        updatedAt: now,
      });
      batch.update(employee.ref, { updatedAt: now });
      batch.set(db.collection("sensitiveDocumentAuditLogs").doc(), {
        action: "aadhaar_back_submitted",
        employeeDocId: employee.id,
        category: "aadhaar",
        side: "back",
        purpose: "esic_epf_registration",
        actorUid: admin.uid,
        actorType: "admin",
        at: now,
      });
      await batch.commit();
      const previousBackPath = restrictedAadhaarDocument(existingData, employee.id, "back")?.documentStoragePath;
      if (previousBackPath && previousBackPath !== storedBack.documentStoragePath) {
        await Promise.allSettled([deleteStorageObjectIfPresent(previousBackPath)]);
      }
      return NextResponse.json(
        { status: "complete", hasFrontDocument: true, hasBackDocument: true },
        { headers: { "Cache-Control": "no-store, private" } },
      );
    }
    if (existingComplete && !replace) {
      return NextResponse.json({ error: "Aadhaar is already on file." }, { status: 409 });
    }
    if (replace && !correctionRequestId) {
      return NextResponse.json({ error: "A correction request reference is required." }, { status: 400 });
    }
    const correctionRef = correctionRequestId
      ? employee.ref.collection("aadhaarCorrectionRequests").doc(correctionRequestId)
      : null;
    if (replace && correctionRef) {
      const correction = await correctionRef.get();
      if (!correction.exists || correction.data()?.status !== "pending") {
        return NextResponse.json({ error: "A pending employee correction request is required." }, { status: 400 });
      }
    }
    const number = validateAadhaarNumber(String(formData.get("aadhaarNumber") || ""));
    const aadhaarFrontFile = formData.get("front");
    const aadhaarBackFile = formData.get("back");
    if (!(aadhaarFrontFile instanceof File) || !(aadhaarBackFile instanceof File)) {
      return NextResponse.json({ error: "Upload both Aadhaar front and back sides." }, { status: 400 });
    }

    const suppliedConsentId = String(formData.get("consentId") || "").trim();
    const existingConsentId = replace && typeof existing.data()?.consentId === "string"
      ? String(existing.data()?.consentId)
      : "";
    const effectiveConsentId = suppliedConsentId || existingConsentId;
    const signedConsent = formData.get("signedConsent");
    const consentRef = effectiveConsentId
      ? employee.ref.collection("consents").doc(effectiveConsentId)
      : employee.ref.collection("consents").doc();
    if (effectiveConsentId) {
      const consent = await consentRef.get();
      const consentData = consent.data();
      if (!consent.exists || consentData?.type !== "aadhaar_esic_epf" || consentData?.status !== "active") {
        return NextResponse.json({ error: "A valid employee Aadhaar consent record is required." }, { status: 400 });
      }
    } else {
      if (!(signedConsent instanceof File)) {
        return NextResponse.json({ error: "Upload the employee's signed Aadhaar consent form." }, { status: 400 });
      }
      const buffer = Buffer.from(await signedConsent.arrayBuffer());
      if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error("Signed consent must be no larger than 5 MB.");
      const detected = await fileTypeFromBuffer(buffer);
      const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
      const extension = detected && extensions[detected.mime];
      if (!detected || !extension) throw new Error("Signed consent must be JPEG, PNG, or PDF.");
      consentEvidencePath = `restrictedEmployeeConsent/${employee.id}/${crypto.randomUUID()}.${extension}`;
      await storage.bucket().file(consentEvidencePath).save(buffer, {
        resumable: false,
        metadata: { contentType: detected.mime, cacheControl: "no-store, private, max-age=0", metadata: {} },
      });
    }

    const aadhaarFrontBuffer = Buffer.from(await aadhaarFrontFile.arrayBuffer());
    const aadhaarBackBuffer = Buffer.from(await aadhaarBackFile.arrayBuffer());
    const encryption = await encryptAadhaarNumber(number);
    const storedFront = await saveRestrictedAadhaarBuffer({
      employeeDocId: employee.id,
      buffer: aadhaarFrontBuffer,
      originalFileName: aadhaarFrontFile.name,
    });
    const storedBack = await saveRestrictedAadhaarBuffer({
      employeeDocId: employee.id,
      buffer: aadhaarBackBuffer,
      originalFileName: aadhaarBackFile.name,
    });
    newAadhaarPaths = [storedFront.documentStoragePath, storedBack.documentStoragePath];
    const now = Timestamp.now();
    const batch = db.batch();
    if (!effectiveConsentId) {
      batch.set(consentRef, {
        type: "aadhaar_esic_epf",
        noticeVersion: AADHAAR_CONSENT_VERSION,
        noticeTextHash: AADHAAR_CONSENT_TEXT_HASH,
        accepted: true,
        acceptedAt: now,
        employeeName: employeeData.fullName || employeeData.name || employee.id,
        signatureStoragePath: consentEvidencePath,
        source: "admin_uploaded_signed_form",
        employeeId: employeeData.employeeId || employee.id,
        uploaderUid: admin.uid,
        status: "active",
      });
    }
    batch.set(db.collection("employeeAadhaarPrivate").doc(employee.id), {
      employeeDocId: employee.id,
      ...encryption,
      aadhaarLast4: number.slice(-4),
      documentStoragePath: storedFront.documentStoragePath,
      originalFileName: storedFront.originalFileName,
      contentType: storedFront.contentType,
      additionalDocuments: [{
        side: "back",
        documentStoragePath: storedBack.documentStoragePath,
        originalFileName: storedBack.originalFileName,
        contentType: storedBack.contentType,
      }],
      purpose: "esic_epf_registration",
      employeeProvided: true,
      verificationStatus: "not_independently_verified",
      consentId: consentRef.id,
      uploadedByType: "admin",
      uploadedByUid: admin.uid,
      uploadedAt: existing.data()?.uploadedAt || now,
      updatedAt: now,
      retentionPolicy: "employment_plus_90_days",
      status: "complete",
    });
    batch.update(employee.ref, {
      "documentCompletion.aadhaar": "complete",
      "documentCompletion.updatedAt": now,
      updatedAt: now,
    });
    batch.set(db.collection("sensitiveDocumentAuditLogs").doc(), {
      action: existingComplete ? "aadhaar_replaced" : "aadhaar_admin_submitted",
      employeeDocId: employee.id,
      category: "aadhaar",
      purpose: "esic_epf_registration",
      actorUid: admin.uid,
      actorType: "admin",
      correctionRequestId: replace ? correctionRequestId : null,
      at: now,
    });
    if (replace && correctionRef) {
      batch.update(correctionRef, {
        status: "resolved",
        resolvedAt: now,
        resolvedByUid: admin.uid,
      });
    }
    await batch.commit();
    const previousPaths = restrictedAadhaarPaths(
      existing.data() as Record<string, unknown> | undefined,
      employee.id,
    ).filter((path) => !newAadhaarPaths.includes(path));
    await Promise.allSettled(previousPaths.map(deleteStorageObjectIfPresent));
    return NextResponse.json(
      { status: "complete", hasFrontDocument: true, hasBackDocument: true },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    await Promise.all([
      ...newAadhaarPaths.map(deleteStorageObjectIfPresent),
      consentEvidencePath ? deleteStorageObjectIfPresent(consentEvidencePath) : Promise.resolve(),
    ]);
    const internal = isAadhaarInfrastructureError(error);
    const message = internal ? "Aadhaar could not be securely stored." : error instanceof Error ? error.message : "Aadhaar update failed.";
    const status = internal ? 500 : message.includes("access required") ? 403 : 400;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAadhaarAdministrator(request);
    requireRecentAuthentication(admin);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 10 || reason.length > 500) {
      return NextResponse.json({ error: "A deletion reason between 10 and 500 characters is required." }, { status: 400 });
    }
    const { db } = await import("@/lib/firebaseAdmin");
    const employee = await findEmployeeById(db, id);
    if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    const privateRef = db.collection("employeeAadhaarPrivate").doc(employee.id);
    const privateSnap = await privateRef.get();
    if (!privateSnap.exists) return NextResponse.json({ error: "Aadhaar is not on file." }, { status: 404 });
    const documentPaths = restrictedAadhaarPaths(
      privateSnap.data() as Record<string, unknown> | undefined,
      employee.id,
    );
    const now = Timestamp.now();
    const batch = db.batch();
    batch.delete(privateRef);
    batch.update(employee.ref, {
      "documentCompletion.aadhaar": "missing",
      "documentCompletion.updatedAt": now,
      updatedAt: now,
    });
    batch.set(db.collection("sensitiveDocumentAuditLogs").doc(), {
      action: "aadhaar_deleted",
      employeeDocId: employee.id,
      category: "aadhaar",
      purpose: "esic_epf_registration",
      actorUid: admin.uid,
      actorType: "admin",
      reason,
      at: now,
    });
    await batch.commit();
    await Promise.all(documentPaths.map(deleteStorageObjectIfPresent));
    return NextResponse.json({ status: "deleted" }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Aadhaar deletion failed.";
    const status = message.includes("access required") ? 403 : message.includes("Recent authentication") ? 401 : 400;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
