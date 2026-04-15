
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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarIcon, UserPlus, FileUp, Check, ArrowLeft, Upload, Camera, UserCircle2, Loader2, AlertCircle, X, CheckCircle as CheckCircleIcon, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subYears, addYears } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/firebase"; 
import { collection, query, orderBy, onSnapshot, getDocs } from "firebase/firestore";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useRouter } from "next/navigation";
import { EDUCATION_OPTIONS, MARITAL_STATUSES, PROOF_TYPES } from "@/lib/constants";
import {
  canonicalizeDistrictName,
  getDefaultDistrictSuggestions,
  isRecognizedDistrictName,
} from "@/lib/districts";
import { REGION_CODE } from "@/lib/runtime-config";


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
  clientName: z.string({ required_error: "Client name is required." }),
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
  district: z.string({ required_error: "District is required." }),
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
}).superRefine((data, ctx) => {
  if (data.clientName === "TCS" && (!data.resourceIdNumber || data.resourceIdNumber.trim() === "")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Resource ID number is required for TCS client.", path: ["resourceIdNumber"] });
  }
  if (data.maritalStatus === "Married" && (!data.spouseName || data.spouseName.trim() === "")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Spouse name is required if married.", path: ["spouseName"] });
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
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid format for ${identityProofType}.`, path: ["identityProofNumber"] });
    }
  }

  const { addressProofType, addressProofNumber } = data;
   if (addressProofType in idValidation) {
    const regex = idValidation[addressProofType as keyof typeof idValidation];
    if (!regex.test(addressProofNumber)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid format for ${addressProofType}.`, path: ["addressProofNumber"] });
    }
  }
});

type EnrollmentFormValues = z.infer<typeof enrollmentFormSchema>;

interface ClientOption {
  id: string;
  name: string;
}

const districtSuggestions = getDefaultDistrictSuggestions(REGION_CODE);
const idProofOptions = [...PROOF_TYPES];
const maritalStatuses = [...MARITAL_STATUSES];
const educationOptions = [...EDUCATION_OPTIONS];


type CameraField = "profilePicture" | "identityProofUrlFront" | "identityProofUrlBack" | "addressProofUrlFront" | "addressProofUrlBack" | "signatureUrl" | "bankPassbookStatement" | "policeClearanceCertificate";

function buildEnrollmentStoragePath(
  phoneNumber: string,
  folder: string,
  fileStem: string,
  file: File,
): string {
  const extension = getUploadFileExtension(file, "bin");
  return `employees/${phoneNumber}/${folder}/${Date.now()}_${fileStem}.${extension}`;
}


const handleUploadError = (err: any, documentName: string): never => {
  if (err.code === 'storage/unauthorized') {
    throw new Error(`Permission Denied: Your admin account does not have permission to upload the ${documentName}. Please check your Firebase Storage security rules to allow writes for authenticated users.`);
  }
  throw new Error(`${documentName} processing failed: ${err.message}`);
};

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


