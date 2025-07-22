
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
import { CalendarIcon, UserPlus, FileUp, Check, ArrowLeft, Upload, Camera, UserCircle2, Loader2, AlertCircle, Edit } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import React, { Suspense, useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { db, storage } from "@/lib/firebase";
import { collection, addDoc, Timestamp, serverTimestamp, query, orderBy, getDocs } from "firebase/firestore";
import { compressImage, uploadFileToStorage, dataURLtoFile } from "@/lib/storageUtils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription as ShadDialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSearchParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { Checkbox } from "@/components/ui/checkbox";
import { verifyDocument } from "@/ai/flows/verify-document-flow";


const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const fileSchema = z.instanceof(File, { message: "This field is required." })
  .refine(file => file.size <= MAX_FILE_SIZE_BYTES, `Max file size is ${MAX_FILE_SIZE_MB}MB.`);

const optionalFileSchema = fileSchema.optional();

const proofTypes = z.enum(["PAN Card", "Voter ID", "Driving License", "Passport", "Birth Certificate", "School Certificate", "Aadhar Card"]);

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
  dateOfBirth: z.date({ required_error: "Date of birth is required." }),
  gender: z.enum(["Male", "Female", "Other"], { required_error: "Gender is required." }),
  maritalStatus: z.enum(["Married", "Unmarried"], { required_error: "Marital status is required." }),
  spouseName: z.string().optional(),

  // Location & Identification
  district: z.string({ required_error: "District is required." }).min(1, {message: "District is required."}),
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, { message: "Invalid PAN number format (e.g., ABCDE1234F)." }).optional().or(z.literal('')),
  
  identityProofType: proofTypes,
  identityProofNumber: z.string().min(5, { message: "ID proof number is required." }),
  identityProofUrlFront: fileSchema,
  identityProofUrlBack: fileSchema,
  
  addressProofType: proofTypes,
  addressProofNumber: z.string().min(5, { message: "Address proof number is required." }),
  addressProofUrlFront: fileSchema,
  addressProofUrlBack: fileSchema,
  
  signatureUrl: fileSchema,
  
  policeClearanceCertificate: optionalFileSchema,
  epfUanNumber: z.string().optional(),
  esicNumber: z.string().optional(),

  // Bank Account Details
  bankAccountNumber: z.string().min(5, { message: "Bank account number is required." }),
  ifscCode: z.string().length(11, { message: "IFSC code must be 11 characters." }),
  bankName: z.string().min(2, { message: "Bank name is required." }),
  bankPassbookStatement: fileSchema,

  // Contact Information
  fullAddress: z.string().min(10, { message: "Full address is required (min 10 chars)." }),
  emailAddress: z.string().email({ message: "Invalid email address." }),
  phoneNumber: z.string().regex(/^\d{10}$/, { message: "Phone number must be 10 digits." }),
  
  // Terms and Conditions
  termsAndConditions: z.boolean().refine((val) => val === true, {
    message: "You must accept the terms and conditions to proceed.",
  }),
}).superRefine((data, ctx) => {
  if (data.clientName === "TCS" && (!data.resourceIdNumber || data.resourceIdNumber.trim() === "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Resource ID number is required for TCS client.",
      path: ["resourceIdNumber"],
    });
  }
  if (data.maritalStatus === "Married" && (!data.spouseName || data.spouseName.trim() === "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Spouse name is required if marital status is Married.",
      path: ["spouseName"],
    });
  }
});

type EnrollmentFormValues = z.infer<typeof enrollmentFormSchema>;

interface ClientOption {
  id: string;
  name: string;
}

const keralaDistricts = [
  "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha",
  "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad",
  "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod"
];

const idProofOptions = ["PAN Card", "Voter ID", "Driving License", "Passport", "Birth Certificate", "School Certificate", "Aadhar Card"];
const maritalStatuses = ["Married", "Unmarried"];

