import { NextRequest, NextResponse } from "next/server";
import {
  canonicalizeDistrictName,
  getDefaultDistrictSuggestions,
  isRecognizedDistrictName,
} from "@/lib/districts";
import { generateEmployeeId } from "@/lib/employee-id";
import { generateQrCodeDataUrl } from "@/lib/qr";
import { REGION_CODE } from "@/lib/runtime-config";
import { LNG_CLIENT_NAME } from "@/lib/constants";
import {
  enrollmentSubmissionSchema,
  type EnrollmentSubmission,
} from "@/types/enrollment";
export const runtime = "nodejs";

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
    const existing = await adminDb
      .collection("employees")
      .where("employeeId", "==", employeeId)
      .limit(1)
      .get();

    if (existing.empty) {
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

function buildLngFallbackEmail(payload: EnrollmentSubmission) {
  const uniqueToken =
    payload.legacyUniqueId?.trim().replace(/[^a-zA-Z0-9]/g, "").toLowerCase() ||
    payload.phoneNumber;
  return `${uniqueToken}@lng-petronet.cisskerala.app`;
}

export async function POST(request: NextRequest) {
  try {
    // Public endpoint — self-enrollment does not require authentication.
    const payload = enrollmentSubmissionSchema.parse(await request.json());
    const districtSuggestions = getDefaultDistrictSuggestions(REGION_CODE);
    const district = canonicalizeDistrictName(payload.district, districtSuggestions);
    if (!isRecognizedDistrictName(district, districtSuggestions)) {
      return NextResponse.json(
        { error: "Please choose a valid district for this region." },
        { status: 400 },
      );
    }
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { Timestamp } = await import("firebase-admin/firestore");

    const normalizedPhone = payload.phoneNumber.replace(/\D/g, "");
    const normalizedEmail =
      (payload.emailAddress?.trim() || "").toLowerCase() ||
      (payload.clientName === LNG_CLIENT_NAME ? buildLngFallbackEmail(payload) : "");
    const normalizedFullNameInput = payload.fullNameInput?.trim() || "";
    const nameParts =
      payload.clientName === LNG_CLIENT_NAME && normalizedFullNameInput
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
    const emailPromise = normalizedEmail
      ? adminDb
          .collection("employees")
          .where("emailAddress", "==", normalizedEmail)
          .limit(1)
          .get()
      : Promise.resolve(null);

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

    let employeeId = payload.clientName === LNG_CLIENT_NAME
      ? payload.legacyUniqueId?.trim()
      : undefined;

    if (employeeId) {
      const existingEmployeeId = await adminDb
        .collection("employees")
        .where("employeeId", "==", employeeId)
        .limit(1)
        .get();

      if (!existingEmployeeId.empty) {
        return NextResponse.json(
          { error: "An employee with this LNG unique ID already exists." },
          { status: 409 },
        );
      }
    } else {
      employeeId = await generateUniqueEmployeeId(adminDb, payload.clientName);
    }

    const fullName = `${nameParts.firstName.toUpperCase()} ${nameParts.lastName.toUpperCase()}`.trim();
    const qrCodeUrl = await generateQrCodeDataUrl(
      employeeId,
      fullName,
      normalizedPhone,
    );
    const now = Timestamp.now();

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
      clientName: payload.clientName,
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
        clientName: payload.clientName,
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
      ...(payload.aadharNumber && { aadharNumber: payload.aadharNumber }),
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
      ...(payload.legacyUniqueId && { legacyUniqueId: payload.legacyUniqueId }),
      ...(payload.epfUanNumber && { epfUanNumber: payload.epfUanNumber }),
      ...(payload.esicNumber && { esicNumber: payload.esicNumber }),
      ...(payload.policeClearanceCertificateUrl && {
        policeClearanceCertificateUrl: payload.policeClearanceCertificateUrl,
      }),
    };

    const docRef = await adminDb.collection("employees").add(employeeData);

    return NextResponse.json({
      id: docRef.id,
      employeeId,
    });
  } catch (error: any) {
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
      { error: error?.message || "Could not save employee record." },
      { status: 500 },
    );
  }
}