export default function EnrollEmployeePage() {
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
  
  const [isJoiningDatePopoverOpen, setIsJoiningDatePopoverOpen] = useState(false);
  const [isDobPopoverOpen, setIsDobPopoverOpen] = useState(false);


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
     },
  });

  const watchClientName = form.watch("clientName");
  const watchMaritalStatus = form.watch("maritalStatus");
  const watchEducationalQualification = form.watch("educationalQualification");
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
    setIsCameraDialogOpen(true); // Open dialog first

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
        setCameraError("Could not access camera. Please ensure permission is granted in your browser settings.");
        toast({ variant: "destructive", title: "Camera Error", description: "Could not access camera." });
        setIsCameraDialogOpen(false); // Close dialog if camera access fails
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
      form.setValue(fieldName, undefined as any, { shouldValidate: true }); // Use 'as any' to bypass strict File type for undefined
      setPreview(null);
    }
    if (event.target) {
        event.target.value = ""; 
    }
  };
  
  async function onSubmit(data: EnrollmentFormValues) {
    setIsLoading(true);
    toast({ title: "Processing Registration...", description: "Please wait." });

    const district = canonicalizeDistrictName(data.district, districtSuggestions);
    if (!isRecognizedDistrictName(district, districtSuggestions)) {
      form.setError("district", {
        type: "manual",
        message: "Please choose a valid district for this region.",
      });
      setIsLoading(false);
      return;
    }

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
            } catch (err) {
                handleUploadError(err, name);
            }
        }
      
      toast({ title: "Saving Employee Data...", description: "Almost done."});
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
          district,
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
        description: `${data.firstName} ${data.lastName}'s registration (ID: ${responseBody.employeeId}) has been saved.`,
        action: <Check className="h-5 w-5 text-green-500" />,
      });
      form.reset();
      // Reset all previews
      setProfilePicPreview(null);
      setIdentityProofUrlFrontPreview(null);
      setIdentityProofUrlBackPreview(null);
      setAddressProofUrlFrontPreview(null);
      setAddressProofUrlBackPreview(null);
      setSignatureUrlPreview(null);
      setBankPassbookPreview(null);
      setPoliceCertPreview(null);
      router.push(`/employees/${responseBody.id}`);

    } catch (error: any) {
      await Promise.allSettled(
        Object.values(uploadedUrls)
          .filter((url): url is string => Boolean(url))
          .map((url) => deleteFileFromStorage(url)),
      );
      console.error("Registration or Upload Error: ", error);
      toast({
        variant: "destructive",
        title: "Registration Failed",
        description: error.message || "Could not save employee data or upload files. Please check details and try again.",
        duration: 9000
      });
    } finally {
      setIsLoading(false);
    }
  }
  
  const fromYear = new Date().getFullYear() - 65;
  const toYear = new Date().getFullYear() - 18;
  const defaultCalendarMonth = new Date();
  defaultCalendarMonth.setFullYear(toYear - 10);

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Link href="/employees" className="flex items-center text-sm text-primary hover:underline">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Employee Directory
        </Link>
      </div>

      <Card className="shadow-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Employee Registration</CardTitle>
          <CardDescription>Complete your employee profile with accurate information</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              
              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Client Information</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="joiningDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Joining Date <span className="text-destructive">*</span></FormLabel>
                        <Popover open={isJoiningDatePopoverOpen} onOpenChange={setIsJoiningDatePopoverOpen}>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}>
                                {field.value ? format(field.value, "dd-MM-yyyy") : <span>dd-mm-yyyy</span>}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar mode="single" selected={field.value} onSelect={(date) => {
                                field.onChange(date);
                                setIsJoiningDatePopoverOpen(false);
                              }} 
                              initialFocus />
                          </PopoverContent>
                        </Popover>
                        <FormDescription>Your first day of employment</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="clientName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client Name <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoadingClients}>
                          <FormControl><SelectTrigger><SelectValue placeholder={isLoadingClients ? "Loading clients..." : "Select client"} /></SelectTrigger></FormControl>
                          <SelectContent>
                            {isLoadingClients ? (
                              <SelectItem value="loading" disabled>Loading...</SelectItem>
                            ) : availableClients.length === 0 ? (
                               <SelectItem value="no-clients" disabled>No clients available</SelectItem>
                            ) : (
                              availableClients.map(client => <SelectItem key={client.id} value={client.name}>{client.name}</SelectItem>)
                            )}
                          </SelectContent>
                        </Select>
                        <FormDescription>Client you are deployed with. (Managed by Admin)</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {watchClientName === "TCS" && (
                    <FormField 
                      control={form.control} 
                      name="resourceIdNumber" 
                      render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>Resource ID Number <span className="text-destructive">*</span></FormLabel>
                          <FormControl><Input placeholder="Enter Resource ID Number" {...field} /></FormControl>
                          <FormDescription>Required if client is TCS. E.g., TCS12345</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} 
                    />
                  )}
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Personal Information</h2>
                <FormField
                  control={form.control}
                  name="profilePicture"
                  render={({ field }) => ( 
                    <FormItem className="mb-6 text-center">
                      <FormLabel className="block mb-2 text-sm font-medium">Profile Picture <span className="text-destructive">*</span></FormLabel>
                       <div className="flex flex-col items-center gap-4">
                        {profilePicPreview ? (
                          <Image src={profilePicPreview} alt="Profile preview" width={128} height={128} className="rounded-full object-cover h-32 w-32 border" data-ai-hint="profile photo"/>
                        ) : (
                          <div className="flex items-center justify-center h-32 w-32 rounded-full bg-muted border">
                            <UserCircle2 className="h-20 w-20 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex gap-2">
                           <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('profilePictureInput')?.click()}>
                            <Upload className="mr-2 h-4 w-4" /> Upload
                          </Button>
                           <Button type="button" variant="outline" size="sm" onClick={() => openCamera("profilePicture")}>
                            <Camera className="mr-2 h-4 w-4" /> Take Photo
                          </Button>
                        </div>
                        <FormControl>
                           <Input 
                            id="profilePictureInput"
                            type="file" 
                            className="hidden" 
                            accept={ENROLLMENT_IMAGE_ACCEPT}
                            onChange={(e) => handleFileChange(e, "profilePicture", setProfilePicPreview)}
                          />
                        </FormControl>
                         <FormDescription>Upload or take a clear passport-sized photo (JPG, PNG, WEBP. Max 5MB).</FormDescription>
                        <FormMessage />
                       </div>
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField control={form.control} name="firstName" render={({ field }) => (<FormItem><FormLabel>First Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter first name" {...field} /></FormControl><FormDescription>Your given name</FormDescription><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="lastName" render={({ field }) => (<FormItem><FormLabel>Last Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter last name" {...field} /></FormControl><FormDescription>Your family name</FormDescription><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="fatherName" render={({ field }) => (<FormItem><FormLabel>Father's Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter father's name" {...field} /></FormControl><FormDescription>Your father's full name</FormDescription><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="motherName" render={({ field }) => (<FormItem><FormLabel>Mother's Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter mother's name" {...field} /></FormControl><FormDescription>Your mother's full name</FormDescription><FormMessage /></FormItem>)} />
                   <FormField
                    control={form.control}
                    name="dateOfBirth"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Date of Birth <span className="text-destructive">*</span></FormLabel>
                        <Popover open={isDobPopoverOpen} onOpenChange={setIsDobPopoverOpen}>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}>
                                {field.value ? format(field.value, "dd-MM-yyyy") : <span>dd-mm-yyyy</span>}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar 
                              mode="single" 
                              selected={field.value} 
                              onSelect={(date) => {
                                field.onChange(date);
                                setIsDobPopoverOpen(false);
                              }} 
                              captionLayout="dropdown-buttons"
                              fromYear={fromYear}
                              toYear={toYear}
                              defaultMonth={defaultCalendarMonth}
                              disabled={(date) => date > addYears(new Date(), -18) || date < addYears(new Date(), -65)}
                            />
                          </PopoverContent>
                        </Popover>
                        <FormDescription>Your date of birth (Age must be between 18 and 65).</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="gender"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Gender <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="Male">Male</SelectItem>
                            <SelectItem value="Female">Female</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>Your gender</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                   <FormField
                    control={form.control}
                    name="maritalStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Marital Status <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select marital status" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {maritalStatuses.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormDescription>Your current marital status</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {watchMaritalStatus === "Married" && (
                    <FormField
                      control={form.control}
                      name="spouseName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Spouse Name <span className="text-destructive">*</span></FormLabel>
                          <FormControl><Input placeholder="Enter spouse's name" {...field} /></FormControl>
                          <FormDescription>Your spouse's full name</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  <FormField
                    control={form.control}
                    name="educationalQualification"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Educational Qualification <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select qualification" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {educationOptions.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {watchEducationalQualification === "Any Other Qualification" && (
                    <FormField
                      control={form.control}
                      name="otherQualification"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Please Specify Qualification <span className="text-destructive">*</span></FormLabel>
                          <FormControl><Input placeholder="e.g., B.Tech in Computer Science" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </section>
              
              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Identification Documents</h2>
                
                {/* Identity Proof */}
                <div className="p-4 border rounded-lg mt-4 space-y-4">
                    <h3 className="font-medium text-lg">Identity Proof (Name, DOB, Father's Name)</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField control={form.control} name="identityProofType" render={({ field }) => ( <FormItem><FormLabel>Document Type <span className="text-destructive">*</span></FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select ID proof type" /></SelectTrigger></FormControl><SelectContent>{idProofOptions.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                        <IdNumberInput control={form.control} name="identityProofNumber" label="Document Number" />
                    </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        <FormField control={form.control} name="identityProofUrlFront" render={({ field }) => ( <FormItem className="text-center"><FormLabel className="block mb-2">Front Page <span className="text-destructive">*</span></FormLabel><ImagePreviewAndUpload fieldName="identityProofUrlFront" preview={identityProofUrlFrontPreview} setPreview={setIdentityProofUrlFrontPreview} handleFileChange={handleFileChange} openCamera={openCamera} /><FormMessage /></FormItem> )} />
                        <FormField control={form.control} name="identityProofUrlBack" render={({ field }) => ( <FormItem className="text-center"><FormLabel className="block mb-2">Back Page <span className="text-destructive">*</span></FormLabel><ImagePreviewAndUpload fieldName="identityProofUrlBack" preview={identityProofUrlBackPreview} setPreview={setIdentityProofUrlBackPreview} handleFileChange={handleFileChange} openCamera={openCamera} /><FormMessage /></FormItem> )} />
                    </div>
                </div>

                {/* Address Proof */}
                <div className="p-4 border rounded-lg mt-6 space-y-4">
                    <h3 className="font-medium text-lg">Address Proof</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField control={form.control} name="addressProofType" render={({ field }) => ( <FormItem><FormLabel>Document Type <span className="text-destructive">*</span></FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select Address proof type" /></SelectTrigger></FormControl><SelectContent>{idProofOptions.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                        <IdNumberInput control={form.control} name="addressProofNumber" label="Document Number" />
                    </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        <FormField control={form.control} name="addressProofUrlFront" render={({ field }) => ( <FormItem className="text-center"><FormLabel className="block mb-2">Front Page <span className="text-destructive">*</span></FormLabel><ImagePreviewAndUpload fieldName="addressProofUrlFront" preview={addressProofUrlFrontPreview} setPreview={setAddressProofUrlFrontPreview} handleFileChange={handleFileChange} openCamera={openCamera} /><FormMessage /></FormItem> )} />
                        <FormField control={form.control} name="addressProofUrlBack" render={({ field }) => ( <FormItem className="text-center"><FormLabel className="block mb-2">Back Page <span className="text-destructive">*</span></FormLabel><ImagePreviewAndUpload fieldName="addressProofUrlBack" preview={addressProofUrlBackPreview} setPreview={setAddressProofUrlBackPreview} handleFileChange={handleFileChange} openCamera={openCamera} /><FormMessage /></FormItem> )} />
                    </div>
                </div>

                {/* Signature */}
                 <div className="p-4 border rounded-lg mt-6 space-y-4">
                    <h3 className="font-medium text-lg">Signature</h3>
                     <FormField control={form.control} name="signatureUrl" render={({ field }) => ( <FormItem className="text-center"><FormLabel className="block mb-2">Employee Signature <span className="text-destructive">*</span></FormLabel><ImagePreviewAndUpload fieldName="signatureUrl" preview={signatureUrlPreview} setPreview={setSignatureUrlPreview} handleFileChange={handleFileChange} openCamera={openCamera} isSignature={true} /><FormDescription>Sign on a plain white paper and take a clear photo.</FormDescription><FormMessage /></FormItem> )} />
                </div>
              </section>
              
              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Statutory & Location Details</h2>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField control={form.control} name="district" render={({ field }) => ( <FormItem><FormLabel>District <span className="text-destructive">*</span></FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="Enter district" list="admin-enrollment-districts" /></FormControl><datalist id="admin-enrollment-districts">{districtSuggestions.map(dist => <option key={dist} value={dist} />)}</datalist><FormDescription>Your current district of residence</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="panNumber" render={({ field }) => (<FormItem><FormLabel>PAN Card Number</FormLabel><FormControl><Input placeholder="Enter PAN card number" {...field} /></FormControl><FormDescription>E.g., ABCDE1234F (optional)</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="epfUanNumber" render={({ field }) => (<FormItem><FormLabel>EPF UAN Number</FormLabel><FormControl><Input placeholder="Enter EPF UAN number" {...field} /></FormControl><FormDescription>Universal Account Number (optional)</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="esicNumber" render={({ field }) => (<FormItem><FormLabel>ESIC Number</FormLabel><FormControl><Input placeholder="Enter ESIC number" {...field} /></FormControl><FormDescription>ESIC Number (optional)</FormDescription><FormMessage /></FormItem>)} />
                 </div>
                 <div className="grid grid-cols-1 mt-6">
                    <FormField
                        control={form.control}
                        name="policeClearanceCertificate"
                        render={({ field }) => ( 
                        <FormItem className="text-center">
                            <FormLabel className="block mb-2">Police Clearance Certificate</FormLabel>
                            <ImagePreviewAndUpload fieldName="policeClearanceCertificate" preview={policeCertPreview} setPreview={setPoliceCertPreview} handleFileChange={handleFileChange} openCamera={openCamera} />
                            <FormDescription>PCC document (optional). Max 5MB.</FormDescription>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                 </div>
              </section>
              
              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Bank Account Details</h2>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField control={form.control} name="bankAccountNumber" render={({ field }) => (<FormItem><FormLabel>Bank Account Number</FormLabel><FormControl><Input placeholder="Enter bank account number" {...field} /></FormControl><FormDescription>Salary deposit account</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="ifscCode" render={({ field }) => (<FormItem><FormLabel>IFSC Code</FormLabel><FormControl><Input placeholder="Enter bank IFSC code" {...field} /></FormControl><FormDescription>11-character branch code</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="bankName" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>Bank Name</FormLabel><FormControl><Input placeholder="Full name of your bank" {...field} /></FormControl><FormMessage /></FormItem>)} />
                 </div>
                 <FormField
                    control={form.control}
                    name="bankPassbookStatement"
                    render={({ field }) => ( 
                       <FormItem className="mt-6 text-center">
                        <FormLabel className="block mb-2">Bank Passbook / Statement</FormLabel>
                        <ImagePreviewAndUpload fieldName="bankPassbookStatement" preview={bankPassbookPreview} setPreview={setBankPassbookPreview} handleFileChange={handleFileChange} openCamera={openCamera} />
                        <FormDescription>Upload or take photo of bank document (JPG, PNG, WEBP, PDF. Max 5MB).</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Contact Information</h2>
                 <div className="grid grid-cols-1 gap-6">
                  <FormField control={form.control} name="fullAddress" render={({ field }) => ( 
                    <FormItem>
                        <div className="flex justify-between items-center">
                            <FormLabel>Full Address <span className="text-destructive">*</span></FormLabel>
                            {pinStatus === 'found' && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircleIcon className="h-3 w-3" /> PIN Code Detected</span>}
                            {pinStatus === 'not_found' && <span className="text-xs text-orange-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> PIN Code Missing?</span>}
                        </div>
                        <FormControl><Textarea placeholder="Enter your complete residential address" {...field} /></FormControl>
                        <FormDescription>Include house number, street, area, and PIN code</FormDescription>
                        <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                  <FormField control={form.control} name="emailAddress" render={({ field }) => (<FormItem><FormLabel>Email Address <span className="text-destructive">*</span></FormLabel><FormControl><Input type="email" placeholder="yourname@example.com" {...field} /></FormControl><FormDescription>For official communications</FormDescription><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="phoneNumber" render={({ field }) => (<FormItem><FormLabel>Phone Number <span className="text-destructive">*</span></FormLabel><FormControl><Input type="tel" placeholder="10-digit mobile number" {...field} /></FormControl><FormDescription>Your primary contact number</FormDescription><FormMessage /></FormItem>)} />
                </div>
              </section>

              <div className="flex justify-end pt-6">
                <Button type="submit" className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-6 text-base" disabled={isLoading || form.formState.isSubmitting}>
                  {isLoading || form.formState.isSubmitting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...</>
                  ) : "Complete Registration"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Dialog open={isCameraDialogOpen} onOpenChange={(isOpen) => { if (!isOpen) closeCameraDialog(); }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Take Photo for {activeCameraField?.replace(/([A-Z])/g, ' $1').trim()}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {cameraError && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Camera Error</AlertTitle>
                <AlertDescription>{cameraError}</AlertDescription>
              </Alert>
            )}
            {/* Conditionally render video only when stream is available and no error */}
            {(cameraStream && !cameraError) && (
              <video ref={videoRef} autoPlay muted playsInline className="w-full h-auto rounded-md border aspect-video bg-muted" />
            )}
            {/* Show placeholder if stream is not ready but dialog is open and no error yet */}
            {(!cameraStream && isCameraDialogOpen && !cameraError) && (
                <div className="w-full aspect-video bg-muted rounded-md flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="ml-2">Starting camera...</p>
                </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCameraDialog}>Cancel</Button>
            <Button onClick={handleCapturePhoto} disabled={!cameraStream || !!cameraError || isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
              Capture Photo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}


const ImagePreviewAndUpload: React.FC<{
  fieldName: any;
  preview: string | null;
  setPreview: (p: string | null) => void;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>, fieldName: any, setPreview: any) => void;
  openCamera: (fieldName: any) => void;
  isSignature?: boolean;
}> = ({ fieldName, preview, setPreview, handleFileChange, openCamera, isSignature }) => {
    return (
        <div>
            {preview && (preview === "/pdf-icon.png" ? 
                <Image src={preview} alt="PDF icon" width={80} height={100} className="mx-auto mb-2 border object-contain h-32" data-ai-hint="document pdf"/> :
                <Image src={preview} alt={`${fieldName} Preview`} width={200} height={isSignature ? 100 : 120} className="mx-auto mb-2 border object-contain h-32" data-ai-hint="id document"/>
            )}
            {!preview && <div className="flex items-center justify-center h-32 w-full bg-muted border rounded-md mb-2"><FileUp className="h-12 w-12 text-muted-foreground"/></div> }
            <div className="flex justify-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById(`${fieldName}Input`)?.click()}><Upload className="mr-2 h-4 w-4"/> Upload</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => openCamera(fieldName)}><Camera className="mr-2 h-4 w-4"/> Take Photo</Button>
            </div>
            <FormControl><Input id={`${fieldName}Input`} type="file" className="hidden" accept={ENROLLMENT_DOCUMENT_ACCEPT} onChange={(e) => handleFileChange(e, fieldName, setPreview)} /></FormControl>
        </div>
    );
};
