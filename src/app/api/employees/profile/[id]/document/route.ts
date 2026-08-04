import { NextResponse } from "next/server";
import { hasAdminAccess, hasClientAccess, hasFieldOfficerAccess, verifyRequestAuth } from "@/lib/server/auth";
import { findEmployeeById } from "@/lib/server/employee-document-access";
import { assertGuardProfileScope } from "@/lib/server/guard-profile-view";
import { documentReference, normalizeEmployeeDocumentFields } from "@/lib/employee-document-fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORY_FIELDS = {
  "profile-picture": ["profilePictureUrl", "profilePhotoUrl", "profilePhoto"],
  signature: ["signatureUrl", "signature", "signatureDocumentUrl"],
  "identity-front": [
    "identityProofUrlFront",
    "idProofFrontUrl",
    "idProofFront",
    "idProofDocumentUrlFront",
    "idProofDocumentUrl",
    "identityProofDocumentUrlFront",
  ],
  "identity-back": [
    "identityProofUrlBack",
    "idProofBackUrl",
    "idProofBack",
    "idProofDocumentUrlBack",
    "identityProofDocumentUrlBack",
  ],
  "address-front": [
    "addressProofUrlFront",
    "addressProofFrontUrl",
    "addressProofFront",
    "addressProofDocumentUrlFront",
  ],
  "address-back": [
    "addressProofUrlBack",
    "addressProofBackUrl",
    "addressProofBack",
    "addressProofDocumentUrlBack",
  ],
  bank: [
    "bankPassbookStatementUrl",
    "bankPassbookStatement",
    "bankDocumentUrl",
    "bankPassbookUrl",
    "passbookDocumentUrl",
    "bankProofUrl",
    "bankStatementUrl",
  ],
  "pan-card": ["panCardDocumentUrl", "panCardUrl", "panDocumentUrl"],
  "service-book": ["serviceBookDocumentUrl", "serviceBookUrl", "serviceBookSourceUrl"],
  "arms-license": ["armsLicenseDocumentUrl", "armsLicenseUrl", "armsLicenseSourceUrl", "armsLicenseCopyUrl"],
  passport: ["passportDocumentUrl", "passportUrl", "passportCopyUrl"],
  "police-clearance": [
    "policeClearanceCertificateUrl",
    "policeClearanceUrl",
    "pccUrl",
    "policeCertificateUrl",
  ],
} as const;

const CLIENT_DOCUMENT_CATEGORIES = new Set([
  "identity-front",
  "identity-back",
  "address-front",
  "address-back",
]);

function resolveStoragePath(source: string, bucketName: string) {
  const trimmed = source.trim();
  const allowed = /^(employees|enrollments)\/[A-Za-z0-9_-]+\/(profilePictures|signatures|idProofs|addressProofs|bankDocuments|panCards|serviceBooks|armsLicenses|passports|policeCertificates)\/[A-Za-z0-9._-]+$/;
  if (allowed.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Invalid document reference.");
  }
  if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com") {
    throw new Error("Document is not stored in the configured Firebase bucket.");
  }
  const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
  if (!match || decodeURIComponent(match[1]!) !== bucketName) {
    throw new Error("Document belongs to a different storage bucket.");
  }
  const path = decodeURIComponent(match[2]!);
  if (!allowed.test(path)) throw new Error("Document path is not allowed.");
  return path;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded) && !hasClientAccess(decoded)) {
      return NextResponse.json({ error: "Guard profile access required." }, { status: 403 });
    }
    const category = new URL(request.url).searchParams.get("category") || "";
    if (!(category in CATEGORY_FIELDS)) {
      return NextResponse.json({ error: "A valid document category is required." }, { status: 400 });
    }
    if (hasClientAccess(decoded) && !CLIENT_DOCUMENT_CATEGORIES.has(category)) {
      return NextResponse.json({ error: "This document is not available to client accounts." }, { status: 403 });
    }
    const { id } = await params;
    const { db, storage } = await import("@/lib/firebaseAdmin");
    const employee = await findEmployeeById(db, id);
    if (!employee?.exists) return NextResponse.json({ error: "Guard profile not found." }, { status: 404 });
    const data = employee.data() as Record<string, unknown>;
    await assertGuardProfileScope(db, decoded, data);

    const documentFields = normalizeEmployeeDocumentFields(data);
    const normalizedSources: Record<keyof typeof CATEGORY_FIELDS, unknown> = {
      "profile-picture": documentFields.profilePictureUrl,
      signature: documentFields.signatureUrl,
      "identity-front": documentFields.identityProofUrlFront,
      "identity-back": documentFields.identityProofUrlBack,
      "address-front": documentFields.addressProofUrlFront,
      "address-back": documentFields.addressProofUrlBack,
      bank: documentFields.bankPassbookStatementUrl,
      "pan-card": documentFields.panCardDocumentUrl,
      "service-book": documentFields.serviceBookDocumentUrl,
      "arms-license": documentFields.armsLicenseDocumentUrl,
      passport: documentFields.passportDocumentUrl,
      "police-clearance": documentFields.policeClearanceCertificateUrl,
    };
    const fields = CATEGORY_FIELDS[category as keyof typeof CATEGORY_FIELDS];
    const source = documentReference(normalizedSources[category as keyof typeof CATEGORY_FIELDS])
      || fields.map((field) => documentReference(data[field])).find(Boolean);
    if (typeof source !== "string") {
      return NextResponse.json({ error: "Document is not on file." }, { status: 404 });
    }
    const path = resolveStoragePath(source, storage.bucket().name);
    const [buffer] = await storage.bucket().file(path).download();
    const [metadata] = await storage.bucket().file(path).getMetadata();
    const contentType = typeof metadata.contentType === "string" ? metadata.contentType : "application/octet-stream";
    const shouldDownload = new URL(request.url).searchParams.get("download") === "true";
    await db.collection("sensitiveDocumentAuditLogs").add({
      action: shouldDownload ? "guard_profile_document_downloaded" : "guard_profile_document_viewed",
      employeeDocId: employee.id,
      category,
      actorUid: decoded.uid,
      actorType: decoded.role || "staff",
      at: new Date(),
    });

    const rawFilename = path.split("/").pop() || `${category}-document`;
    const filename = rawFilename.replace(/[^A-Za-z0-9._-]/g, "_");
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "no-store, private, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load document.";
    const status = message.includes("scope") || message.includes("access") || message.includes("districts") ? 403 : message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