type CameraField = "profilePicture" | "identityProofUrlFront" | "identityProofUrlBack" | "addressProofUrlFront" | "addressProofUrlBack" | "signatureUrl" | "bankPassbookStatement" | "policeClearanceCertificate";

// Helper Functions
const abbreviateClientName = (clientName: string): string => {
  if (!clientName) return "CLIENT";
  const upperCaseName = clientName.trim().toUpperCase();

  const abbreviations: { [key: string]: string } = {
    "TATA CONSULTANCY SERVICES": "TCS",
    "WIPRO": "WIPRO",
  };
  if (abbreviations[upperCaseName]) {
    return abbreviations[upperCaseName];
  }

  const words = upperCaseName.split(/[\s-]+/).filter((w) => w.length > 0);
  if (words.length > 1) {
    return words.map((word) => word[0]).join("");
  }

  if (upperCaseName.length <= 4) {
    return upperCaseName;
  }
  return upperCaseName.substring(0, 4);
};

const getCurrentFinancialYear = (): string => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentYear = now.getFullYear();
  if (currentMonth >= 4) { // April or later
    return `${currentYear}-${(currentYear + 1).toString().slice(-2)}`;
  } else { // Jan, Feb, March
    return `${currentYear - 1}-${currentYear.toString().slice(-2)}`;
  }
};

const generateEmployeeId = (clientName: string): string => {
  const shortClientName = abbreviateClientName(clientName);
  const financialYear = getCurrentFinancialYear();
  const randomNumber = Math.floor(Math.random() * 999) + 1; // 1-999
  return `CISS/${shortClientName}/${financialYear}/${randomNumber.toString().padStart(3, "0")}`;
};

const generateQrCodeDataUrl = async (employeeId: string, fullName: string, phoneNumber: string): Promise<string> => {
  const dataString = `Employee ID: ${employeeId}\nName: ${fullName}\nPhone: ${phoneNumber}`;
  try {
    const dataUrl = await QRCode.toDataURL(dataString, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      width: 256,
    });
    return dataUrl;
  } catch (err) {
    console.error('QR code generation failed:', err);
    throw new Error('Failed to generate QR code.');
  }
};

interface ActualEnrollmentFormProps {
  initialPhoneNumberFromQuery?: string | null;
}

const handlePublicUploadError = (err: any, documentName: string): never => {
  if (err.code === 'storage/unauthorized') {
    throw new Error(`Upload Permission Denied: The system is not configured to allow file uploads for new enrollments. Please contact an administrator and check the Firebase Storage security rules to allow unauthenticated writes.`);
  }
  throw new Error(`${documentName} processing failed: ${err.message}`);
};

