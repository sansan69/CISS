import { NextRequest, NextResponse } from "next/server";
import {
  canonicalizeDistrictName,
  getDefaultDistrictSuggestions,
  isRecognizedDistrictName,
} from "@/lib/districts";
import { generateEmployeeId } from "@/lib/employee-id";
import {
  fetchEnrollmentConfig,
  validateEnrollmentSubmissionAgainstConfig,
} from "@/lib/enrollment-config";
import { generateQrCodeDataUrl } from "@/lib/qr";
import { REGION_CODE } from "@/lib/runtime-config";
import { isLngClientName, LNG_CLIENT_NAME } from "@/lib/constants";
import {
  buildEmployeeIdRegistryRecord,
  employeeIdExists,
  employeeIdRegistryRef,
} from "@/lib/server/employee-id-registry";
import {
  enrollmentSubmissionSchema,
  type EnrollmentSubmission,
} from "@/types/enrollment";
import { enrollmentDraftTokenMatches } from "@/lib/server/enrollment-draft";
import {
  requireAadhaarAdministratorToken,
  verifyRequestAuth,
  type AppDecodedToken,
} from "@/lib/server/auth";
import {
  AADHAAR_CONSENT_TEXT_HASH,
  deleteStorageObjectIfPresent,
  encryptAadhaarNumber,
  moveAadhaarSourceToRestrictedStorage,
} from "@/lib/server/aadhaar";
import { assertEnrollmentDocumentReferences } from "@/lib/server/enrollment-documents";
import {
  ENROLLMENT_TERMS_TEXT_HASH,
  ENROLLMENT_TERMS_VERSION,
  GUARD_UNDERTAKING_TEXT_HASH,
  GUARD_UNDERTAKING_VERSION,
} from "@/lib/server/enrollment-consents";
export const runtime = "nodejs";

type RestrictedEnrollmentAadhaar = Awaited<ReturnType<typeof moveAadhaarSourceToRestrictedStorage>>;

function buildSearchableFields(data: EnrollmentSubmission, employeeId: string) {
  const nameParts = `${data.firstName} ${data.lastName}`
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);

  return Array.from(
    new Set([
      ...nameParts,
      data.firstName.toUpperCase(),
      data.lastName.toUpperCase(),
      employeeId.toUpperCase(),
      data.phoneNumber,
    ]),
  );
}

async function generateUniqueEmployeeId(
  adminDb: FirebaseFirestore.Firestore,
  clientName: string,
) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const employeeId = generateEmployeeId(clientName);
    if (!(await employeeIdExists(adminDb, employeeId))) {
      return employeeId;
    }
  }

  throw new Error("Could not generate a unique employee ID. Please try again.");
}

function splitFullNameForStorage(rawFullName: string) {
  const parts = rawFullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0]!, lastName: parts[0]! };
  }

  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

