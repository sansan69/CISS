import { z } from "zod";
import {
  EDUCATION_OPTIONS,
  EMPLOYEE_STATUSES,
  GENDER_OPTIONS,
  KERALA_DISTRICTS,
  MARITAL_STATUSES,
  PROOF_TYPES,
} from "@/lib/constants";

export const employeeStatusSchema = z.enum(EMPLOYEE_STATUSES);
export const employeeGenderSchema = z.enum(GENDER_OPTIONS);
export const employeeMaritalStatusSchema = z.enum(MARITAL_STATUSES);
export const employeeQualificationSchema = z.enum(EDUCATION_OPTIONS);
export const employeeProofTypeSchema = z.enum(PROOF_TYPES);
export const employeeDistrictSchema = z.enum(KERALA_DISTRICTS);

export const employeeSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  clientName: z.string(),
  resourceIdNumber: z.string().optional(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  dateOfBirth: z.any(),
  gender: employeeGenderSchema,
  fatherName: z.string(),
  motherName: z.string(),
  maritalStatus: employeeMaritalStatusSchema,
  spouseName: z.string().optional(),
  district: z.string(),
  panNumber: z.string().optional(),
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
  fullAddress: z.string(),
  emailAddress: z.string(),
  phoneNumber: z.string(),
  profilePictureUrl: z.string().optional(),
  idProofType: z.string().optional(),
  idProofNumber: z.string().optional(),
  idProofDocumentUrl: z.string().optional(),
  idProofDocumentUrlFront: z.string().optional(),
  idProofDocumentUrlBack: z.string().optional(),
  bankPassbookStatementUrl: z.string().optional(),
  policeClearanceCertificateUrl: z.string().optional(),
  joiningDate: z.any(),
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
  educationalQualification?:
    | "Primary School"
    | "High School"
    | "Diploma"
    | "Graduation"
    | "Post Graduation"
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
  fullAddress: string;
  emailAddress: string;
  phoneNumber: string;
  profilePictureUrl?: string;
  idProofType?: string;
  idProofNumber?: string;
  idProofDocumentUrl?: string;
  idProofDocumentUrlFront?: string;
  idProofDocumentUrlBack?: string;
  bankPassbookStatementUrl?: string;
  policeClearanceCertificateUrl?: string;
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
