
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, ArrowLeft, ArrowRight, Camera, CheckCircle as CheckCircleIcon, AlertTriangle, FileUp, Loader2, Upload, UserCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import React, { Suspense, useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, getDocs } from "firebase/firestore";
import {
  dataURLtoFile,
  deleteFileFromStorage,
  ENROLLMENT_DOCUMENT_ACCEPT,
  ENROLLMENT_IMAGE_ACCEPT,
  getUploadFileExtension,
  prepareFileForUpload,
  uploadFileToStorage,
} from "@/lib/storageUtils";
import {
  assertEnrollmentUploadSize,
  getEnrollmentFileSelectionError,
  isEnrollmentFileSelectionValid,
} from "@/lib/enrollmentFiles";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription as ShadDialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSearchParams, useRouter } from 'next/navigation';
import { Checkbox } from "@/components/ui/checkbox";
import { EDUCATION_OPTIONS, KERALA_DISTRICTS, MARITAL_STATUSES, PROOF_TYPES } from "@/lib/constants";

const fileSchema = z.instanceof(File, { message: "This field is required." })
  .refine(isEnrollmentFileSelectionValid, "Images up to 15MB and PDF files up to 5MB are allowed.");

const optionalFileSchema = fileSchema.optional();

const proofTypes = z.enum(PROOF_TYPES);
const qualificationTypes = z.enum(EDUCATION_OPTIONS);

const idValidation = {
    "Aadhar Card": /^\d{12}$/,
    "PAN Card": /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
    "Voter ID": /^[A-Z]{3}[0-9]{7}$/,
    "Passport": /^[A-Z]{1}[0-9]{7}$/,
};

const enrollmentFormSchema = z.object({
  // Client Information
  joiningDate: z.date({ required_error: "Joining date is required." }),
  clientName: z.string({ required_error: "Client name is required." }).min(1, {message: "Client name is required."}),
  resourceIdNumber: z.string().optional(),

  // Personal Information
  profilePicture: fileSchema,
  firstName: z.string().min(1, { message: "First name is required." }),
  lastName: z.string().min(1, { message: "Last name is required." }),
  fatherName: z.string().min(2, { message: "Father's name is required." }),
  motherName: z.string().min(2, { message: "Mother's name is required." }),
  dateOfBirth: z.date({ required_error: "Date of birth is required." })
    .refine(date => {
        const today = new Date();
        const age = today.getFullYear() - date.getFullYear();
        const m = today.getMonth() - date.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < date.getDate())) {
            return age - 1 >= 18;
        }
        return age >= 18;
    }, { message: "Must be at least 18 years old." })
    .refine(date => {
        const today = new Date();
        const age = today.getFullYear() - date.getFullYear();
        const m = today.getMonth() - date.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < date.getDate())) {
             return age - 1 < 65;
        }
        return age < 65;
    }, { message: "Must be under 65 years old." }),
  gender: z.enum(["Male", "Female", "Other"], { required_error: "Gender is required." }),
  maritalStatus: z.enum(["Married", "Unmarried"], { required_error: "Marital status is required." }),
  spouseName: z.string().optional(),
  
  educationalQualification: qualificationTypes,
  otherQualification: z.string().optional(),

  // Location & Identification
  district: z.string({ required_error: "District is required." }).min(1, {message: "District is required."}),
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, { message: "Invalid PAN number format (e.g., ABCDE1234F)." }).optional().or(z.literal('')),
  
  identityProofType: proofTypes,
  identityProofNumber: z.string().min(1, { message: "ID proof number is required." }),
  identityProofUrlFront: fileSchema,
  identityProofUrlBack: fileSchema,
  
  addressProofType: proofTypes,
  addressProofNumber: z.string().min(1, { message: "Address proof number is required." }),
  addressProofUrlFront: fileSchema,
  addressProofUrlBack: fileSchema,
  
  signatureUrl: fileSchema,
  
  policeClearanceCertificate: optionalFileSchema,
  epfUanNumber: z.string().optional(),
  esicNumber: z.string().optional(),

  // Bank Account Details
  bankAccountNumber: z.string().optional().or(z.literal('')),
  ifscCode: z.string().optional().or(z.literal('')),
  bankName: z.string().optional().or(z.literal('')),
  bankPassbookStatement: optionalFileSchema,

  // Contact Information
  fullAddress: z.string().min(10, { message: "Full address is required (min 10 chars)." }),
  emailAddress: z.string().email({ message: "Invalid email address." }),
  phoneNumber: z.string().regex(/^\d{10}$/, { message: "Phone number must be 10 digits." }),
  
  termsAndConditions: z.boolean().refine((val) => val === true, {
    message: "You must accept the terms and conditions to proceed.",
  }),
}).superRefine((data, ctx) => {
  if (data.clientName === "TCS" && (!data.resourceIdNumber || data.resourceIdNumber.trim() === "")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Resource ID number is required for TCS client.", path: ["resourceIdNumber"] });
  }
  if (data.maritalStatus === "Married" && (!data.spouseName || data.spouseName.trim() === "")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Spouse name is required if marital status is Married.", path: ["spouseName"] });
  }
  if (data.identityProofType && data.addressProofType && data.identityProofType === data.addressProofType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Identity and Address proof types cannot be the same.", path: ["addressProofType"] });
  }
  if (data.educationalQualification === "Any Other Qualification" && (!data.otherQualification || data.otherQualification.trim() === "")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please specify your qualification.", path: ["otherQualification"] });
  }

  // --- Zod Level Validation for ID Numbers ---
  const { identityProofType, identityProofNumber } = data;
  if (identityProofType in idValidation) {
    const regex = idValidation[identityProofType as keyof typeof idValidation];
    if (!regex.test(identityProofNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid format for ${identityProofType}.`,
        path: ["identityProofNumber"],
      });
    }
  }

  const { addressProofType, addressProofNumber } = data;
   if (addressProofType in idValidation) {
    const regex = idValidation[addressProofType as keyof typeof idValidation];
    if (!regex.test(addressProofNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid format for ${addressProofType}.`,
        path: ["addressProofNumber"],
      });
    }
  }
});

type EnrollmentFormValues = z.infer<typeof enrollmentFormSchema>;
type EnrollmentStepKey = "client" | "personal" | "documents" | "details" | "review";
type StepIssue = {
  stepIndex: number;
  title: string;
  fields: string[];
};
type SerializedDraftValue = string | boolean | null | { type: "date"; value: string };
type EnrollmentDraft = {
  currentStep: number;
  updatedAt: string;
  values: Partial<Record<keyof EnrollmentFormValues, SerializedDraftValue>>;
};

interface ClientOption {
  id: string;
  name: string;
}

const keralaDistricts = [...KERALA_DISTRICTS];
const idProofOptions = [...PROOF_TYPES];
const maritalStatuses = [...MARITAL_STATUSES];
const educationOptions = [...EDUCATION_OPTIONS];
const ENROLLMENT_DRAFT_STORAGE_KEY = "ciss-public-enrollment-draft-v1";
const ENROLLMENT_DRAFT_DB_NAME = "ciss-public-enrollment-draft-files";
const ENROLLMENT_DRAFT_DB_STORE = "files";
const DRAFT_FILE_FIELDS: (keyof EnrollmentFormValues)[] = [
  "profilePicture",
  "identityProofUrlFront",
  "identityProofUrlBack",
  "addressProofUrlFront",
  "addressProofUrlBack",
  "signatureUrl",
  "bankPassbookStatement",
  "policeClearanceCertificate",
];
const DEFAULT_ENROLLMENT_VALUES: Partial<EnrollmentFormValues> = {
  clientName: "",
  resourceIdNumber: "",
  firstName: "",
  lastName: "",
  fatherName: "",
  motherName: "",
  gender: undefined,
  maritalStatus: undefined,
  spouseName: "",
  educationalQualification: undefined,
  otherQualification: "",
  district: "",
  panNumber: "",
  identityProofType: undefined,
  identityProofNumber: "",
  addressProofType: undefined,
  addressProofNumber: "",
  epfUanNumber: "",
  esicNumber: "",
  bankAccountNumber: "",
  ifscCode: "",
  bankName: "",
  fullAddress: "",
  emailAddress: "",
  phoneNumber: "",
  termsAndConditions: false,
};
const FIELD_LABELS: Partial<Record<keyof EnrollmentFormValues, string>> = {
  joiningDate: "Joining date",
  clientName: "Client name",
  resourceIdNumber: "Resource ID number",
  profilePicture: "Profile picture",
  firstName: "First name",
  lastName: "Last name",
  fatherName: "Father's name",
  motherName: "Mother's name",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  maritalStatus: "Marital status",
  spouseName: "Spouse name",
  educationalQualification: "Educational qualification",
  otherQualification: "Other qualification",
  district: "District",
  panNumber: "PAN number",
  identityProofType: "Identity proof type",
  identityProofNumber: "Identity proof number",
  identityProofUrlFront: "Identity proof front",
  identityProofUrlBack: "Identity proof back",
  addressProofType: "Address proof type",
  addressProofNumber: "Address proof number",
  addressProofUrlFront: "Address proof front",
  addressProofUrlBack: "Address proof back",
  signatureUrl: "Signature",
  policeClearanceCertificate: "Police clearance certificate",
  epfUanNumber: "EPF UAN number",
  esicNumber: "ESIC number",
  bankAccountNumber: "Bank account number",
  ifscCode: "IFSC code",
  bankName: "Bank name",
  bankPassbookStatement: "Bank passbook or statement",
  fullAddress: "Full address",
  emailAddress: "Email address",
  phoneNumber: "Phone number",
  termsAndConditions: "Terms and declaration",
};