const fileToDataUri = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            reject(new Error("File is not an image and cannot be converted to data URI for verification."));
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            resolve(reader.result as string);
        };
        reader.onerror = (error) => {
            reject(error);
        };
        reader.readAsDataURL(file);
    });
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

  const [isJoiningDatePopoverOpen, setIsJoiningDatePopoverOpen] = useState(false);
  const [isDobPopoverOpen, setIsDobPopoverOpen] = useState(false);


  const form = useForm<EnrollmentFormValues>({
    resolver: zodResolver(enrollmentFormSchema),
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
      if (file.size > MAX_FILE_SIZE_BYTES) {
        form.setError(fieldName, { type: "manual", message: `File is too large. Max ${MAX_FILE_SIZE_MB}MB.` });
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
        form.setError(fieldName, { type: "manual", message: "Invalid file type. Use JPG, PNG, WEBP or PDF." });
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

    // Step 1: AI Document Verification
    try {
        toast({ title: "Verifying Documents...", description: "AI is checking your uploaded proofs." });
        
        const verificationTasks = [
            { docFile: data.identityProofUrlFront, docType: data.identityProofType, fieldName: 'identityProofUrlFront', label: 'Identity Proof' },
            { docFile: data.addressProofUrlFront, docType: data.addressProofType, fieldName: 'addressProofUrlFront', label: 'Address Proof' },
        ];
        
        for (const task of verificationTasks) {
            // Only verify if it's an image
            if (task.docFile.type.startsWith('image/')) {
                const dataUri = await fileToDataUri(task.docFile);
                const result = await verifyDocument({ photoDataUri: dataUri, expectedType: task.docType });
                if (!result.isMatch) {
                    throw new Error(`AI Verification Failed for ${task.label}: ${result.reason}. Please upload the correct document.`);
                }
            }
        }
        
        toast({ title: "Documents Verified!", description: "All proofs match the selected types." });

    } catch (error: any) {
        console.error("AI Verification Error:", error);
        toast({ variant: "destructive", title: "Document Mismatch", description: error.message, duration: 8000 });
        setIsLoading(false);
        return; // Stop submission
    }

    const phoneNumber = data.phoneNumber.replace(/\D/g, "");
    const fullName = `${data.firstName.toUpperCase()} ${data.lastName.toUpperCase()}`;
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
        toast({ title: "Generating Unique IDs...", description: "Creating Employee ID and QR code." });
        const newEmployeeId = generateEmployeeId(data.clientName);
        const newQrCodeUrl = await generateQrCodeDataUrl(newEmployeeId, fullName, data.phoneNumber);
        
        const nameParts = fullName.split(' ').filter(Boolean);
        const searchableFields = Array.from(new Set([
          ...nameParts,
          data.firstName.toUpperCase(),
          data.lastName.toUpperCase(),
          newEmployeeId.toUpperCase(),
          data.phoneNumber,
        ].filter(Boolean) as string[]));

        toast({ title: "IDs Generated", description: "Employee ID and QR code created successfully." });

        const filesToUpload: { name: string; file?: File; path: string; isImage: boolean, key: keyof typeof uploadedUrls }[] = [
            { name: "Profile Picture", file: data.profilePicture, path: `employees/${phoneNumber}/profilePictures/${Date.now()}_profile.jpg`, isImage: true, key: 'profilePictureUrl' },
            { name: "Identity Proof (Front)", file: data.identityProofUrlFront, path: `employees/${phoneNumber}/idProofs/${Date.now()}_id_front.${data.identityProofUrlFront.name.split('.').pop()}`, isImage: data.identityProofUrlFront.type.startsWith("image/"), key: 'identityProofUrlFront' },
            { name: "Identity Proof (Back)", file: data.identityProofUrlBack, path: `employees/${phoneNumber}/idProofs/${Date.now()}_id_back.${data.identityProofUrlBack.name.split('.').pop()}`, isImage: data.identityProofUrlBack.type.startsWith("image/"), key: 'identityProofUrlBack' },
            { name: "Address Proof (Front)", file: data.addressProofUrlFront, path: `employees/${phoneNumber}/idProofs/${Date.now()}_addr_front.${data.addressProofUrlFront.name.split('.').pop()}`, isImage: data.addressProofUrlFront.type.startsWith("image/"), key: 'addressProofUrlFront' },
            { name: "Address Proof (Back)", file: data.addressProofUrlBack, path: `employees/${phoneNumber}/idProofs/${Date.now()}_addr_back.${data.addressProofUrlBack.name.split('.').pop()}`, isImage: data.addressProofUrlBack.type.startsWith("image/"), key: 'addressProofUrlBack' },
            { name: "Signature", file: data.signatureUrl, path: `employees/${phoneNumber}/signatures/${Date.now()}_sig.jpg`, isImage: true, key: 'signatureUrl' },
            { name: "Bank Document", file: data.bankPassbookStatement, path: `employees/${phoneNumber}/bankDocuments/${Date.now()}_bank.${data.bankPassbookStatement.name.split('.').pop()}`, isImage: data.bankPassbookStatement.type.startsWith("image/"), key: 'bankPassbookStatementUrl' },
            { name: "Police Certificate", file: data.policeClearanceCertificate, path: `employees/${phoneNumber}/policeCertificates/${Date.now()}_pcc.${data.policeClearanceCertificate?.name.split('.').pop()}`, isImage: data.policeClearanceCertificate?.type.startsWith("image/") ?? false, key: 'policeClearanceCertificateUrl' },
        ];

        for (const { name, file, path, isImage, key } of filesToUpload) {
            if (!file) continue;
            toast({ title: `Uploading ${name}...`});
            try {
                const fileToUpload = isImage
                    ? await compressImage(file, { maxWidth: 1024, maxHeight: 1024, quality: 0.7 })
                    : file;
                const url = await uploadFileToStorage(fileToUpload, path);
                uploadedUrls[key] = url;
            } catch (err) {
                handlePublicUploadError(err, name);
            }
        }
        
        toast({ title: "All Files Uploaded", description: "File uploads completed successfully."});

        const requiredUploads: (keyof typeof uploadedUrls)[] = ['profilePictureUrl', 'identityProofUrlFront', 'identityProofUrlBack', 'addressProofUrlFront', 'addressProofUrlBack', 'signatureUrl', 'bankPassbookStatementUrl'];
        for(const key of requiredUploads) {
            if (!uploadedUrls[key]) throw new Error(`${key.replace('Url','')} URL is missing after upload attempt.`);
        }

        const employeeDataForFirestore = {
            employeeId: newEmployeeId,
            qrCodeUrl: newQrCodeUrl,
            searchableFields,
            clientName: data.clientName,
            firstName: data.firstName.toUpperCase(),
            lastName: data.lastName.toUpperCase(),
            fullName: fullName,
            fatherName: data.fatherName.toUpperCase(),
            motherName: data.motherName.toUpperCase(),
            joiningDate: Timestamp.fromDate(data.joiningDate),
            dateOfBirth: Timestamp.fromDate(data.dateOfBirth),
            gender: data.gender,
            maritalStatus: data.maritalStatus,
            district: data.district,
            bankAccountNumber: data.bankAccountNumber,
            ifscCode: data.ifscCode.toUpperCase(),
            bankName: data.bankName.toUpperCase(),
            fullAddress: data.fullAddress.toUpperCase(),
            emailAddress: data.emailAddress.toLowerCase(),
            phoneNumber: data.phoneNumber,
            status: 'Active',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            // New proof fields
            identityProofType: data.identityProofType,
            identityProofNumber: data.identityProofNumber,
            identityProofUrlFront: uploadedUrls.identityProofUrlFront,
            identityProofUrlBack: uploadedUrls.identityProofUrlBack,
            addressProofType: data.addressProofType,
            addressProofNumber: data.addressProofNumber,
            addressProofUrlFront: uploadedUrls.addressProofUrlFront,
            addressProofUrlBack: uploadedUrls.addressProofUrlBack,
            signatureUrl: uploadedUrls.signatureUrl,
            bankPassbookStatementUrl: uploadedUrls.bankPassbookStatementUrl,
            profilePictureUrl: uploadedUrls.profilePictureUrl,
            // Optional fields
            ...(data.resourceIdNumber && { resourceIdNumber: data.resourceIdNumber }),
            ...(data.spouseName && { spouseName: data.spouseName.toUpperCase() }),
            ...(data.panNumber && { panNumber: data.panNumber.toUpperCase() }),
            ...(data.epfUanNumber && { epfUanNumber: data.epfUanNumber }),
            ...(data.esicNumber && { esicNumber: data.esicNumber }),
            ...(uploadedUrls.policeClearanceCertificateUrl && { policeClearanceCertificateUrl: uploadedUrls.policeClearanceCertificateUrl }),
        };

        toast({ title: "Finalizing Data...", description: "Saving to database..." });
        const docRef = await addDoc(collection(db, "employees"), employeeDataForFirestore);

        toast({
            title: "Registration Successful!",
            description: `${data.firstName} ${data.lastName}'s profile has been created. Employee ID: ${newEmployeeId}`,
            action: <Check className="h-5 w-5 text-green-500" />,
            duration: 7000,
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

        router.push(`/profile/${docRef.id}`);

    } catch (error: any) {
        console.error("Detailed Registration or Upload Error: ", error, error.stack);
        toast({
            variant: "destructive",
            title: "Registration Failed",
            description: error.message || "An unexpected error occurred. Could not save employee data or upload files.",
            duration: 9000,
        });
    } finally {
        setIsLoading(false);
    }
}


  const isPhoneNumberPrefilled = !!(initialPhoneNumberFromQuery && /^\d{10}$/.test(initialPhoneNumberFromQuery));
  const currentYear = new Date().getFullYear();
  const fromYear = currentYear - 70;
  const toYear = currentYear;
  const defaultCalendarMonth = new Date(new Date().setFullYear(currentYear - 25));


  return (
    <>
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
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={(date) => {
                                field.onChange(date);
                                setIsJoiningDatePopoverOpen(false);
                              }}
                              initialFocus
                              disabled={(date) => date > new Date()}
                            />
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
                            accept="image/jpeg,image/png,image/webp"
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
                              disabled={(date) => date > new Date() || date < new Date(fromYear, 0, 1)}
                              captionLayout="dropdown-buttons"
                              fromYear={fromYear}
                              toYear={toYear}
                              defaultMonth={defaultCalendarMonth}
                            />
                          </PopoverContent>
                        </Popover>
                        <FormDescription>Your date of birth</FormDescription>
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
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Identification Documents</h2>
                
                {/* Identity Proof */}
                <div className="p-4 border rounded-lg mt-4 space-y-4">
                    <h3 className="font-medium text-lg">Identity Proof (Name, DOB, Father's Name)</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField control={form.control} name="identityProofType" render={({ field }) => ( <FormItem><FormLabel>Document Type <span className="text-destructive">*</span></FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select ID proof type" /></SelectTrigger></FormControl><SelectContent>{idProofOptions.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="identityProofNumber" render={({ field }) => (<FormItem><FormLabel>Document Number <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter ID proof number" {...field} /></FormControl><FormMessage /></FormItem>)} />
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
                        <FormField control={form.control} name="addressProofNumber" render={({ field }) => (<FormItem><FormLabel>Document Number <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter address proof number" {...field} /></FormControl><FormMessage /></FormItem>)} />
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
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Statutory & Other Details</h2>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField control={form.control} name="district" render={({ field }) => ( <FormItem><FormLabel>District <span className="text-destructive">*</span></FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select your district" /></SelectTrigger></FormControl><SelectContent>{keralaDistricts.map(dist => <SelectItem key={dist} value={dist}>{dist}</SelectItem>)}</SelectContent></Select><FormDescription>Your current district of residence</FormDescription><FormMessage /></FormItem>)} />
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
                    <FormField control={form.control} name="bankAccountNumber" render={({ field }) => (<FormItem><FormLabel>Bank Account Number <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter bank account number" {...field} /></FormControl><FormDescription>Salary deposit account</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="ifscCode" render={({ field }) => (<FormItem><FormLabel>IFSC Code <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter bank IFSC code" {...field} /></FormControl><FormDescription>11-character branch code</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="bankName" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>Bank Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Full name of your bank" {...field} /></FormControl><FormMessage /></FormItem>)} />
                 </div>
                 <FormField
                    control={form.control}
                    name="bankPassbookStatement"
                    render={({ field }) => ( 
                       <FormItem className="mt-6 text-center">
                        <FormLabel className="block mb-2">Bank Passbook / Statement <span className="text-destructive">*</span></FormLabel>
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
                  <FormField control={form.control} name="fullAddress" render={({ field }) => ( <FormItem><FormLabel>Full Address <span className="text-destructive">*</span></FormLabel><FormControl><Textarea placeholder="Enter your complete residential address" {...field} /></FormControl><FormDescription>Include house number, street, area, PIN code</FormDescription><FormMessage /></FormItem>)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                  <FormField control={form.control} name="emailAddress" render={({ field }) => (<FormItem><FormLabel>Email Address <span className="text-destructive">*</span></FormLabel><FormControl><Input type="email" placeholder="yourname@example.com" {...field} /></FormControl><FormDescription>For official communications</FormDescription><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="phoneNumber" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Phone Number <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input type="tel" placeholder="10-digit mobile number" {...field} disabled={isPhoneNumberPrefilled} /></FormControl>
                        <FormDescription>Your primary contact number. {isPhoneNumberPrefilled ? "(Pre-filled from login)" : ""}</FormDescription>
                        <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Terms & Conditions</h2>
                <div className="space-y-4">
                  <div className="h-48 overflow-y-auto p-4 border rounded-md text-xs text-muted-foreground space-y-2">
                    <p className="font-bold">I. General Eligibility and Compliance</p>
                    <ul className="list-disc list-outside pl-4 space-y-1">
                      <li>I confirm I meet the eligibility criteria under the PSARA Act, 2005 and Kerala state rules, including age (18-65), physical fitness, and Indian citizenship.</li>
                      <li>I understand my enrollment is provisional and subject to a successful background and character verification by the relevant authorities.</li>
                      <li>I agree to complete all mandatory training and refresher courses as required by the company and regulatory bodies.</li>
                    </ul>
                    <p className="font-bold">II. Employment Terms & Responsibilities</p>
                    <ul className="list-disc list-outside pl-4 space-y-1">
                      <li>My employment terms, including working hours, wages, and leaves, will be governed by applicable labour laws.</li>
                      <li>I will perform my duties diligently, maintain strict discipline, protect client property, and follow all lawful instructions.</li>
                      <li>I will maintain strict confidentiality of all client and company information and will not disclose it to any unauthorized person.</li>
                      <li>I will report for duty on time, in uniform, and will not consume intoxicating substances on duty, use unauthorized force, or abandon my post without proper relief.</li>
                    </ul>
                    <p className="font-bold">III. Disciplinary Action</p>
                     <ul className="list-disc list-outside pl-4 space-y-1">
                        <li>I understand that any breach of these terms, misconduct, or violation of laws can lead to disciplinary action, up to and including termination of employment.</li>
                     </ul>
                    <p className="font-bold">IV. Declaration</p>
                    <p>I hereby declare that I have read, understood, and agree to abide by all the terms and conditions stated above for my enrollment. I confirm that all information and documents provided by me are true and correct to the best of my knowledge.</p>
                  </div>
                  <FormField
                    control={form.control}
                    name="termsAndConditions"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>
                            I have read, understood, and agree to the Terms and Conditions of Enrollment.
                          </FormLabel>
                          <FormMessage />
                        </div>
                      </FormItem>
                    )}
                  />
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
             <ShadDialogDescription className="sr-only">
              Use your device camera to capture a photo for the {activeCameraField?.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} field. This helps in verifying identity and documents for employee enrollment.
            </ShadDialogDescription>
          </DialogHeader>
          <div className="py-4">
            {cameraError && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Camera Error</AlertTitle>
                <AlertDescription>{cameraError}</AlertDescription>
              </Alert>
            )}
            {(cameraStream && !cameraError) && (
              <video ref={videoRef} autoPlay muted playsInline className="w-full h-auto rounded-md border aspect-video bg-muted" />
            )}
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
            <FormControl><Input id={`${fieldName}Input`} type="file" className="hidden" accept="image/jpeg,image/png,image/webp,.pdf" onChange={(e) => handleFileChange(e, fieldName, setPreview)} /></FormControl>
        </div>
    );
};


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
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Link href="/" className="flex items-center text-sm text-primary hover:underline">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Home
        </Link>
      </div>
      <Suspense fallback={<EnrollmentPageSkeleton />}>
        <EnrollmentFormWrapper />
      </Suspense>
    </div>
  );
}
