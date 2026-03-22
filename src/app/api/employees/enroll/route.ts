import { NextRequest, NextResponse } from "next/server";
import {
  canonicalizeDistrictName,
  getDefaultDistrictSuggestions,
  isRecognizedDistrictName,
} from "@/lib/districts";
import { generateEmployeeId } from "@/lib/employee-id";
import { generateQrCodeDataUrl } from "@/lib/qr";
import { REGION_CODE } from "@/lib/runtime-config";
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

export async function POST(request: NextRequest) {
  try {
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

    const [phoneSnapshot, emailSnapshot] = await Promise.all([
      adminDb
        .collection("employees")
        .where("phoneNumber", "==", payload.phoneNumber)
        .limit(1)
        .get(),
      adminDb
        .collection("employees")
        .where("emailAddress", "==", payload.emailAddress.toLowerCase())
        .limit(1)
        .get(),
    ]);

    if (!phoneSnapshot.empty) {
      return NextResponse.json(
        { error: "An employee with this phone number already exists." },
        { status: 409 },
      );
    }

    if (!emailSnapshot.empty) {
      return NextResponse.json(
        { error: "An employee with this email address already exists." },
        { status: 409 },
      );
    }

    const employeeId = await generateUniqueEmployeeId(adminDb, payload.clientName);
    const fullName = `${payload.firstName.toUpperCase()} ${payload.lastName.toUpperCase()}`;
    const qrCodeUrl = await generateQrCodeDataUrl(
      employeeId,
      fullName,
      payload.phoneNumber,
    );
    const now = Timestamp.now();

    const employeeData = {
      employeeId,
      qrCodeUrl,
      searchableFields: buildSearchableFields(payload, employeeId),
      clientName: payload.clientName,
      firstName: payload.firstName.toUpperCase(),
      lastName: payload.lastName.toUpperCase(),
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
      emailAddress: payload.emailAddress.toLowerCase(),
      phoneNumber: payload.phoneNumber,
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