const isFileValue = (value: unknown): value is File =>
  typeof File !== "undefined" && value instanceof File;

const serializeDraftValues = (values: EnrollmentFormValues): EnrollmentDraft["values"] => {
  const serialized: EnrollmentDraft["values"] = {};

  for (const [rawKey, value] of Object.entries(values) as [keyof EnrollmentFormValues, unknown][]) {
    if (isFileValue(value) || value === undefined) {
      continue;
    }

    if (value instanceof Date) {
      serialized[rawKey] = { type: "date", value: value.toISOString() };
      continue;
    }

    if (typeof value === "string" || typeof value === "boolean" || value === null) {
      serialized[rawKey] = value;
    }
  }

  return serialized;
};

const deserializeDraftValues = (
  values: EnrollmentDraft["values"],
): Partial<EnrollmentFormValues> => {
  const restored: Record<string, unknown> = {};

  for (const [rawKey, value] of Object.entries(values) as [keyof EnrollmentFormValues, SerializedDraftValue][]) {
    if (value && typeof value === "object" && "type" in value && value.type === "date") {
      restored[rawKey] = new Date(value.value);
      continue;
    }

    restored[rawKey] = value;
  }

  return restored as Partial<EnrollmentFormValues>;
};

const openEnrollmentDraftDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not available."));
      return;
    }

    const request = window.indexedDB.open(ENROLLMENT_DRAFT_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENROLLMENT_DRAFT_DB_STORE)) {
        db.createObjectStore(ENROLLMENT_DRAFT_DB_STORE, { keyPath: "field" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open enrollment draft storage."));
  });

const saveEnrollmentDraftFiles = async (values: Partial<EnrollmentFormValues>) => {
  const db = await openEnrollmentDraftDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ENROLLMENT_DRAFT_DB_STORE, "readwrite");
    const store = transaction.objectStore(ENROLLMENT_DRAFT_DB_STORE);

    DRAFT_FILE_FIELDS.forEach((field) => {
      const value = values[field];
      if (isFileValue(value)) {
        store.put({ field, file: value });
      } else {
        store.delete(field);
      }
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save enrollment draft files."));
  });

  db.close();
};

const readEnrollmentDraftFiles = async (): Promise<Partial<Record<keyof EnrollmentFormValues, File>>> => {
  const db = await openEnrollmentDraftDb();

  const result = await new Promise<Partial<Record<keyof EnrollmentFormValues, File>>>((resolve, reject) => {
    const transaction = db.transaction(ENROLLMENT_DRAFT_DB_STORE, "readonly");
    const store = transaction.objectStore(ENROLLMENT_DRAFT_DB_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const files: Partial<Record<keyof EnrollmentFormValues, File>> = {};
      for (const item of request.result as { field: keyof EnrollmentFormValues; file: File }[]) {
        files[item.field] = item.file;
      }
      resolve(files);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not read saved enrollment files."));
  });

  db.close();
  return result;
};

const clearEnrollmentDraftFiles = async () => {
  const db = await openEnrollmentDraftDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ENROLLMENT_DRAFT_DB_STORE, "readwrite");
    const store = transaction.objectStore(ENROLLMENT_DRAFT_DB_STORE);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not clear saved enrollment files."));
  });

  db.close();
};


type CameraField = "profilePicture" | "identityProofUrlFront" | "identityProofUrlBack" | "addressProofUrlFront" | "addressProofUrlBack" | "signatureUrl" | "bankPassbookStatement" | "policeClearanceCertificate";

interface ActualEnrollmentFormProps {
  initialPhoneNumberFromQuery?: string | null;
}

const ENROLLMENT_STEPS: {
  key: EnrollmentStepKey;
  title: string;
  description: string;
  fields: (keyof EnrollmentFormValues)[];
}[] = [
  {
    key: "client",
    title: "Client",
    description: "Deployment basics first, so the rest of the form can stay contextual.",
    fields: ["joiningDate", "clientName", "resourceIdNumber"],
  },
  {
    key: "personal",
    title: "Personal",
    description: "Add the applicant details and photo without scrolling through the whole form.",
    fields: [
      "profilePicture",
      "firstName",
      "lastName",
      "fatherName",
      "motherName",
      "dateOfBirth",
      "gender",
      "maritalStatus",
      "spouseName",
      "educationalQualification",
      "otherQualification",
    ],
  },
  {
    key: "documents",
    title: "Documents",
    description: "Upload each proof separately. Front and back stay as distinct required fields.",
    fields: [
      "identityProofType",
      "identityProofNumber",
      "identityProofUrlFront",
      "identityProofUrlBack",
      "addressProofType",
      "addressProofNumber",
      "addressProofUrlFront",
      "addressProofUrlBack",
      "signatureUrl",
    ],
  },
  {
    key: "details",
    title: "Details",
    description: "Finish statutory, bank, and contact details in one place.",
    fields: [
      "district",
      "panNumber",
      "epfUanNumber",
      "esicNumber",
      "policeClearanceCertificate",
      "bankAccountNumber",
      "ifscCode",
      "bankName",
      "bankPassbookStatement",
      "fullAddress",
      "emailAddress",
      "phoneNumber",
    ],
  },
  {
    key: "review",
    title: "Review",
    description: "Quickly verify the summary and confirm the declaration before submission.",
    fields: ["termsAndConditions"],
  },
];

function buildEnrollmentStoragePath(
  phoneNumber: string,
  folder: string,
  fileStem: string,
  file: File,
): string {
  const extension = getUploadFileExtension(file, "bin");
  return `employees/${phoneNumber}/${folder}/${Date.now()}_${fileStem}.${extension}`;
}

