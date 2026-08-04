import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { normalizeText } from "@/lib/server/mobile-api-utils";
import { documentReference, normalizeEmployeeDocumentFields } from "@/lib/employee-document-fields";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
    const { id } = await params;

    if (!id || !id.trim()) {
      return NextResponse.json(
        { error: "Employee ID is required." },
        { status: 400 },
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // Try direct document lookup by Firestore ID first
    const byDocId = await adminDb.collection("employees").doc(id.trim()).get();
    if (byDocId.exists) {
      const data = byDocId.data()!;
      return NextResponse.json(_serializeEmployee(byDocId.id, data));
    }

    // Fallback: search by employeeId, employeeCode, or guardId
    const searchFields = ["employeeId", "employeeCode", "guardId"];
    for (const field of searchFields) {
      const snapshot = await adminDb
        .collection("employees")
        .where(field, "==", id.trim())
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return NextResponse.json(_serializeEmployee(doc.id, doc.data()));
      }
    }

    return NextResponse.json(
      { error: "Employee not found." },
      { status: 404 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error.";
    console.error("[admin/employees/[id]]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function _serializeEmployee(
  docId: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const joiningDate = data.joiningDate
    ? typeof data.joiningDate === "object" &&
      typeof (data.joiningDate as any).toDate === "function"
      ? (data.joiningDate as any).toDate().toISOString()
      : String(data.joiningDate)
    : null;

  const documentFields = normalizeEmployeeDocumentFields(data);
  const docUrl = (field: unknown): string | null => documentReference(field) ?? null;

  return {
    id: docId,
    name: normalizeText(data.name || data.fullName),
    fullName: normalizeText(data.fullName || data.name),
    employeeId: normalizeText(
      data.employeeId || data.employeeCode || data.guardId || docId,
    ),
    employeeCode: normalizeText(data.employeeCode || data.guardId),
    phoneNumber: normalizeText(
      data.phoneNumber || data.mobileNumber || data.phone,
    ),
    email: normalizeText(data.email || data.emailAddress),
    clientId: normalizeText(data.clientId),
    clientName: normalizeText(data.clientName),
    district: normalizeText(data.district),
    siteName: normalizeText(data.siteName || data.assignedSiteName),
    status: normalizeText(data.status) || "Active",
    address: normalizeText(data.fullAddress || data.address),
    dateOfJoining: joiningDate,
    gender: normalizeText(data.gender),
    guardAuthUid: normalizeText(data.guardAuthUid),
    // ── Document fields ──────────────────────────────────────────
    idProofType: normalizeText(documentFields.identityProofType),
    idProofNumber: normalizeText(documentFields.identityProofNumber),
    idProofFrontUrl: docUrl(documentFields.identityProofUrlFront),
    idProofBackUrl: docUrl(documentFields.identityProofUrlBack),
    // Keep both the legacy response names and the canonical names so older
    // admin consumers do not silently lose uploaded documents.
    identityProofType: normalizeText(documentFields.identityProofType),
    identityProofNumber: normalizeText(documentFields.identityProofNumber),
    identityProofUrlFront: docUrl(documentFields.identityProofUrlFront),
    identityProofUrlBack: docUrl(documentFields.identityProofUrlBack),
    addressProofType: normalizeText(documentFields.addressProofType),
    addressProofNumber: normalizeText(documentFields.addressProofNumber),
    addressProofFrontUrl: docUrl(documentFields.addressProofUrlFront),
    addressProofBackUrl: docUrl(documentFields.addressProofUrlBack),
    addressProofUrlFront: docUrl(documentFields.addressProofUrlFront),
    addressProofUrlBack: docUrl(documentFields.addressProofUrlBack),
    signatureUrl: docUrl(documentFields.signatureUrl),
    profilePhotoUrl: docUrl(documentFields.profilePictureUrl),
    profilePictureUrl: docUrl(documentFields.profilePictureUrl),
    bankPassbookStatementUrl: docUrl(documentFields.bankPassbookStatementUrl),
    panCardDocumentUrl: docUrl(documentFields.panCardDocumentUrl),
    serviceBookDocumentUrl: docUrl(documentFields.serviceBookDocumentUrl),
    armsLicenseDocumentUrl: docUrl(documentFields.armsLicenseDocumentUrl),
    passportDocumentUrl: docUrl(documentFields.passportDocumentUrl),
    policeClearanceCertificateUrl: docUrl(documentFields.policeClearanceCertificateUrl),
    // ── Bank fields ──────────────────────────────────────────────
    bankAccountNumber: normalizeText(data.bankAccountNumber),
    bankIfscCode: normalizeText(data.bankIfscCode),
    bankName: normalizeText(data.bankName),
  };
}
