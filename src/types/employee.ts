import { z } from "zod";
import {
  EDUCATION_OPTIONS,
  EMPLOYEE_STATUSES,
  GENDER_OPTIONS,
  LNG_JOB_DESIGNATIONS,
  MARITAL_STATUSES,
  PROOF_TYPES,
} from "@/lib/constants";

// Firestore Timestamps arrive as objects with seconds/nanoseconds; allow strings too.
const firestoreDateSchema = z.union([
  z.string(),
  z.object({ seconds: z.number(), nanoseconds: z.number() }).passthrough(),
]);

export const employeeStatusSchema = z.enum(EMPLOYEE_STATUSES);
export const employeeGenderSchema = z.enum(GENDER_OPTIONS);
export const employeeMaritalStatusSchema = z.enum(MARITAL_STATUSES);
export const employeeQualificationSchema = z.enum(EDUCATION_OPTIONS);
export const employeeProofTypeSchema = z.enum(PROOF_TYPES);
export const employeeDistrictSchema = z.string().trim().min(1);
export const employeeLngDesignationSchema = z.enum(LNG_JOB_DESIGNATIONS);

export const employeeSchema = z.object({
  id: z.string(),
  regionCode: z.string().optional(),
  regionName: z.string().optional(),
  employeeId: z.string(),
  clientName: z.string(),
  resourceIdNumber: z.string().optional(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  dateOfBirth: firestoreDateSchema,
  gender: employeeGenderSchema,
  fatherName: z.string(),
  motherName: z.string(),
  maritalStatus: employeeMaritalStatusSchema,
  spouseName: z.string().optional(),
  district: z.string(),
  panNumber: z.string().optional(),
  aadharNumber: z.string().optional(),
  nationality: z.string().optional(),
  identificationMark: z.string().optional(),
  heightCm: z.number().optional(),
  weightKg: z.number().optional(),
  jobDesignation: z.string().optional(),
  lngJobDesignation: employeeLngDesignationSchema.optional(),
  serviceBookNumber: z.string().optional(),
  serviceBookDocumentUrl: z.string().optional(),
  armsLicenseNumber: z.string().optional(),
  armsLicenseDocumentUrl: z.string().optional(),
  educationalQualification: employeeQualificationSchema.optional(),
  otherQualification: z.string().optional(),
  identityProofType: z.string().optional(),
  identityProofNumber: z.string().optional(),
  identityProofUrlFront: z.string().optional(),
  identityProofUrlBack: z.string().optional(),
  addressProofType: z.string().optional(),
  addressProofNumber: z.string().optional(),
  addressProofUrlFront: z.string().optional(),
  addressProofUrlBack: z.string().optional(),
  signatureUrl: z.string().optional(),
  epfUanNumber: z.string().optional(),
  esicNumber: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  ifscCode: z.string().optional(),
  bankName: z.string().optional(),
  branchName: z.string().optional(),
  fullAddress: z.string(),
  emailAddress: z.string().optional(),
  phoneNumber: z.string(),
  profilePictureUrl: z.string().optional(),
  idProofType: z.string().optional(),
  idProofNumber: z.string().optional(),
  idProofDocumentUrl: z.string().optional(),
  idProofDocumentUrlFront: z.string().optional(),
  idProofDocumentUrlBack: z.string().optional(),
  bankPassbookStatementUrl: z.string().optional(),
  policeClearanceCertificateUrl: z.string().optional(),
  legacyUniqueId: z.string().optional(),
  joiningDate: firestoreDateSchema,
  status: employeeStatusSchema,
  qrCodeUrl: z.string().optional(),
  exitDate: z.any().optional(),
  createdAt: z.any(),
  updatedAt: z.any(),
  searchableFields: z.array(z.string()).optional(),
  publicProfile: z
    .object({
      fullName: z.string(),
      employeeId: z.string(),
      clientName: z.string(),
      profilePictureUrl: z.string().optional(),
      status: employeeStatusSchema,
    })
    .optional(),
  department: z.string().optional(),
});

export interface Employee {
  id: string;
  regionCode?: string;
  regionName?: string;
  employeeId: string;
  clientName: string;
  resourceIdNumber?: string;
  firstName: string;
  lastName: string;
  fullName: string;
  dateOfBirth: any;
  gender: "Male" | "Female" | "Other";
  fatherName: string;
  motherName: string;
  maritalStatus: "Married" | "Unmarried";
  spouseName?: string;
  district: string;
  panNumber?: string;
  aadharNumber?: string;
  nationality?: string;
  identificationMark?: string;
  heightCm?: number;
  weightKg?: number;
  jobDesignation?: string;
  lngJobDesignation?: (typeof LNG_JOB_DESIGNATIONS)[number];
  serviceBookNumber?: string;
  serviceBookDocumentUrl?: string;
  armsLicenseNumber?: string;
  armsLicenseDocumentUrl?: string;
  educationalQualification?:
    | "Primary School"
    | "High School"
    | "Matriculation/10th"
    | "Pre degree/+2 Equivalent"
    | "Diploma"
    | "Graduation"
    | "Graduate"
    | "Post Graduation"
    | "Post graduate"
    | "Doctorate"
    | "Any Other Qualification";
  otherQualification?: string;
  identityProofType?: string;
  identityProofNumber?: string;
  identityProofUrlFront?: string;
  identityProofUrlBack?: string;
  addressProofType?: string;
  addressProofNumber?: string;
  addressProofUrlFront?: string;
  addressProofUrlBack?: string;
  signatureUrl?: string;
  epfUanNumber?: string;
  esicNumber?: string;
  bankAccountNumber?: string;
  ifscCode?: string;
  bankName?: string;
  branchName?: string;
  fullAddress: string;
  emailAddress?: string;
  phoneNumber: string;
  profilePictureUrl?: string;
  idProofType?: string;
  idProofNumber?: string;
  idProofDocumentUrl?: string;
  idProofDocumentUrlFront?: string;
  idProofDocumentUrlBack?: string;
  bankPassbookStatementUrl?: string;
  policeClearanceCertificateUrl?: string;
  legacyUniqueId?: string;
  joiningDate: any;
  status: "Active" | "Inactive" | "OnLeave" | "Exited";
  qrCodeUrl?: string;
  exitDate?: any;
  createdAt: any;
  updatedAt: any;
  searchableFields?: string[];
  publicProfile?: {
    fullName: string;
    employeeId: string;
    clientName: string;
    profilePictureUrl?: string;
    status: "Active" | "Inactive" | "OnLeave" | "Exited";
  };
  department?: string;
}
