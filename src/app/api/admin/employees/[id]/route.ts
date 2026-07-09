import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { normalizeText } from "@/lib/server/mobile-api-utils";
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

  const docUrl = (field: unknown): string | null => {
    if (typeof field === "string" && field.trim()) return field.trim();
    if (
      field &&
      typeof field === "object" &&
      "url" in (field as Record<string, unknown>)
    ) {
      const url = (field as Record<string, unknown>).url;
      return typeof url === "string" && url.trim() ? url.trim() : null;
    }
    return null;
  };

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
    idProofType: normalizeText(data.idProofType),
    idProofNumber: normalizeText(data.idProofNumber),
    idProofFrontUrl: docUrl(data.idProofFrontUrl ?? data.idProofFront),
    idProofBackUrl: docUrl(data.idProofBackUrl ?? data.idProofBack),
    addressProofType: normalizeText(data.addressProofType),
    addressProofNumber: normalizeText(data.addressProofNumber),
    addressProofFrontUrl: docUrl(
      data.addressProofFrontUrl ?? data.addressProofFront,
    ),
    addressProofBackUrl: docUrl(
      data.addressProofBackUrl ?? data.addressProofBack,
    ),
    signatureUrl: docUrl(data.signatureUrl ?? data.signature),
    profilePhotoUrl: docUrl(data.profilePhotoUrl ?? data.profilePictureUrl),
    // ── Bank fields ──────────────────────────────────────────────
    bankAccountNumber: normalizeText(data.bankAccountNumber),
    bankIfscCode: normalizeText(data.bankIfscCode),
    bankName: normalizeText(data.bankName),
  };
}
