import { z } from "zod";
import {
  EDUCATION_OPTIONS,
  GENDER_OPTIONS,
  LNG_CLIENT_NAME,
  LNG_JOB_DESIGNATIONS,
  MARITAL_STATUSES,
  PROOF_TYPES,
  requiresLngArmsLicense,
  requiresLngServiceBook,
} from "@/lib/constants";

const lngDesignationSchema = z.enum(LNG_JOB_DESIGNATIONS);

export const enrollmentSubmissionSchema = z
  .object({
    joiningDate: z.string().datetime(),
    clientName: z.string().min(1),
    resourceIdNumber: z.string().trim().optional(),
    profilePictureUrl: z.string().url(),
    fullNameInput: z.string().trim().optional(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    fatherName: z.string().min(2),
    motherName: z.string().min(2),
    dateOfBirth: z.string().datetime(),
    gender: z.enum(GENDER_OPTIONS),
    maritalStatus: z.enum(MARITAL_STATUSES),
    spouseName: z.string().trim().optional(),
    educationalQualification: z.enum(EDUCATION_OPTIONS),
    otherQualification: z.string().trim().optional(),
    district: z.string().trim().min(1),
    panNumber: z.string().trim().optional(),
    aadharNumber: z.string().trim().optional(),
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
    identityProofType: z.enum(PROOF_TYPES),
    identityProofNumber: z.string().min(1),
    identityProofUrlFront: z.string().url(),
    identityProofUrlBack: z.string().url(),
    addressProofType: z.enum(PROOF_TYPES),
    addressProofNumber: z.string().min(1),
    addressProofUrlFront: z.string().url(),
    addressProofUrlBack: z.string().url(),
    signatureUrl: z.string().url(),
    policeClearanceCertificateUrl: z.string().url().optional(),
    epfUanNumber: z.string().trim().optional(),
    esicNumber: z.string().trim().optional(),
    bankAccountNumber: z.string().trim().optional(),
    ifscCode: z.string().trim().optional(),
    bankName: z.string().trim().optional(),
    branchName: z.string().trim().optional(),
    bankPassbookStatementUrl: z.string().url().optional(),
    fullAddress: z.string().min(10),
    emailAddress: z.string().trim().optional(),
    phoneNumber: z.string().regex(/^\d{10}$/),
    legacyUniqueId: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.clientName === "TCS" && !data.resourceIdNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Resource ID number is required for TCS client.",
        path: ["resourceIdNumber"],
      });
    }

    if (data.maritalStatus === "Married" && !data.spouseName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Spouse name is required if married.",
        path: ["spouseName"],
      });
    }

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

    if (data.identityProofType === data.addressProofType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Identity proof and address proof must be different types.",
        path: ["addressProofType"],
      });
    }

    if (data.clientName === LNG_CLIENT_NAME) {
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

      if (!data.aadharNumber?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Aadhar number is required for LNG Petronet enrollment.",
          path: ["aadharNumber"],
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
    } else if (!data.emailAddress || !z.string().email().safeParse(data.emailAddress).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A valid email address is required.",
        path: ["emailAddress"],
      });
    }
  });

export type EnrollmentSubmission = z.infer<typeof enrollmentSubmissionSchema>;