export async function POST(request: NextRequest) {
  const movedAadhaarDocuments: RestrictedEnrollmentAadhaar[] = [];
  try {
    const authorization = request.headers.get("authorization");
    let isAdminSubmission = false;
    let submissionActor: AppDecodedToken | null = null;

    if (authorization) {
      try {
        submissionActor = requireAadhaarAdministratorToken(
          await verifyRequestAuth(request, true),
        );
        isAdminSubmission = true;
      } catch {
        return NextResponse.json(
          { error: "The designated Aadhaar administrator account is required." },
          { status: 403 },
        );
      }
    }

    const rawPayload = (await request.json()) as Record<string, unknown>;
    const draftId = String(rawPayload.enrollmentDraftId ?? "").trim();
    const draftToken = String(rawPayload.enrollmentUploadToken ?? "");
    if (
      !isAdminSubmission &&
      (!/^[A-Za-z0-9_-]{10,128}$/.test(draftId) || !draftToken)
    ) {
      return NextResponse.json(
        { error: "Enrollment upload session is required." },
        { status: 400 },
      );
    }
    const payload = enrollmentSubmissionSchema.parse(rawPayload);
    const districtSuggestions = getDefaultDistrictSuggestions(REGION_CODE);
    const district = canonicalizeDistrictName(payload.district, districtSuggestions);
    if (!isRecognizedDistrictName(district, districtSuggestions)) {
      return NextResponse.json(
        { error: "Please choose a valid district for this region." },
        { status: 400 },
      );
    }
    const { db: adminDb, storage } = await import("@/lib/firebaseAdmin");
    const { Timestamp } = await import("firebase-admin/firestore");

    const normalizedPhone = payload.phoneNumber.replace(/\D/g, "");
    let draftRef: FirebaseFirestore.DocumentReference | null = null;

    if (!isAdminSubmission) {
      draftRef = adminDb.collection("enrollments").doc(draftId);
      const draftSnap = await draftRef.get();
      const draftData = draftSnap.data() as {
        status?: string;
        phoneNumber?: string;
        tokenHash?: string;
        expiresAt?: { toMillis?: () => number };
      } | undefined;
      if (
        !draftSnap.exists ||
        draftData?.status !== "draft" ||
        draftData.phoneNumber !== normalizedPhone ||
        (draftData.expiresAt?.toMillis?.() ?? 0) <= Date.now() ||
        !enrollmentDraftTokenMatches(draftToken, draftData.tokenHash)
      ) {
        return NextResponse.json(
          { error: "Enrollment upload session is invalid or has expired." },
          { status: 403 },
        );
      }
    }
    const isLngEnrollment = isLngClientName(payload.clientName);
    const canonicalClientName = isLngEnrollment ? LNG_CLIENT_NAME : payload.clientName;
    const normalizedEmail = payload.emailAddress.trim().toLowerCase();
    const normalizedFullNameInput = payload.fullNameInput?.trim() || "";
    const enrollmentConfig = await fetchEnrollmentConfig(adminDb);
    const configErrors = validateEnrollmentSubmissionAgainstConfig(
      enrollmentConfig,
      payload as unknown as Record<string, unknown>,
      canonicalClientName,
    );
    if (configErrors.length > 0) {
      return NextResponse.json(
        {
          error: "Enrollment form requirements are not satisfied.",
          details: configErrors,
        },
        { status: 400 },
      );
    }

    await assertEnrollmentDocumentReferences(
      payload as unknown as Record<string, unknown>,
      {
        bucketName: storage.bucket().name,
        flow: isAdminSubmission ? "admin" : "public",
        draftId: isAdminSubmission ? undefined : draftId,
        phoneNumber: normalizedPhone,
      },
      storage.bucket(),
    );

    const nameParts =
      isLngEnrollment && normalizedFullNameInput
        ? splitFullNameForStorage(normalizedFullNameInput)
        : {
            firstName: payload.firstName,
            lastName: payload.lastName,
          };

    const phonePromise = adminDb
      .collection("employees")
      .where("phoneNumber", "==", normalizedPhone)
      .limit(1)
      .get();
    const emailPromise = adminDb
      .collection("employees")
      .where("emailAddress", "==", normalizedEmail)
      .limit(1)
      .get();

    const [phoneSnapshot, emailSnapshot] = await Promise.all([
      phonePromise,
      emailPromise,
    ]);

    if (!phoneSnapshot.empty) {
      return NextResponse.json(
        { error: "An employee with this phone number already exists." },
        { status: 409 },
      );
    }

    if (emailSnapshot && !emailSnapshot.empty) {
      return NextResponse.json(
        { error: "An employee with this email address already exists." },
        { status: 409 },
      );
    }

    let employeeId = isLngEnrollment
      ? payload.legacyUniqueId?.trim()
      : undefined;

    if (employeeId) {
      if (await employeeIdExists(adminDb, employeeId)) {
        return NextResponse.json(
          { error: "An employee with this LNG unique ID already exists." },
          { status: 409 },
        );
      }
    } else {
      employeeId = await generateUniqueEmployeeId(adminDb, canonicalClientName);
    }

    const fullName = `${nameParts.firstName.toUpperCase()} ${nameParts.lastName.toUpperCase()}`.trim();
    const qrCodeUrl = await generateQrCodeDataUrl(
      employeeId,
      fullName,
      normalizedPhone,
    );
    const now = Timestamp.now();
    const docRef = adminDb.collection("employees").doc();
    const consentRef = docRef.collection("consents").doc();
    const aadhaarEncryption = await encryptAadhaarNumber(payload.aadharNumber);
    const restrictedAadhaarFront = await moveAadhaarSourceToRestrictedStorage({
      employeeDocId: docRef.id,
      source: payload.aadharCardDocumentUrl,
    });
    movedAadhaarDocuments.push(restrictedAadhaarFront);
    const restrictedAadhaarBack = await moveAadhaarSourceToRestrictedStorage({
      employeeDocId: docRef.id,
      source: payload.aadharCardDocumentBackUrl,
    });
    movedAadhaarDocuments.push(restrictedAadhaarBack);

    const employeeData = {
      employeeId,
      qrCodeUrl,
      searchableFields: buildSearchableFields(
        {
          ...payload,
          firstName: nameParts.firstName,
          lastName: nameParts.lastName,
          phoneNumber: normalizedPhone,
        },
        employeeId,
      ),
      clientName: canonicalClientName,
      firstName: nameParts.firstName.toUpperCase(),
      lastName: nameParts.lastName.toUpperCase(),
      fullName,
      fatherName: payload.fatherName.toUpperCase(),
      motherName: payload.motherName.toUpperCase(),
      joiningDate: Timestamp.fromDate(new Date(payload.joiningDate)),
      dateOfBirth: Timestamp.fromDate(new Date(payload.dateOfBirth)),
      gender: payload.gender,
      maritalStatus: payload.maritalStatus,
      educationalQualification: payload.educationalQualification,
      district,
      fullAddress: payload.fullAddress.toUpperCase(),
      emailAddress: normalizedEmail,
      phoneNumber: normalizedPhone,
      stateCode: REGION_CODE,
      status: "Active",
      createdAt: now,
      updatedAt: now,
      enrollmentPolicy: {
        version: "three-proof-v1",
        applicable: true,
        appliedAt: now,
      },
      documentCompletion: {
        aadhaar: "complete",
        identity: "complete",
        address: "complete",
        updatedAt: now,
      },
      consentCompliance: {
        aadhaarEsicEpfConsentVersion: payload.aadhaarConsentVersion,
        enrollmentTermsVersion: ENROLLMENT_TERMS_VERSION,
        guardUndertakingVersion: payload.guardUndertakingVersion,
        completedAt: now,
      },
      identityProofType: payload.identityProofType,
      identityProofNumber: payload.identityProofNumber,
      identityProofUrlFront: payload.identityProofUrlFront,
      identityProofUrlBack: payload.identityProofUrlBack,
      addressProofType: payload.addressProofType,
      addressProofNumber: payload.addressProofNumber,
      addressProofUrlFront: payload.addressProofUrlFront,
      addressProofUrlBack: payload.addressProofUrlBack,
      signatureUrl: payload.signatureUrl,
      profilePictureUrl: payload.profilePictureUrl,
      publicProfile: {
        fullName,
        employeeId,
        clientName: canonicalClientName,
        profilePictureUrl: payload.profilePictureUrl,
        status: "Active",
      },
      ...(payload.bankAccountNumber && {
        bankAccountNumber: payload.bankAccountNumber,
      }),
      ...(payload.ifscCode && { ifscCode: payload.ifscCode.toUpperCase() }),
      ...(payload.bankName && { bankName: payload.bankName.toUpperCase() }),
      ...(payload.branchName && { branchName: payload.branchName.toUpperCase() }),
      ...(payload.bankPassbookStatementUrl && {
        bankPassbookStatementUrl: payload.bankPassbookStatementUrl,
      }),
      ...(payload.resourceIdNumber && { resourceIdNumber: payload.resourceIdNumber }),
      ...(payload.spouseName && {
        spouseName: payload.spouseName.toUpperCase(),
      }),
      ...(payload.otherQualification && {
        otherQualification: payload.otherQualification.toUpperCase(),
      }),
      ...(payload.panNumber && { panNumber: payload.panNumber.toUpperCase() }),
      ...(payload.nationality && { nationality: payload.nationality.toUpperCase() }),
      ...(payload.identificationMark && {
        identificationMark: payload.identificationMark.toUpperCase(),
      }),
      ...(payload.heightCm && { heightCm: payload.heightCm }),
      ...(payload.weightKg && { weightKg: payload.weightKg }),
      ...(payload.jobDesignation && { jobDesignation: payload.jobDesignation }),
      ...(payload.lngJobDesignation && { lngJobDesignation: payload.lngJobDesignation }),
      ...(payload.serviceBookNumber && { serviceBookNumber: payload.serviceBookNumber }),
      ...(payload.serviceBookDocumentUrl && {
        serviceBookDocumentUrl: payload.serviceBookDocumentUrl,
      }),
      ...(payload.armsLicenseNumber && {
        armsLicenseNumber: payload.armsLicenseNumber.toUpperCase(),
      }),
      ...(payload.armsLicenseDocumentUrl && {
        armsLicenseDocumentUrl: payload.armsLicenseDocumentUrl,
      }),
      ...(payload.passportCountryName && {
        passportCountryName: payload.passportCountryName.toUpperCase(),
      }),
      ...(payload.passportDocumentUrl && {
        passportDocumentUrl: payload.passportDocumentUrl,
      }),
      ...(payload.legacyUniqueId && { legacyUniqueId: payload.legacyUniqueId }),
      ...(payload.epfUanNumber && { epfUanNumber: payload.epfUanNumber }),
      ...(payload.esicNumber && { esicNumber: payload.esicNumber }),
      ...(payload.panCardDocumentUrl && {
        panCardDocumentUrl: payload.panCardDocumentUrl,
      }),
      ...(payload.policeClearanceCertificateUrl && {
        policeClearanceCertificateUrl: payload.policeClearanceCertificateUrl,
      }),
      termsAccepted: payload.termsAccepted === true,
      ...(payload.termsAccepted === true && { termsAcceptedAt: now }),
      guardUndertakingAccepted: payload.guardUndertakingAccepted === true,
      ...(payload.guardUndertakingAccepted === true && {
        guardUndertakingAcceptedAt: now,
      }),
    };

    const batch = adminDb.batch();
    batch.create(
      employeeIdRegistryRef(adminDb, employeeId),
      buildEmployeeIdRegistryRecord({
        employeeDocId: docRef.id,
        employeeId,
        clientName: canonicalClientName,
        status: "Active",
        source: "employee_enrollment",
        timestamp: now,
      }),
    );
    batch.set(docRef, employeeData);
    batch.set(adminDb.collection("employeeAadhaarPrivate").doc(docRef.id), {
      employeeDocId: docRef.id,
      ...aadhaarEncryption,
      aadhaarLast4: payload.aadharNumber.slice(-4),
      documentStoragePath: restrictedAadhaarFront.documentStoragePath,
      originalFileName: restrictedAadhaarFront.originalFileName,
      contentType: restrictedAadhaarFront.contentType,
      additionalDocuments: [{
        side: "back",
        documentStoragePath: restrictedAadhaarBack.documentStoragePath,
        originalFileName: restrictedAadhaarBack.originalFileName,
        contentType: restrictedAadhaarBack.contentType,
      }],
      purpose: "esic_epf_registration",
      employeeProvided: true,
      verificationStatus: "not_independently_verified",
      consentId: consentRef.id,
      uploadedByType: isAdminSubmission ? "admin" : "guard",
      uploadedByUid: submissionActor?.uid || `enrollment:${draftId}`,
      uploadedAt: now,
      updatedAt: now,
      retentionPolicy: "employment_plus_90_days",
      status: "complete",
    });
    batch.set(consentRef, {
      type: "aadhaar_esic_epf",
      noticeVersion: payload.aadhaarConsentVersion,
      noticeTextHash: AADHAAR_CONSENT_TEXT_HASH,
      accepted: true,
      acceptedAt: now,
      employeeName: fullName,
      signatureStoragePath: payload.signatureUrl,
      enrollmentId: draftId || null,
      source: isAdminSubmission ? "admin_enrollment" : "public_enrollment",
      employeeId,
      uploaderUid: submissionActor?.uid || null,
      status: "active",
    });
    batch.set(docRef.collection("consents").doc(), {
      type: "enrollment_terms",
      noticeVersion: ENROLLMENT_TERMS_VERSION,
      noticeTextHash: ENROLLMENT_TERMS_TEXT_HASH,
      accepted: payload.termsAccepted === true,
      acceptedAt: now,
      employeeName: fullName,
      signatureStoragePath: payload.signatureUrl,
      enrollmentId: draftId || null,
      source: isAdminSubmission ? "admin_enrollment" : "public_enrollment",
      employeeId,
      uploaderUid: submissionActor?.uid || null,
      status: "active",
    });
    batch.set(docRef.collection("consents").doc(), {
      type: "guard_undertaking",
      noticeVersion: GUARD_UNDERTAKING_VERSION,
      noticeTextHash: GUARD_UNDERTAKING_TEXT_HASH,
      accepted: payload.guardUndertakingAccepted === true,
      acceptedAt: now,
      employeeName: fullName,
      signatureStoragePath: payload.signatureUrl,
      enrollmentId: draftId || null,
      source: isAdminSubmission ? "admin_enrollment" : "public_enrollment",
      employeeId,
      uploaderUid: submissionActor?.uid || null,
      status: "active",
    });
    batch.set(docRef.collection("documents").doc(), {
      category: "identity",
      documentType: payload.identityProofType,
      documentNumberMasked: payload.identityProofNumber.slice(-4).padStart(payload.identityProofNumber.length, "*"),
      frontStoragePath: payload.identityProofUrlFront,
      backStoragePath: payload.identityProofUrlBack,
      purpose: "client_identity_registration",
      employeeProvided: true,
      verificationStatus: "not_independently_verified",
      uploadedAt: now,
      uploadedThroughEnrollmentId: draftId || null,
      retentionPolicy: "employment_plus_90_days",
      accessClassification: "client_shareable_with_grant",
      status: "active",
    });
    batch.set(docRef.collection("documents").doc(), {
      category: "address",
      documentType: payload.addressProofType,
      documentNumberMasked: payload.addressProofNumber.slice(-4).padStart(payload.addressProofNumber.length, "*"),
      frontStoragePath: payload.addressProofUrlFront,
      backStoragePath: payload.addressProofUrlBack,
      purpose: "client_address_registration",
      employeeProvided: true,
      verificationStatus: "not_independently_verified",
      uploadedAt: now,
      uploadedThroughEnrollmentId: draftId || null,
      retentionPolicy: "employment_plus_90_days",
      accessClassification: "client_shareable_with_grant",
      status: "active",
    });
    batch.set(adminDb.collection("sensitiveDocumentAuditLogs").doc(), {
      action: "aadhaar_submitted",
      employeeDocId: docRef.id,
      category: "aadhaar",
      purpose: "esic_epf_registration",
      actorUid: submissionActor?.uid || null,
      actorType: isAdminSubmission ? "admin" : "guard",
      at: now,
    });
    if (draftRef) {
      batch.update(draftRef, {
        status: "completed",
        employeeDocId: docRef.id,
        employeeId,
        completedAt: now,
        tokenHash: null,
      });
    }
    try {
      await batch.commit();
    } catch (error) {
      await Promise.all(movedAadhaarDocuments.map((document) => deleteStorageObjectIfPresent(document.documentStoragePath)));
      throw error;
    }
    await Promise.allSettled(movedAadhaarDocuments.map((document) => deleteStorageObjectIfPresent(document.sourcePath)));
    movedAadhaarDocuments.length = 0;

    return NextResponse.json({
      id: docRef.id,
      employeeId,
    });
  } catch (error: any) {
    await Promise.all(
      movedAadhaarDocuments.map((document) => deleteStorageObjectIfPresent(document.documentStoragePath)),
    );
    if (error?.name === "ZodError") {
      return NextResponse.json(
        {
          error: "Invalid enrollment data.",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }

    console.error("Enrollment API failed:", error);
    return NextResponse.json(
      { error: "Could not securely save the employee record." },
      { status: 500 },
    );
  }
}