const IdNumberInput = ({
    control,
    name,
    label
} : {
    control: any,
    name: "identityProofNumber" | "addressProofNumber",
    label: string
}) => {
    const typeFieldName = name === "identityProofNumber" ? "identityProofType" : "addressProofType";
    const number = useWatch({ control, name: name });
    const type = useWatch({ control, name: typeFieldName });

    const [isValid, setIsValid] = React.useState<boolean | null>(null);

    React.useEffect(() => {
        if (!number || !type || !(type in idValidation)) {
            setIsValid(null);
            return;
        }
        const regex = idValidation[type as keyof typeof idValidation];
        setIsValid(regex.test(number));
    }, [number, type]);

    return (
        <FormField
            control={control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{label} <span className="text-destructive">*</span></FormLabel>
                    <div className="relative">
                        <FormControl>
                            <Input placeholder={`Enter ${label}`} {...field} />
                        </FormControl>
                        <div className="absolute inset-y-0 right-3 flex items-center">
                            {isValid === true && <CheckCircleIcon className="h-5 w-5 text-green-500" />}
                            {isValid === false && <X className="h-5 w-5 text-destructive" />}
                        </div>
                    </div>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
};


function ActualEnrollmentForm({ initialPhoneNumberFromQuery }: ActualEnrollmentFormProps) {
  const { toast } = useToast();
  const router = useRouter();

  const [profilePicPreview, setProfilePicPreview] = React.useState<string | null>(null);
  const [identityProofUrlFrontPreview, setIdentityProofUrlFrontPreview] = React.useState<string | null>(null);
  const [identityProofUrlBackPreview, setIdentityProofUrlBackPreview] = React.useState<string | null>(null);
  const [addressProofUrlFrontPreview, setAddressProofUrlFrontPreview] = React.useState<string | null>(null);
  const [addressProofUrlBackPreview, setAddressProofUrlBackPreview] = React.useState<string | null>(null);
  const [signatureUrlPreview, setSignatureUrlPreview] = React.useState<string | null>(null);
  const [bankPassbookPreview, setBankPassbookPreview] = React.useState<string | null>(null);
  const [policeCertPreview, setPoliceCertPreview] = React.useState<string | null>(null);

  const [isLoading, setIsLoading] = React.useState(false);
  const [availableClients, setAvailableClients] = useState<ClientOption[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);

  const [activeCameraField, setActiveCameraField] = useState<CameraField | null>(null);
  const [isCameraDialogOpen, setIsCameraDialogOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [submissionIssues, setSubmissionIssues] = useState<StepIssue[]>([]);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "restored">("idle");
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [isDraftReady, setIsDraftReady] = useState(false);
  const draftSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  const form = useForm<EnrollmentFormValues>({
    resolver: zodResolver(enrollmentFormSchema),
    mode: 'onTouched', 
    defaultValues: DEFAULT_ENROLLMENT_VALUES,
  });

  const watchClientName = form.watch("clientName");
  const watchMaritalStatus = form.watch("maritalStatus");
  const watchEducationalQualification = form.watch("educationalQualification");
  const watchedValues = useWatch({ control: form.control });
  const fullAddress = useWatch({ control: form.control, name: 'fullAddress' });
  const [pinStatus, setPinStatus] = useState<'found' | 'not_found' | 'idle'>('idle');

  useEffect(() => {
    if (!fullAddress || fullAddress.length < 15) { 
        setPinStatus('idle');
        return;
    }
    const pinRegex = /\b\d{6}\b/;
    if (pinRegex.test(fullAddress)) {
        setPinStatus('found');
    } else {
        setPinStatus('not_found');
    }
  }, [fullAddress]);

  useEffect(() => {
    if (initialPhoneNumberFromQuery && /^\d{10}$/.test(initialPhoneNumberFromQuery)) {
      form.setValue('phoneNumber', initialPhoneNumberFromQuery, { shouldValidate: true });
    }
  }, [initialPhoneNumberFromQuery, form]);

  const setPreviewForField = useCallback((fieldName: CameraField, previewUrl: string | null) => {
    switch (fieldName) {
      case "profilePicture":
        setProfilePicPreview(previewUrl);
        break;
      case "identityProofUrlFront":
        setIdentityProofUrlFrontPreview(previewUrl);
        break;
      case "identityProofUrlBack":
        setIdentityProofUrlBackPreview(previewUrl);
        break;
      case "addressProofUrlFront":
        setAddressProofUrlFrontPreview(previewUrl);
        break;
      case "addressProofUrlBack":
        setAddressProofUrlBackPreview(previewUrl);
        break;
      case "signatureUrl":
        setSignatureUrlPreview(previewUrl);
        break;
      case "bankPassbookStatement":
        setBankPassbookPreview(previewUrl);
        break;
      case "policeClearanceCertificate":
        setPoliceCertPreview(previewUrl);
        break;
    }
  }, []);

  const applySelectedFile = useCallback((fieldName: CameraField, file: File, options?: { shouldValidate?: boolean }) => {
    form.setValue(fieldName as keyof EnrollmentFormValues, file as EnrollmentFormValues[keyof EnrollmentFormValues], {
      shouldValidate: options?.shouldValidate ?? true,
      shouldDirty: true,
    });

    const previewUrl = file.type === "application/pdf" ? "/pdf-icon.png" : URL.createObjectURL(file);
    setPreviewForField(fieldName, previewUrl);
  }, [form, setPreviewForField]);

  const clearDraft = async (options?: { resetForm?: boolean; keepPhoneNumber?: boolean }) => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ENROLLMENT_DRAFT_STORAGE_KEY);
    }

    try {
      await clearEnrollmentDraftFiles();
    } catch (error) {
      console.error("Could not clear saved enrollment files:", error);
    }

    setDraftStatus("idle");
    setDraftUpdatedAt(null);
    setSubmissionIssues([]);

    if (options?.resetForm) {
      form.reset({
        ...DEFAULT_ENROLLMENT_VALUES,
        phoneNumber: options.keepPhoneNumber && initialPhoneNumberFromQuery ? initialPhoneNumberFromQuery : "",
      });
      setCurrentStep(0);
      setProfilePicPreview(null);
      setIdentityProofUrlFrontPreview(null);
      setIdentityProofUrlBackPreview(null);
      setAddressProofUrlFrontPreview(null);
      setAddressProofUrlBackPreview(null);
      setSignatureUrlPreview(null);
      setBankPassbookPreview(null);
      setPoliceCertPreview(null);
    }
  };

  useEffect(() => {
    let isCancelled = false;

    const restoreDraft = async () => {
      if (typeof window === "undefined") {
        return;
      }

      const storedDraft = window.localStorage.getItem(ENROLLMENT_DRAFT_STORAGE_KEY);
      if (!storedDraft) {
        setIsDraftReady(true);
        return;
      }

      try {
        const parsedDraft = JSON.parse(storedDraft) as EnrollmentDraft;
        const restoredValues = deserializeDraftValues(parsedDraft.values);

        form.reset({
          ...DEFAULT_ENROLLMENT_VALUES,
          ...restoredValues,
          phoneNumber: initialPhoneNumberFromQuery && /^\d{10}$/.test(initialPhoneNumberFromQuery)
            ? initialPhoneNumberFromQuery
            : (restoredValues.phoneNumber ?? ""),
        });

        const storedFiles = await readEnrollmentDraftFiles().catch((error) => {
          console.error("Could not read saved enrollment files:", error);
          return {};
        });

        if (!isCancelled) {
          for (const [fieldName, file] of Object.entries(storedFiles) as [CameraField, File][]) {
            applySelectedFile(fieldName, file, { shouldValidate: false });
          }

          setCurrentStep(Math.min(parsedDraft.currentStep ?? 0, ENROLLMENT_STEPS.length - 1));
          setDraftStatus("restored");
          setDraftUpdatedAt(parsedDraft.updatedAt ?? null);
          toast({
            title: "Saved draft restored",
            description: "Your enrollment details were loaded from this device so you can continue where you left off.",
          });
        }
      } catch (error) {
        console.error("Could not restore enrollment draft:", error);
      } finally {
        if (!isCancelled) {
          setIsDraftReady(true);
        }
      }
    };

    void restoreDraft();

    return () => {
      isCancelled = true;
    };
  }, [applySelectedFile, form, initialPhoneNumberFromQuery, toast]);

  useEffect(() => {
    if (!isDraftReady || typeof window === "undefined") {
      return;
    }

    if (draftSaveTimeoutRef.current) {
      clearTimeout(draftSaveTimeoutRef.current);
    }

    draftSaveTimeoutRef.current = setTimeout(() => {
      const values = form.getValues();
      const hasMeaningfulDraftContent =
        currentStep > 0 ||
        Object.entries(values).some(([fieldName, value]) => {
          if (isFileValue(value)) {
            return true;
          }
          if (value instanceof Date) {
            return true;
          }
          if (typeof value === "boolean") {
            return value;
          }
          if (typeof value === "string") {
            if (fieldName === "phoneNumber" && initialPhoneNumberFromQuery && value === initialPhoneNumberFromQuery) {
              return false;
            }
            return value.trim() !== "";
          }
          return false;
        });

      if (!hasMeaningfulDraftContent) {
        window.localStorage.removeItem(ENROLLMENT_DRAFT_STORAGE_KEY);
        void clearEnrollmentDraftFiles().catch((error) => {
          console.error("Could not clear empty enrollment draft:", error);
        });
        setDraftStatus("idle");
        setDraftUpdatedAt(null);
        return;
      }

      const nextDraft: EnrollmentDraft = {
        currentStep,
        updatedAt: new Date().toISOString(),
        values: serializeDraftValues(values),
      };

      setDraftStatus("saving");

      window.localStorage.setItem(ENROLLMENT_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
      void saveEnrollmentDraftFiles(values)
        .then(() => {
          setDraftStatus("saved");
          setDraftUpdatedAt(nextDraft.updatedAt);
        })
        .catch((error) => {
          console.error("Could not save enrollment draft:", error);
          setDraftStatus("idle");
        });
    }, 700);

    return () => {
      if (draftSaveTimeoutRef.current) {
        clearTimeout(draftSaveTimeoutRef.current);
      }
    };
  }, [currentStep, form, initialPhoneNumberFromQuery, isDraftReady, watchedValues]);

  useEffect(() => {
    const fetchClients = async () => {
        setIsLoadingClients(true);
        try {
            const clientsQuery = query(collection(db, 'clients'), orderBy('name', 'asc'));
            const snapshot = await getDocs(clientsQuery);
            const fetchedClients = snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name as string }));
            setAvailableClients(fetchedClients);
        } catch (error) {
            console.error("Error fetching clients for enrollment form: ", error);
            toast({ 
              variant: "destructive", 
              title: "Error Loading Clients", 
              description: "Could not load client list. Please check Firestore security rules." 
            });
        } finally {
            setIsLoadingClients(false);
        }
    };

    fetchClients();
  }, [toast]);

  useEffect(() => {
    if (isCameraDialogOpen && cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch(error => {
          console.error("Video play failed:", error);
          setCameraError("Could not play video stream. Please check camera connection or permissions.");
        });
      };
      videoRef.current.onerror = (e) => {
          console.error("Video element error:", e);
          setCameraError("There was an error with the video stream display.");
      };
    }
  }, [isCameraDialogOpen, cameraStream]);

  const openCamera = async (fieldName: CameraField) => {
    setActiveCameraField(fieldName);
    setCameraError(null);
    setIsCameraDialogOpen(true);

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        let facingMode: VideoFacingModeEnum = "user";
        if (fieldName !== "profilePicture") {
          facingMode = "environment";
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
        setCameraStream(stream);
      } catch (err) {
        console.error("Error accessing camera:", err);
        let errorMessage = "Could not access camera. Please ensure permission is granted in your browser settings.";
        if (err instanceof Error && err.name === "NotAllowedError") {
            errorMessage = "Camera access was denied. Please enable camera permissions in your browser settings.";
        } else if (err instanceof Error && err.name === "NotFoundError") {
            errorMessage = "No camera found. Please ensure a camera is connected and enabled.";
        }
        setCameraError(errorMessage);
        toast({ variant: "destructive", title: "Camera Error", description: errorMessage });
        setIsCameraDialogOpen(false);
        setCameraStream(null);
      }
    } else {
      setCameraError("Camera access is not supported by your browser.");
      toast({ variant: "destructive", title: "Camera Not Supported", description: "Your browser does not support camera access." });
      setIsCameraDialogOpen(false);
      setCameraStream(null);
    }
  };

  const closeCameraDialog = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }
    setCameraStream(null);
    setIsCameraDialogOpen(false);
    setActiveCameraField(null);
  };

  const handleCapturePhoto = async () => {
    if (videoRef.current && canvasRef.current && activeCameraField && cameraStream) {
      const canvas = canvasRef.current;
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const context = canvas.getContext('2d');
      context?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

      try {
        const fileName = `${activeCameraField}_capture_${Date.now()}.jpg`;
        const capturedFile = await dataURLtoFile(dataUrl, fileName);

        applySelectedFile(activeCameraField, capturedFile);
        
        toast({ title: "Photo Captured", description: `${activeCameraField.replace(/([A-Z])/g, ' $1').trim()} photo taken.` });
      } catch (error) {
        console.error("Error converting data URL to file:", error);
        toast({ variant: "destructive", title: "Capture Error", description: "Could not process captured photo." });
      } finally {
        closeCameraDialog();
      }
    }
  };

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    fieldName: any,
    setPreview: React.Dispatch<React.SetStateAction<string | null>>
  ) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const selectionError = getEnrollmentFileSelectionError(file);
      if (selectionError) {
        form.setError(fieldName, { type: "manual", message: selectionError });
        setPreview(null);
        if (event.target) event.target.value = "";
        return;
      }
      if (file.type.startsWith("image/") || file.type === "application/pdf") {
         applySelectedFile(fieldName as CameraField, file);
      } else {
        form.setError(fieldName, { type: "manual", message: "Invalid file type. Use JPG, PNG, WEBP, HEIC, HEIF or PDF." });
        setPreview(null);
      }
    } else {
      form.setValue(fieldName, undefined as any, { shouldValidate: true });
      setPreview(null);
    }
    if (event.target) {
        event.target.value = "";
    }
  };

  async function onSubmit(data: EnrollmentFormValues) {
    setIsLoading(true);
    toast({ title: "Processing Registration...", description: "Please wait. This may take a moment." });

    const phoneNumber = data.phoneNumber.replace(/\D/g, "");
    const uploadedUrls: { [key: string]: string | null } = {
        profilePictureUrl: null,
        identityProofUrlFront: null,
        identityProofUrlBack: null,
        addressProofUrlFront: null,
        addressProofUrlBack: null,
        signatureUrl: null,
        bankPassbookStatementUrl: null,
        policeClearanceCertificateUrl: null,
    };

    try {
        const filesToUpload: { name: string; file?: File; folder: string; fileStem: string; key: keyof typeof uploadedUrls }[] = [
            { name: "Profile Picture", file: data.profilePicture, folder: "profilePictures", fileStem: "profile", key: 'profilePictureUrl' },
            { name: "Identity Proof (Front)", file: data.identityProofUrlFront, folder: "idProofs", fileStem: "id_front", key: 'identityProofUrlFront' },
            { name: "Identity Proof (Back)", file: data.identityProofUrlBack, folder: "idProofs", fileStem: "id_back", key: 'identityProofUrlBack' },
            { name: "Address Proof (Front)", file: data.addressProofUrlFront, folder: "addressProofs", fileStem: "addr_front", key: 'addressProofUrlFront' },
            { name: "Address Proof (Back)", file: data.addressProofUrlBack, folder: "addressProofs", fileStem: "addr_back", key: 'addressProofUrlBack' },
            { name: "Signature", file: data.signatureUrl, folder: "signatures", fileStem: "sig", key: 'signatureUrl' },
            { name: "Bank Document", file: data.bankPassbookStatement, folder: "bankDocuments", fileStem: "bank", key: 'bankPassbookStatementUrl' },
            { name: "Police Certificate", file: data.policeClearanceCertificate, folder: "policeCertificates", fileStem: "pcc", key: 'policeClearanceCertificateUrl' },
        ];

        for (const { name, file, folder, fileStem, key } of filesToUpload) {
            if (!file) continue;
            toast({ title: `Uploading ${name}...`});
            try {
                const fileToUpload = await prepareFileForUpload(file);
                assertEnrollmentUploadSize(fileToUpload);
                const path = buildEnrollmentStoragePath(phoneNumber, folder, fileStem, fileToUpload);
                const url = await uploadFileToStorage(fileToUpload, path);
                uploadedUrls[key] = url;
            } catch (err: any) {
                 throw new Error(`Upload failed for ${name}: ${err.message}`);
            }
        }
        
        const response = await fetch("/api/employees/enroll", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            joiningDate: data.joiningDate.toISOString(),
            clientName: data.clientName,
            resourceIdNumber: data.resourceIdNumber || undefined,
            profilePictureUrl: uploadedUrls.profilePictureUrl,
            firstName: data.firstName,
            lastName: data.lastName,
            fatherName: data.fatherName,
            motherName: data.motherName,
            dateOfBirth: data.dateOfBirth.toISOString(),
            gender: data.gender,
            maritalStatus: data.maritalStatus,
            spouseName: data.spouseName || undefined,
            educationalQualification: data.educationalQualification,
            otherQualification: data.otherQualification || undefined,
            district: data.district,
            fullAddress: data.fullAddress,
            emailAddress: data.emailAddress,
            phoneNumber: data.phoneNumber,
            identityProofType: data.identityProofType,
            identityProofNumber: data.identityProofNumber,
            identityProofUrlFront: uploadedUrls.identityProofUrlFront,
            identityProofUrlBack: uploadedUrls.identityProofUrlBack,
            addressProofType: data.addressProofType,
            addressProofNumber: data.addressProofNumber,
            addressProofUrlFront: uploadedUrls.addressProofUrlFront,
            addressProofUrlBack: uploadedUrls.addressProofUrlBack,
            signatureUrl: uploadedUrls.signatureUrl,
            bankAccountNumber: data.bankAccountNumber || undefined,
            ifscCode: data.ifscCode || undefined,
            bankName: data.bankName || undefined,
            bankPassbookStatementUrl: uploadedUrls.bankPassbookStatementUrl || undefined,
            panNumber: data.panNumber || undefined,
            epfUanNumber: data.epfUanNumber || undefined,
            esicNumber: data.esicNumber || undefined,
            policeClearanceCertificateUrl: uploadedUrls.policeClearanceCertificateUrl || undefined,
          }),
        });

        const responseBody = await response.json();
        if (!response.ok) {
          throw new Error(responseBody.error || "Could not create employee record.");
        }

        toast({
            title: "Registration Successful!",
            description: `${data.firstName} ${data.lastName}'s profile has been created. ID: ${responseBody.employeeId}`,
            duration: 7000,
        });

        await clearDraft({ resetForm: true, keepPhoneNumber: !!initialPhoneNumberFromQuery });
        router.push(`/profile/${responseBody.id}`);

    } catch (error: any) {
        await Promise.allSettled(
          Object.values(uploadedUrls)
            .filter((url): url is string => Boolean(url))
            .map((url) => deleteFileFromStorage(url)),
        );
        console.error("Detailed Registration or Upload Error: ", error, error.stack);
        toast({
            variant: "destructive",
            title: "Registration Failed",
            description: error.message || "An unexpected error occurred.",
            duration: 9000,
        });
    } finally {
        setIsLoading(false);
    }
}


  const isPhoneNumberPrefilled = !!(initialPhoneNumberFromQuery && /^\d{10}$/.test(initialPhoneNumberFromQuery));
  const stepConfig = ENROLLMENT_STEPS[currentStep];
  const isLastStep = currentStep === ENROLLMENT_STEPS.length - 1;
  const completionPercent = Math.round(((currentStep + 1) / ENROLLMENT_STEPS.length) * 100);
  const validationIssuesByField = (() => {
    const parsed = enrollmentFormSchema.safeParse(form.getValues());
    const issues = new Map<keyof EnrollmentFormValues, number>();

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const fieldName = issue.path[0] as keyof EnrollmentFormValues | undefined;
        if (!fieldName) continue;
        issues.set(fieldName, (issues.get(fieldName) ?? 0) + 1);
      }
    }

    return issues;
  })();
  const draftStatusLabel =
    draftStatus === "saving"
      ? "Saving on this device..."
      : draftUpdatedAt
        ? `Saved on this device at ${new Date(draftUpdatedAt).toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })}`
        : "Changes stay saved on this device as you go.";

  const getStepIssues = () =>
    ENROLLMENT_STEPS.map((step, stepIndex) => {
      const fields = step.fields
        .filter((fieldName) => Boolean(form.getFieldState(fieldName).error))
        .map((fieldName) => FIELD_LABELS[fieldName] || step.title);

      return {
        stepIndex,
        title: step.title,
        fields,
      };
    }).filter((issue) => issue.fields.length > 0);

  const jumpToStep = (stepIndex: number) => {
    setCurrentStep(stepIndex);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleInvalidSubmission = () => {
    const issues = getStepIssues();
    setSubmissionIssues(issues);

    if (issues.length > 0) {
      jumpToStep(issues[0].stepIndex);
      toast({
        variant: "destructive",
        title: "Some required information is missing",
        description: `Please review ${issues[0].title.toLowerCase()} first. Missing: ${issues[0].fields.slice(0, 2).join(", ")}${issues[0].fields.length > 2 ? "..." : ""}.`,
        duration: 7000,
      });
    }
  };

  const goToNextStep = async () => {
    setSubmissionIssues([]);
    setCurrentStep((current) => Math.min(current + 1, ENROLLMENT_STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToPreviousStep = () => {
    setCurrentStep((current) => Math.max(current - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToStep = async (targetStep: number) => {
    if (targetStep === currentStep) return;
    setSubmissionIssues([]);
    jumpToStep(targetStep);
  };


  return (
    <>
      <Card className="mx-auto w-full max-w-6xl overflow-hidden border-t-4 border-primary shadow-xl">
        <CardHeader className="px-5 pb-4 pt-7 text-center sm:px-8 sm:pb-5 lg:px-10">
          <CardTitle className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Employee Registration</CardTitle>
          <CardDescription className="mx-auto mt-2 max-w-xl text-sm sm:text-base">Complete the form step by step.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-8 sm:px-8 lg:px-10">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit, handleInvalidSubmission)} className="space-y-8 pb-28 sm:pb-32">
              <div className="space-y-3 rounded-[24px] border bg-muted/20 p-3 sm:space-y-4 sm:p-5 lg:p-6">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">
                        Step {currentStep + 1} of {ENROLLMENT_STEPS.length}
                      </span>
                      <span className="font-semibold text-foreground">{stepConfig.title}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {completionPercent}% complete
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                    <span>{draftStatusLabel}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto px-0 py-0 text-xs text-primary hover:bg-transparent hover:text-primary/80"
                      onClick={() => void clearDraft({ resetForm: true, keepPhoneNumber: !!initialPhoneNumberFromQuery })}
                    >
                      Clear saved draft
                    </Button>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${completionPercent}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
                  {ENROLLMENT_STEPS.map((step, index) => {
                    const isActive = index === currentStep;
                    const stepErrorCount = step.fields.filter((fieldName) => validationIssuesByField.has(fieldName)).length;
                    const isComplete = stepErrorCount === 0;
                    return (
                      <button
                        key={step.key}
                        type="button"
                        className={cn(
                          "min-w-0 rounded-xl border px-3 py-2 text-left transition",
                          isActive && "border-primary bg-primary text-primary-foreground shadow-sm",
                          isComplete && "border-primary/30 bg-primary/10 text-primary",
                          stepErrorCount > 0 && !isActive && "border-amber-300 bg-amber-50 text-amber-900",
                          !isActive && !isComplete && stepErrorCount === 0 && "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                        )}
                        onClick={() => void goToStep(index)}
                      >
                        <span className="block text-[10px] uppercase tracking-[0.18em] opacity-80">
                          {stepErrorCount > 0 ? `${stepErrorCount} missing` : isActive ? "Current" : "Ready"}
                        </span>
                        <span className="mt-1 block text-sm font-semibold leading-tight sm:text-base">{step.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {submissionIssues.length > 0 && (
                <Alert variant="destructive" className="rounded-2xl border-red-200 bg-red-50 text-red-950">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Required information is still missing</AlertTitle>
                  <AlertDescription className="mt-3 space-y-3">
                    <p>Please use the step buttons below to jump directly to the missing sections.</p>
                    <div className="flex flex-wrap gap-2">
                      {submissionIssues.map((issue) => (
                        <Button
                          key={issue.title}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="border-red-200 bg-background text-red-900 hover:bg-red-100"
                          onClick={() => jumpToStep(issue.stepIndex)}
                        >
                          {issue.title} ({issue.fields.length})
                        </Button>
                      ))}
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {submissionIssues.map((issue) => (
                        <div key={`${issue.title}-fields`} className="rounded-xl border border-red-200 bg-background px-3 py-2">
                          <p className="text-sm font-semibold text-red-900">{issue.title}</p>
                          <p className="mt-1 text-sm text-red-800">{issue.fields.join(", ")}</p>
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {currentStep === 0 && (
                <FormSection title="Client Information">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <DateInputField
                      control={form.control}
                      name="joiningDate"
                      label="Joining Date"
                      max={format(new Date(), "yyyy-MM-dd")}
                      description="A native date picker is used here so it is easier on phones."
                    />
                    <FormField control={form.control} name="clientName" render={({ field }) => (
                        <FormItem><FormLabel>Client Name <span className="text-destructive">*</span></FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoadingClients}>
                            <FormControl><SelectTrigger><SelectValue placeholder={isLoadingClients ? "Loading clients..." : "Select client"} /></SelectTrigger></FormControl>
                            <SelectContent>{isLoadingClients ? (<SelectItem value="loading" disabled>Loading...</SelectItem>) : availableClients.length === 0 ? (<SelectItem value="no-clients" disabled>No clients available</SelectItem>) : (availableClients.map(client => <SelectItem key={client.id} value={client.name}>{client.name}</SelectItem>))}</SelectContent>
                          </Select>
                          <FormDescription>Choose the deployment client first. The remaining review stays aligned to this selection.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {watchClientName === "TCS" && (
                      <FormField control={form.control} name="resourceIdNumber" render={({ field }) => (
                          <FormItem className="md:col-span-2"><FormLabel>Resource ID Number <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter Resource ID Number" {...field} /></FormControl><FormMessage /></FormItem>
                        )} 
                      />
                    )}
                  </div>
                </FormSection>
              )}

              {currentStep === 1 && (
                <FormSection title="Personal Information">
                  <FormField control={form.control} name="profilePicture" render={({ field }) => ( 
                      <FormItem className="mb-6 text-center"><FormLabel className="block mb-2 font-semibold">Profile Picture <span className="text-destructive">*</span></FormLabel>
                         <div className="flex flex-col items-center gap-4">
                          {profilePicPreview ? (<Image src={profilePicPreview} alt="Profile preview" width={128} height={128} className="rounded-full object-cover h-32 w-32 border-2 border-primary" data-ai-hint="profile photo"/>) : (<div className="flex items-center justify-center h-32 w-32 rounded-full bg-muted border"><UserCircle2 className="h-20 w-20 text-muted-foreground" /></div>)}
                          <div className="flex w-full flex-col justify-center gap-2 sm:w-auto sm:flex-row">
                             <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('profilePictureInput')?.click()}><Upload className="mr-2 h-4 w-4" /> Upload</Button>
                             <Button type="button" variant="outline" size="sm" onClick={() => openCamera("profilePicture")}><Camera className="mr-2 h-4 w-4" /> Take Photo</Button>
                          </div>
                          <FormControl><Input id="profilePictureInput" type="file" className="hidden" accept={ENROLLMENT_IMAGE_ACCEPT} onChange={(e) => handleFileChange(e, "profilePicture", setProfilePicPreview)}/></FormControl>
                          <FormDescription>Phone photos and gallery images work better here now, including larger photos before compression.</FormDescription>
                          <FormMessage />
                         </div>
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-8">
                    <FormField control={form.control} name="firstName" render={({ field }) => (<FormItem><FormLabel>First Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter first name" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="lastName" render={({ field }) => (<FormItem><FormLabel>Last Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter last name" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="fatherName" render={({ field }) => (<FormItem><FormLabel>Father's Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter father's name" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="motherName" render={({ field }) => (<FormItem><FormLabel>Mother's Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter mother's name" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <DateInputField
                      control={form.control}
                      name="dateOfBirth"
                      label="Date of Birth"
                      min={format(new Date(new Date().getFullYear() - 65, 0, 1), "yyyy-MM-dd")}
                      max={format(new Date(new Date().getFullYear() - 18, 11, 31), "yyyy-MM-dd")}
                      description="Using a direct date field reduces taps on mobile devices."
                    />
                    <FormField control={form.control} name="gender" render={({ field }) => (
                        <FormItem><FormLabel>Gender <span className="text-destructive">*</span></FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger></FormControl><SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select><FormMessage />
                        </FormItem>
                      )}
                    />
                     <FormField control={form.control} name="maritalStatus" render={({ field }) => (
                        <FormItem><FormLabel>Marital Status <span className="text-destructive">*</span></FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select marital status" /></SelectTrigger></FormControl><SelectContent>{maritalStatuses.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select><FormMessage />
                        </FormItem>
                      )}
                    />
                    {watchMaritalStatus === "Married" && <FormField control={form.control} name="spouseName" render={({ field }) => (<FormItem><FormLabel>Spouse Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter spouse's name" {...field} /></FormControl><FormMessage /></FormItem>)}/>}
                    <FormField control={form.control} name="educationalQualification" render={({ field }) => (
                        <FormItem><FormLabel>Educational Qualification <span className="text-destructive">*</span></FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select qualification" /></SelectTrigger></FormControl><SelectContent>{educationOptions.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select><FormMessage />
                        </FormItem>
                      )}
                    />
                    {watchEducationalQualification === "Any Other Qualification" && <FormField control={form.control} name="otherQualification" render={({ field }) => (<FormItem><FormLabel>Please Specify Qualification <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="e.g., B.Tech in Computer Science" {...field} /></FormControl><FormMessage /></FormItem>)}/>}
                  </div>
                </FormSection>
              )}

              {currentStep === 2 && (
                <FormSection title="Identification Documents">
                  <div className="p-4 border rounded-lg mt-4 space-y-4 bg-muted/20">
                      <h3 className="font-medium text-lg">Identity Proof</h3>
                      <p className="text-sm text-muted-foreground">Front and back stay separate on purpose so the review and verification stay clear.</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <FormField control={form.control} name="identityProofType" render={({ field }) => ( <FormItem><FormLabel>Document Type <span className="text-destructive">*</span></FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select ID proof type" /></SelectTrigger></FormControl><SelectContent>{idProofOptions.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                          <IdNumberInput control={form.control} name="identityProofNumber" label="Document Number" />
                      </div>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                          <FormField control={form.control} name="identityProofUrlFront" render={({ field }) => ( <FormItem className="text-center"><FormLabel className="block mb-2">Front Page <span className="text-destructive">*</span></FormLabel><ImagePreviewAndUpload fieldName="identityProofUrlFront" preview={identityProofUrlFrontPreview} setPreview={setIdentityProofUrlFrontPreview} handleFileChange={handleFileChange} openCamera={openCamera} helperText="Upload the front side only." /><FormMessage /></FormItem> )} />
                          <FormField control={form.control} name="identityProofUrlBack" render={({ field }) => ( <FormItem className="text-center"><FormLabel className="block mb-2">Back Page <span className="text-destructive">*</span></FormLabel><ImagePreviewAndUpload fieldName="identityProofUrlBack" preview={identityProofUrlBackPreview} setPreview={setIdentityProofUrlBackPreview} handleFileChange={handleFileChange} openCamera={openCamera} helperText="Upload the back side only." /><FormMessage /></FormItem> )} />
                      </div>
                  </div>

                  <div className="p-4 border rounded-lg mt-6 space-y-4 bg-muted/20">
                      <h3 className="font-medium text-lg">Address Proof</h3>
                      <p className="text-sm text-muted-foreground">Use a different proof type than the identity proof and upload both sides separately.</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <FormField control={form.control} name="addressProofType" render={({ field }) => ( <FormItem><FormLabel>Document Type <span className="text-destructive">*</span></FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select Address proof type" /></SelectTrigger></FormControl><SelectContent>{idProofOptions.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                           <IdNumberInput control={form.control} name="addressProofNumber" label="Document Number" />
                      </div>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                          <FormField control={form.control} name="addressProofUrlFront" render={({ field }) => ( <FormItem className="text-center"><FormLabel className="block mb-2">Front Page <span className="text-destructive">*</span></FormLabel><ImagePreviewAndUpload fieldName="addressProofUrlFront" preview={addressProofUrlFrontPreview} setPreview={setAddressProofUrlFrontPreview} handleFileChange={handleFileChange} openCamera={openCamera} helperText="Upload the front side only." /><FormMessage /></FormItem> )} />
                          <FormField control={form.control} name="addressProofUrlBack" render={({ field }) => ( <FormItem className="text-center"><FormLabel className="block mb-2">Back Page <span className="text-destructive">*</span></FormLabel><ImagePreviewAndUpload fieldName="addressProofUrlBack" preview={addressProofUrlBackPreview} setPreview={setAddressProofUrlBackPreview} handleFileChange={handleFileChange} openCamera={openCamera} helperText="Upload the back side only." /><FormMessage /></FormItem> )} />
                      </div>
                  </div>

                   <div className="p-4 border rounded-lg mt-6 space-y-4 bg-muted/20">
                      <h3 className="font-medium text-lg">Signature</h3>
                       <FormField control={form.control} name="signatureUrl" render={({ field }) => ( <FormItem className="text-center"><FormLabel className="block mb-2">Employee Signature <span className="text-destructive">*</span></FormLabel><ImagePreviewAndUpload fieldName="signatureUrl" preview={signatureUrlPreview} setPreview={setSignatureUrlPreview} handleFileChange={handleFileChange} openCamera={openCamera} isSignature={true} helperText="Sign on plain paper, then upload a clear photo." /><FormMessage /></FormItem> )} />
                  </div>
                </FormSection>
              )}

              {currentStep === 3 && (
                <>
                  <FormSection title="Statutory & Other Details">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField control={form.control} name="district" render={({ field }) => ( <FormItem><FormLabel>District <span className="text-destructive">*</span></FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select your district" /></SelectTrigger></FormControl><SelectContent>{keralaDistricts.map(dist => <SelectItem key={dist} value={dist}>{dist}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="panNumber" render={({ field }) => (<FormItem><FormLabel>PAN Card Number</FormLabel><FormControl><Input placeholder="Enter PAN card number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="epfUanNumber" render={({ field }) => (<FormItem><FormLabel>EPF UAN Number</FormLabel><FormControl><Input placeholder="Enter EPF UAN number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="esicNumber" render={({ field }) => (<FormItem><FormLabel>ESIC Number</FormLabel><FormControl><Input placeholder="Enter ESIC number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    </div>
                    <div className="grid grid-cols-1 mt-6"><FormField control={form.control} name="policeClearanceCertificate" render={({ field }) => ( <FormItem className="text-center"><FormLabel className="block mb-2">Police Clearance Certificate</FormLabel><ImagePreviewAndUpload fieldName="policeClearanceCertificate" preview={policeCertPreview} setPreview={setPoliceCertPreview} handleFileChange={handleFileChange} openCamera={openCamera} optional helperText="Optional. Upload only if available." /><FormMessage /></FormItem> )}/></div>
                  </FormSection>

                  <FormSection title="Bank Account Details">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField control={form.control} name="bankAccountNumber" render={({ field }) => (<FormItem><FormLabel>Bank Account Number</FormLabel><FormControl><Input placeholder="Enter bank account number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="ifscCode" render={({ field }) => (<FormItem><FormLabel>IFSC Code</FormLabel><FormControl><Input placeholder="Enter bank IFSC code" {...field} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="bankName" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>Bank Name</FormLabel><FormControl><Input placeholder="Full name of your bank" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    </div>
                    <FormField control={form.control} name="bankPassbookStatement" render={({ field }) => ( <FormItem className="mt-6 text-center"><FormLabel className="block mb-2">Bank Passbook / Statement</FormLabel><ImagePreviewAndUpload fieldName="bankPassbookStatement" preview={bankPassbookPreview} setPreview={setBankPassbookPreview} handleFileChange={handleFileChange} openCamera={openCamera} optional helperText="Optional. A clear copy helps speed up verification." /><FormMessage /></FormItem>)}/>
                  </FormSection>

                  <FormSection title="Contact Information">
                    <div className="grid grid-cols-1 gap-6">
                      <FormField control={form.control} name="fullAddress" render={({ field }) => ( 
                        <FormItem>
                            <div className="flex justify-between items-center"><FormLabel>Full Address <span className="text-destructive">*</span></FormLabel>
                                {pinStatus === 'found' && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircleIcon className="h-3 w-3" /> PIN Code Detected</span>}
                                {pinStatus === 'not_found' && <span className="text-xs text-orange-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> PIN Code Missing?</span>}
                            </div><FormControl><Textarea placeholder="Enter your complete residential address, including PIN code" {...field} /></FormControl><FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                      <FormField control={form.control} name="emailAddress" render={({ field }) => (<FormItem><FormLabel>Email Address <span className="text-destructive">*</span></FormLabel><FormControl><Input type="email" placeholder="yourname@example.com" {...field} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="phoneNumber" render={({ field }) => (<FormItem><FormLabel>Phone Number <span className="text-destructive">*</span></FormLabel><FormControl><Input type="tel" placeholder="10-digit mobile number" {...field} disabled={isPhoneNumberPrefilled} /></FormControl><FormDescription>{isPhoneNumberPrefilled ? "(Pre-filled from login)" : "This is used for your employee profile and document folder."}</FormDescription><FormMessage /></FormItem>)}/>
                    </div>
                  </FormSection>
                </>
              )}

              {currentStep === 4 && (
                <FormSection title="Review & Declaration">
                  <div className="grid gap-4 md:grid-cols-2">
                    <ReviewCard title="Client">
                      <ReviewRow label="Joining Date" value={watchedValues?.joiningDate ? format(watchedValues.joiningDate, "dd-MM-yyyy") : "Not added"} />
                      <ReviewRow label="Client" value={watchedValues?.clientName || "Not selected"} />
                      {watchedValues?.clientName === "TCS" && <ReviewRow label="Resource ID" value={watchedValues?.resourceIdNumber || "Missing"} />}
                    </ReviewCard>
                    <ReviewCard title="Personal">
                      <ReviewRow label="Name" value={[watchedValues?.firstName, watchedValues?.lastName].filter(Boolean).join(" ") || "Not added"} />
                      <ReviewRow label="DOB" value={watchedValues?.dateOfBirth ? format(watchedValues.dateOfBirth, "dd-MM-yyyy") : "Not added"} />
                      <ReviewRow label="Gender" value={watchedValues?.gender || "Not selected"} />
                      <ReviewRow label="Qualification" value={watchedValues?.educationalQualification || "Not selected"} />
                    </ReviewCard>
                    <ReviewCard title="Documents">
                      <ReviewRow label="Profile picture" value={profilePicPreview ? "Ready" : "Missing"} />
                      <ReviewRow label="ID proof front" value={identityProofUrlFrontPreview ? "Ready" : "Missing"} />
                      <ReviewRow label="ID proof back" value={identityProofUrlBackPreview ? "Ready" : "Missing"} />
                      <ReviewRow label="Address proof front" value={addressProofUrlFrontPreview ? "Ready" : "Missing"} />
                      <ReviewRow label="Address proof back" value={addressProofUrlBackPreview ? "Ready" : "Missing"} />
                      <ReviewRow label="Signature" value={signatureUrlPreview ? "Ready" : "Missing"} />
                    </ReviewCard>
                    <ReviewCard title="Contact">
                      <ReviewRow label="Phone" value={watchedValues?.phoneNumber || "Not added"} />
                      <ReviewRow label="Email" value={watchedValues?.emailAddress || "Not added"} />
                      <ReviewRow label="District" value={watchedValues?.district || "Not selected"} />
                      <ReviewRow label="Address" value={watchedValues?.fullAddress || "Not added"} />
                    </ReviewCard>
                  </div>

                  <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
                    <div className="h-48 overflow-y-auto rounded-md border bg-background p-4 text-xs text-muted-foreground space-y-2">
                      <p className="font-bold">I. General Eligibility and Compliance</p><ul className="list-disc list-outside pl-4 space-y-1"><li>I confirm I meet the eligibility criteria under the PSARA Act, 2005 and Kerala state rules, including age (18-65), physical fitness, and Indian citizenship.</li><li>I understand my enrollment is provisional and subject to a successful background and character verification by the relevant authorities.</li><li>I agree to complete all mandatory training and refresher courses as required by the company and regulatory bodies.</li></ul>
                      <p className="font-bold">II. Employment Terms & Responsibilities</p><ul className="list-disc list-outside pl-4 space-y-1"><li>My employment terms, including working hours, wages, and leaves, will be governed by applicable labour laws.</li><li>I will perform my duties diligently, maintain strict discipline, protect client property, and follow all lawful instructions.</li><li>I will maintain strict confidentiality of all client and company information and will not disclose it to any unauthorized person.</li><li>I will report for duty on time, in uniform, and will not consume intoxicating substances on duty, use unauthorized force, or abandon my post without proper relief.</li></ul>
                      <p className="font-bold">III. Disciplinary Action</p><ul className="list-disc list-outside pl-4 space-y-1"><li>I understand that any breach of these terms, misconduct, or violation of laws can lead to disciplinary action, up to and including termination of employment.</li></ul>
                      <p className="font-bold">IV. Declaration</p><p>I hereby declare that I have read, understood, and agree to abide by all the terms and conditions stated above for my enrollment. I confirm that all information and documents provided by me are true and correct to the best of my knowledge.</p>
                    </div>
                    <FormField control={form.control} name="termsAndConditions" render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border bg-background p-4 shadow-sm"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange}/></FormControl>
                          <div className="space-y-1 leading-none"><FormLabel>I have reviewed the summary and agree to the Terms and Conditions of Enrollment.</FormLabel><FormMessage /></div>
                        </FormItem>
                      )}
                    />
                  </div>
                </FormSection>
              )}

              <div className="sticky bottom-3 z-10 rounded-2xl border bg-background/95 px-4 py-4 shadow-lg backdrop-blur sm:px-5 lg:px-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <p className="text-sm text-muted-foreground">
                    {isLastStep ? "One final check, then you can submit with confidence." : "Use Next to move forward without losing your place on mobile."}
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button type="button" variant="outline" onClick={goToPreviousStep} disabled={currentStep === 0 || isLoading || form.formState.isSubmitting}>
                      <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    {isLastStep ? (
                      <Button type="submit" className="w-full sm:w-auto" size="lg" disabled={isLoading || form.formState.isSubmitting}>
                        {isLoading || form.formState.isSubmitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...</>) : "Complete Registration"}
                      </Button>
                    ) : (
                      <Button type="button" className="w-full sm:w-auto" size="lg" onClick={goToNextStep} disabled={isLoading || form.formState.isSubmitting}>
                        Next <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Dialog open={isCameraDialogOpen} onOpenChange={(isOpen) => { if (!isOpen) closeCameraDialog(); }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Take Photo for {activeCameraField?.replace(/([A-Z])/g, ' $1').trim()}</DialogTitle>
            <ShadDialogDescription>Use your device camera to capture a clear photo.</ShadDialogDescription>
          </DialogHeader>
          <div className="py-4">
            {cameraError && (<Alert variant="destructive" className="mb-4"><AlertCircle className="h-4 w-4" /><AlertTitle>Camera Error</AlertTitle><AlertDescription>{cameraError}</AlertDescription></Alert>)}
            {(cameraStream && !cameraError) && (<video ref={videoRef} autoPlay muted playsInline className="w-full h-auto rounded-md border aspect-video bg-muted" />)}
            {(!cameraStream && isCameraDialogOpen && !cameraError) && (<div className="w-full aspect-video bg-muted rounded-md flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /><p className="ml-2">Starting camera...</p></div>)}
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <DialogFooter><Button variant="outline" onClick={closeCameraDialog}>Cancel</Button><Button onClick={handleCapturePhoto} disabled={!cameraStream || !!cameraError || isLoading}>{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}Capture Photo</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const ImagePreviewAndUpload: React.FC<{
  fieldName: any;
  preview: string | null;
  setPreview: (p: string | null) => void;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>, fieldName: any, setPreview: any) => void;
  openCamera: (fieldName: any) => void;
  isSignature?: boolean;
  helperText?: string;
  optional?: boolean;
}> = ({ fieldName, preview, setPreview, handleFileChange, openCamera, isSignature, helperText, optional }) => {
    return (
        <div className="rounded-2xl border bg-background p-4">
            <div className="mb-3 flex items-center justify-between gap-3 text-xs">
                <span className={cn("rounded-full px-2.5 py-1 font-medium", preview ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>
                    {preview ? "Ready to upload" : optional ? "Optional" : "Required"}
                </span>
                <span className="text-right text-muted-foreground">
                    {preview ? "Looks good for submission." : "No file selected yet."}
                </span>
            </div>
            {preview && (preview === "/pdf-icon.png" ? 
                <Image src={preview} alt="PDF icon" width={80} height={100} className="mx-auto mb-2 border object-contain h-32 bg-white rounded" data-ai-hint="document pdf"/> :
                <Image src={preview} alt={`${fieldName} Preview`} width={200} height={isSignature ? 100 : 120} className="mx-auto mb-2 border object-contain h-32 rounded" data-ai-hint="id document"/>
            )}
            {!preview && <div className="flex items-center justify-center h-32 w-full bg-slate-200 dark:bg-slate-800 border-2 border-dashed rounded-md mb-2"><FileUp className="h-12 w-12 text-muted-foreground"/></div> }
            <div className="flex flex-col justify-center gap-2 sm:flex-row">
                <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById(`${fieldName}Input`)?.click()}><Upload className="mr-2 h-4 w-4"/> Upload</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => openCamera(fieldName)}><Camera className="mr-2 h-4 w-4"/> Camera</Button>
            </div>
            <FormControl><Input id={`${fieldName}Input`} type="file" className="hidden" accept={ENROLLMENT_DOCUMENT_ACCEPT} onChange={(e) => handleFileChange(e, fieldName, setPreview)} /></FormControl>
            {helperText && <p className="mt-3 text-sm text-muted-foreground">{helperText}</p>}
        </div>
    );
};

const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-6 pt-6">
    <div className="relative">
      <div className="absolute inset-0 flex items-center" aria-hidden="true">
        <div className="w-full border-t border-dashed" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-card px-3 text-xl font-semibold text-primary">{title}</span>
      </div>
    </div>
    {children}
  </section>
);

const DateInputField = ({
  control,
  name,
  label,
  description,
  min,
  max,
}: {
  control: any;
  name: "joiningDate" | "dateOfBirth";
  label: string;
  description: string;
  min?: string;
  max?: string;
}) => (
  <FormField
    control={control}
    name={name}
    render={({ field }) => (
      <FormItem>
        <FormLabel>{label} <span className="text-destructive">*</span></FormLabel>
        <FormControl>
          <Input
            type="date"
            value={field.value ? format(field.value, "yyyy-MM-dd") : ""}
            min={min}
            max={max}
            onChange={(event) => {
              const value = event.target.value;
              field.onChange(value ? new Date(`${value}T00:00:00`) : undefined);
            }}
          />
        </FormControl>
        <FormDescription>{description}</FormDescription>
        <FormMessage />
      </FormItem>
    )}
  />
);

const ReviewCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border bg-background p-4">
    <h3 className="text-base font-semibold">{title}</h3>
    <div className="mt-3 space-y-2 text-sm">{children}</div>
  </div>
);

const ReviewRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start justify-between gap-3 border-b border-dashed pb-2 last:border-b-0 last:pb-0">
    <span className="text-muted-foreground">{label}</span>
    <span className="max-w-[60%] text-right font-medium">{value}</span>
  </div>
);

function EnrollmentFormWrapper() {
  const searchParams = useSearchParams();
  const initialPhoneNumberFromQuery = searchParams.get('phone');
  return <ActualEnrollmentForm initialPhoneNumberFromQuery={initialPhoneNumberFromQuery} />;
}


function EnrollmentPageSkeleton() {
  return (
    <Card className="shadow-xl">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">Employee Registration</CardTitle>
        <CardDescription>Loading form...</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex justify-center items-center h-96">
          <Loader2 className="h-16 w-16 animate-spin text-primary" />
          <p className="ml-4 text-lg text-muted-foreground">Preparing enrollment form...</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EnrollEmployeePage() {
  return (
    <div className="min-h-screen w-full bg-[linear-gradient(180deg,rgba(224,239,255,0.55),rgba(255,255,255,0.95)_16%,rgba(245,247,251,0.9)_100%)]">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
          <div className="mb-4 sm:mb-6">
            <Button asChild variant="ghost" size="sm">
                <Link href="/" className="flex items-center text-sm text-primary hover:underline">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Home
                </Link>
            </Button>
          </div>
          <Suspense fallback={<EnrollmentPageSkeleton />}>
            <EnrollmentFormWrapper />
          </Suspense>
        </div>
    </div>
  );
}
