
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
import React, { Suspense, useEffect, useState, useRef } from "react";
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

interface ClientOption {
  id: string;
  name: string;
}

const keralaDistricts = [...KERALA_DISTRICTS];
const idProofOptions = [...PROOF_TYPES];
const maritalStatuses = [...MARITAL_STATUSES];
const educationOptions = [...EDUCATION_OPTIONS];


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


  const form = useForm<EnrollmentFormValues>({
    resolver: zodResolver(enrollmentFormSchema),
    mode: 'onTouched', 
    defaultValues: {
        clientName: '',
        resourceIdNumber: '',
        firstName: '',
        lastName: '',
        fatherName: '',
        motherName: '',
        gender: undefined,
        maritalStatus: undefined,
        spouseName: '',
        educationalQualification: undefined,
        otherQualification: '',
        district: '',
        panNumber: '',
        identityProofType: undefined,
        identityProofNumber: '',
        addressProofType: undefined,
        addressProofNumber: '',
        epfUanNumber: '',
        esicNumber: '',
        bankAccountNumber: '',
        ifscCode: '',
        bankName: '',
        fullAddress: '',
        emailAddress: '',
        phoneNumber: '',
        termsAndConditions: false,
     },
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
        
        form.setValue(activeCameraField as any, capturedFile, { shouldValidate: true });

        const previewUrl = URL.createObjectURL(capturedFile);
        switch(activeCameraField) {
            case "profilePicture": setProfilePicPreview(previewUrl); break;
            case "identityProofUrlFront": setIdentityProofUrlFrontPreview(previewUrl); break;
            case "identityProofUrlBack": setIdentityProofUrlBackPreview(previewUrl); break;
            case "addressProofUrlFront": setAddressProofUrlFrontPreview(previewUrl); break;
            case "addressProofUrlBack": setAddressProofUrlBackPreview(previewUrl); break;
            case "signatureUrl": setSignatureUrlPreview(previewUrl); break;
            case "bankPassbookStatement": setBankPassbookPreview(previewUrl); break;
            case "policeClearanceCertificate": setPoliceCertPreview(previewUrl); break;
        }
        
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
         form.setValue(fieldName, file, { shouldValidate: true });
         if (file.type.startsWith("image/")) {
            setPreview(URL.createObjectURL(file));
         } else if (file.type === "application/pdf") {
             setPreview("/pdf-icon.png");
         }
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

        form.reset();
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
  const completedDocumentCount = [
    profilePicPreview,
    identityProofUrlFrontPreview,
    identityProofUrlBackPreview,
    addressProofUrlFrontPreview,
    addressProofUrlBackPreview,
    signatureUrlPreview,
  ].filter(Boolean).length;

  const goToNextStep = async () => {
    const isStepValid = await form.trigger(stepConfig.fields, { shouldFocus: true });
    if (!isStepValid) {
      toast({
        variant: "destructive",
        title: "Please complete this step",
        description: `Check the highlighted fields in ${stepConfig.title.toLowerCase()} before continuing.`,
      });
      return;
    }

    setCurrentStep((current) => Math.min(current + 1, ENROLLMENT_STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToPreviousStep = () => {
    setCurrentStep((current) => Math.max(current - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };


  return (
    <>
      <Card className="mx-auto w-full max-w-6xl overflow-hidden border-t-4 border-primary shadow-xl">
        <CardHeader className="px-5 pb-6 pt-8 text-center sm:px-8 lg:px-10">
          <CardTitle className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">Employee Registration</CardTitle>
          <CardDescription className="mx-auto mt-3 max-w-2xl text-base sm:text-lg">Please complete your profile with accurate information.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-8 sm:px-8 lg:px-10">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 pb-28 sm:pb-32">
              <div className="space-y-4 rounded-[28px] border bg-muted/30 p-4 sm:p-6 lg:p-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-3xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.32em] text-primary">Step {currentStep + 1} of {ENROLLMENT_STEPS.length}</p>
                    <h3 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{stepConfig.title}</h3>
                    <p className="mt-2 max-w-2xl text-base text-muted-foreground sm:text-lg">{stepConfig.description}</p>
                  </div>
                  <div className="rounded-2xl border bg-background px-4 py-3 sm:px-5">
                    <div className="flex items-end gap-3">
                      <p className="text-3xl font-semibold sm:text-4xl">{Math.round(((currentStep + 1) / ENROLLMENT_STEPS.length) * 100)}%</p>
                      <p className="pb-1 text-sm text-muted-foreground">complete</p>
                    </div>
                    <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${Math.round(((currentStep + 1) / ENROLLMENT_STEPS.length) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                  {ENROLLMENT_STEPS.map((step, index) => {
                    const isActive = index === currentStep;
                    const isComplete = index < currentStep;
                    return (
                      <button
                        key={step.key}
                        type="button"
                        className={cn(
                          "min-w-0 rounded-2xl border px-4 py-3 text-left transition",
                          isActive && "border-primary bg-primary text-primary-foreground shadow-sm",
                          isComplete && "border-primary/30 bg-primary/10 text-primary",
                          !isActive && !isComplete && "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                        )}
                        onClick={() => {
                          if (index <= currentStep) {
                            setCurrentStep(index);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }
                        }}
                      >
                        <span className="block text-[11px] uppercase tracking-[0.24em] opacity-80">{isComplete ? "Done" : `Step ${index + 1}`}</span>
                        <span className="mt-2 block text-lg font-semibold leading-tight">{step.title}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatusPill label="Required proofs" value={`${completedDocumentCount}/6 ready`} tone={completedDocumentCount === 6 ? "success" : "pending"} />
                  <StatusPill label="Client" value={watchedValues?.clientName || "Pending"} tone={watchedValues?.clientName ? "success" : "pending"} />
                  <StatusPill label="Contact" value={watchedValues?.phoneNumber ? "Added" : "Pending"} tone={watchedValues?.phoneNumber ? "success" : "pending"} />
                  <StatusPill label="Declaration" value={watchedValues?.termsAndConditions ? "Accepted" : "Pending"} tone={watchedValues?.termsAndConditions ? "success" : "pending"} />
                </div>
              </div>

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

const StatusPill = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "pending";
}) => (
  <div className="rounded-2xl border bg-background px-4 py-4 shadow-sm">
    <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{label}</p>
    <p className={cn("mt-2 text-xl font-semibold leading-tight break-words", tone === "success" ? "text-green-700" : "text-amber-700")}>{value}</p>
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
