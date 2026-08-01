import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
import { documentCompletionFromEmployee } from "@/lib/server/aadhaar";
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

    // Normalise document URLs from the employee record.
    // Both URL fields and Firestore upload metadata maps are supported.
    const docUrl = (field: unknown): string | null => {
      if (typeof field === "string" && field.trim()) return field.trim();
      if (field && typeof field === "object" && "url" in (field as Record<string, unknown>)) {
        const url = (field as Record<string, unknown>).url;
        return typeof url === "string" && url.trim() ? url.trim() : null;
      }
      return null;
    };

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
      profilePhotoUrl: empData.profilePhotoUrl ?? empData.profilePictureUrl ?? null,
      address: empData.fullAddress ?? empData.address ?? null,
      emailAddress: empData.emailAddress ?? null,
      // ── Document fields ─────────────────────────────────────────────
      idProofType: empData.idProofType ?? null,
      idProofNumber: empData.idProofNumber ?? null,
      idProofFrontUrl: docUrl(empData.idProofFrontUrl ?? empData.idProofFront),
      idProofBackUrl: docUrl(empData.idProofBackUrl ?? empData.idProofBack),
      addressProofType: empData.addressProofType ?? null,
      addressProofNumber: empData.addressProofNumber ?? null,
      addressProofFrontUrl: docUrl(empData.addressProofFrontUrl ?? empData.addressProofFront),
      addressProofBackUrl: docUrl(empData.addressProofBackUrl ?? empData.addressProofBack),
      signatureUrl: docUrl(empData.signatureUrl ?? empData.signature),
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
