import { z } from "zod";
import {
  EDUCATION_OPTIONS,
  GENDER_OPTIONS,
  IDENTITY_PROOF_TYPES,
  ADDRESS_PROOF_TYPES,
  isLngClientName,
  LNG_JOB_DESIGNATIONS,
  MARITAL_STATUSES,
  requiresLngArmsLicense,
  requiresLngServiceBook,
} from "@/lib/constants";
import { AADHAAR_CONSENT_VERSION } from "@/lib/aadhaar-policy";
import { GUARD_UNDERTAKING_VERSION } from "@/lib/enrollment-consents";

const lngDesignationSchema = z.enum(LNG_JOB_DESIGNATIONS);

const aadhaarDocumentReferenceSchema = (message: string) =>
  z.string().trim().refine(
    (value) =>
      z.string().url().safeParse(value).success ||
      /^enrollments\/[A-Za-z0-9_-]+\/aadharCards\/[A-Za-z0-9._-]+$/.test(value) ||
      /^employees\/[A-Za-z0-9_-]+\/aadharCards\/[A-Za-z0-9._-]+$/.test(value) ||
      /^restrictedAadhaarStaging\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(value),
    message,
  );

export const enrollmentSubmissionSchema = z
  .object({
    joiningDate: z.string().datetime(),
    clientName: z.string().trim().min(1),
    resourceIdNumber: z.string().trim().optional(),
    profilePictureUrl: z.string().url(),
    fullNameInput: z.string().trim().optional(),
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    fatherName: z.string().trim().min(2),
    motherName: z.string().trim().min(2),
    dateOfBirth: z.string().datetime(),
    gender: z.enum(GENDER_OPTIONS),
    maritalStatus: z.enum(MARITAL_STATUSES),
    spouseName: z.string().trim().optional(),
    educationalQualification: z.enum(EDUCATION_OPTIONS),
    otherQualification: z.string().trim().optional(),
    district: z.string().trim().min(1),
    panNumber: z.string().trim().optional(),
    aadharNumber: z.string().trim().regex(/^\d{12}$/),
    nationality: z.string().trim().optional(),
    identificationMark: z.string().trim().optional(),
    heightCm: z.number().finite().positive().optional(),
    weightKg: z.number().finite().positive().optional(),
    jobDesignation: z.string().trim().optional(),
    lngJobDesignation: lngDesignationSchema.optional(),
    serviceBookNumber: z.string().trim().optional(),
    serviceBookDocumentUrl: z.string().url().optional(),
    armsLicenseNumber: z.string().trim().optional(),
    armsLicenseDocumentUrl: z.string().url().optional(),
    passportCountryName: z.string().trim().optional(),
    passportDocumentUrl: z.string().url().optional(),
    identityProofType: z.enum(IDENTITY_PROOF_TYPES),
    identityProofNumber: z.string().trim().min(1),
    identityProofUrlFront: z.string().url(),
    identityProofUrlBack: z.string().url(),
    addressProofType: z.enum(ADDRESS_PROOF_TYPES),
    addressProofNumber: z.string().trim().min(1),
    addressProofUrlFront: z.string().url(),
    addressProofUrlBack: z.string().url(),
    aadharCardDocumentUrl: aadhaarDocumentReferenceSchema("A valid Aadhaar front document reference is required."),
    aadharCardDocumentBackUrl: aadhaarDocumentReferenceSchema("A valid Aadhaar back document reference is required."),
    panCardDocumentUrl: z.string().url().optional(),
    signatureUrl: z.string().url(),
    policeClearanceCertificateUrl: z.string().url().optional(),
    epfUanNumber: z.string().trim().optional(),
    esicNumber: z.string().trim().optional(),
    bankAccountNumber: z.string().trim().optional(),
    ifscCode: z.string().trim().optional(),
    bankName: z.string().trim().optional(),
    branchName: z.string().trim().optional(),
    bankPassbookStatementUrl: z.string().url(),
    fullAddress: z.string().min(10),
    emailAddress: z
      .string()
      .trim()
      .min(1, { message: "Email address is required." })
      .email({ message: "Please enter a valid email address." }),
    phoneNumber: z.string().regex(/^\d{10}$/),
    legacyUniqueId: z.string().trim().optional(),
    termsAccepted: z.literal(true),
    aadhaarConsentAccepted: z.literal(true),
    aadhaarConsentVersion: z.literal(AADHAAR_CONSENT_VERSION),
    guardUndertakingAccepted: z.literal(true),
    guardUndertakingVersion: z.literal(GUARD_UNDERTAKING_VERSION),
  })
  .superRefine((data, ctx) => {
    if (
      data.educationalQualification === "Any Other Qualification" &&
      !data.otherQualification
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please specify your qualification.",
        path: ["otherQualification"],
      });
    }

    const dateOfBirth = new Date(data.dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dateOfBirth.getFullYear();
    const birthdayHasNotOccurred =
      today.getMonth() < dateOfBirth.getMonth() ||
      (today.getMonth() === dateOfBirth.getMonth() && today.getDate() < dateOfBirth.getDate());
    if (birthdayHasNotOccurred) age -= 1;
    if (age < 18) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Employee must be at least 18 years old.",
        path: ["dateOfBirth"],
      });
    } else if (age >= 65) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Employee must be under 65 years old.",
        path: ["dateOfBirth"],
      });
    }

    if (data.maritalStatus === "Married" && !data.spouseName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Spouse name is required if married.",
        path: ["spouseName"],
      });
    }

    if (data.panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(data.panNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid PAN number format (e.g., ABCDE1234F).",
        path: ["panNumber"],
      });
    }

    if (data.identityProofType === data.addressProofType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Identity proof and address proof must be different types.",
        path: ["addressProofType"],
      });
    }

    if (isLngClientName(data.clientName)) {
      if (!data.fullNameInput?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Full name is required for LNG Petronet enrollment.",
          path: ["fullNameInput"],
        });
      }

      if (!data.lngJobDesignation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Job designation is required for LNG Petronet enrollment.",
          path: ["lngJobDesignation"],
        });
      }


      if (!data.panNumber?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "PAN card number is required for LNG Petronet enrollment.",
          path: ["panNumber"],
        });
      }

      if (!data.panCardDocumentUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "PAN card copy is required for LNG Petronet enrollment.",
          path: ["panCardDocumentUrl"],
        });
      }

      if (!data.identificationMark?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Identification mark is required for LNG Petronet enrollment.",
          path: ["identificationMark"],
        });
      }

      if (!data.heightCm) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Height is required for LNG Petronet enrollment.",
          path: ["heightCm"],
        });
      }

      if (!data.weightKg) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Weight is required for LNG Petronet enrollment.",
          path: ["weightKg"],
        });
      }

      if (!data.nationality?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Nationality is required for LNG Petronet enrollment.",
          path: ["nationality"],
        });
      }

      if (!data.branchName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Branch name is required for LNG Petronet enrollment.",
          path: ["branchName"],
        });
      }

      if (requiresLngServiceBook(data.lngJobDesignation) && !data.serviceBookNumber?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Service book number is required for this LNG designation.",
          path: ["serviceBookNumber"],
        });
      }

      if (requiresLngServiceBook(data.lngJobDesignation) && !data.serviceBookDocumentUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Service book document is required for this LNG designation.",
          path: ["serviceBookDocumentUrl"],
        });
      }

      if (requiresLngArmsLicense(data.lngJobDesignation) && !data.armsLicenseNumber?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Arms license number is required for armed guard designations.",
          path: ["armsLicenseNumber"],
        });
      }

      if (requiresLngArmsLicense(data.lngJobDesignation) && !data.armsLicenseDocumentUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Arms license document is required for armed guard designations.",
          path: ["armsLicenseDocumentUrl"],
        });
      }
    }
  });

export type EnrollmentSubmission = z.infer<typeof enrollmentSubmissionSchema>;
