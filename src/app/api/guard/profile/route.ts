import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
import { documentCompletionFromEmployee } from "@/lib/server/aadhaar";
import { normalizeEmployeeDocumentFields } from "@/lib/employee-document-fields";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const empDoc = await adminDb.doc(`employees/${guard.employeeDocId}`).get();
    if (!empDoc.exists) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    const empData = empDoc.data()!;
    const documentFields = normalizeEmployeeDocumentFields(empData);
    const aadhaarPrivate = await adminDb
      .collection("employeeAadhaarPrivate")
      .doc(guard.employeeDocId)
      .get();
    const documentStatus = documentCompletionFromEmployee(
      empData,
      aadhaarPrivate.exists && aadhaarPrivate.data()?.status === "complete",
    );
    const missingDocuments = (
      Object.entries(documentStatus) as [keyof typeof documentStatus, string][]
    )
      .filter(([, status]) => status === "missing")
      .map(([category]) => category);

    let joiningDate: string | undefined;
    if (empData.joiningDate) {
      if (empData.joiningDate.toDate) {
        joiningDate = empData.joiningDate.toDate().toISOString();
      } else if (typeof empData.joiningDate === "string") {
        joiningDate = empData.joiningDate;
      }
    }

    return NextResponse.json({
      fullName: empData.fullName ?? empData.name ?? "",
      employeeId: guard.employeeId,
      clientName: empData.clientName ?? "",
      district: empData.district ?? "",
      phoneNumber: empData.phoneNumber ?? "",
      status: empData.status ?? "",
      gender: empData.gender ?? null,
      joiningDate: joiningDate ?? null,
      resourceIdNumber: empData.resourceIdNumber ?? null,
      profilePhotoUrl: documentFields.profilePictureUrl ?? null,
      address: empData.fullAddress ?? empData.address ?? null,
      emailAddress: empData.emailAddress ?? null,
      // ── Document fields ─────────────────────────────────────────────
      idProofType: documentFields.identityProofType ?? null,
      idProofNumber: documentFields.identityProofNumber ?? null,
      idProofFrontUrl: documentFields.identityProofUrlFront ?? null,
      idProofBackUrl: documentFields.identityProofUrlBack ?? null,
      addressProofType: documentFields.addressProofType ?? null,
      addressProofNumber: documentFields.addressProofNumber ?? null,
      addressProofFrontUrl: documentFields.addressProofUrlFront ?? null,
      addressProofBackUrl: documentFields.addressProofUrlBack ?? null,
      signatureUrl: documentFields.signatureUrl ?? null,
      bankAccountNumber: empData.bankAccountNumber ?? null,
      bankIfscCode: empData.bankIfscCode ?? null,
      bankName: empData.bankName ?? null,
      documentStatus,
      missingDocuments,
      enrollmentPolicy:
        empData.enrollmentPolicy?.version === "three-proof-v1"
          ? "three-proof-v1"
          : "legacy",
    }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Guard access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[guard/profile]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
