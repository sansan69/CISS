import { z } from "zod";
import {
  EDUCATION_OPTIONS,
  GENDER_OPTIONS,
  MARITAL_STATUSES,
  PROOF_TYPES,
} from "@/lib/constants";

export const enrollmentSubmissionSchema = z
  .object({
    joiningDate: z.string().datetime(),
    clientName: z.string().min(1),
    resourceIdNumber: z.string().trim().optional(),
    profilePictureUrl: z.string().url(),
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
    bankPassbookStatementUrl: z.string().url().optional(),
    fullAddress: z.string().min(10),
    emailAddress: z.string().email(),
    phoneNumber: z.string().regex(/^\d{10}$/),
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
  });

export type EnrollmentSubmission = z.infer<typeof enrollmentSubmissionSchema>;
