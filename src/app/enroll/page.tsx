
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
import { CalendarIcon, UserPlus, FileUp, Check, ArrowLeft, Upload, Camera, UserCircle2, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { db, storage } from "@/lib/firebase"; 
import { collection, addDoc, Timestamp, serverTimestamp, query, orderBy, onSnapshot } from "firebase/firestore";
import { compressImage, uploadFileToStorage, dataURLtoFile } from "@/lib/storageUtils"; 
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription as ShadDialogDescription } from "@/components/ui/dialog"; // Added DialogDescription
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSearchParams } from 'next/navigation';


const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const fileSchema = z.instanceof(File, { message: "This field is required." })
  .refine(file => file.size <= MAX_FILE_SIZE_BYTES, `Max file size is ${MAX_FILE_SIZE_MB}MB.`);

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
  idProofType: z.enum(["Aadhar Card", "Voter ID", "Driving License", "Passport"], { required_error: "ID proof type is required." }),
  idProofNumber: z.string().min(5, { message: "ID proof number is required (min 5 chars)." }),
  idProofDocument: fileSchema,
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
const idProofTypes = ["Aadhar Card", "Voter ID", "Driving License", "Passport"];
const maritalStatuses = ["Married", "Unmarried"];

type CameraField = "profilePicture" | "idProofDocument" | "bankPassbookStatement";

export default function EnrollEmployeePage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const initialPhoneNumberFromQuery = searchParams.get('phone');

  const [profilePicPreview, setProfilePicPreview] = React.useState<string | null>(null);
  const [idProofPreview, setIdProofPreview] = React.useState<string | null>(null);
  const [bankPassbookPreview, setBankPassbookPreview] = React.useState<string | null>(null);
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
        idProofType: undefined,
        idProofNumber: '',
        epfUanNumber: '',
        esicNumber: '',
        bankAccountNumber: '',
        ifscCode: '',
        bankName: '',
        fullAddress: '',
        emailAddress: '',
        phoneNumber: initialPhoneNumberFromQuery || '',
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
    setIsLoadingClients(true);
    const clientsQuery = query(collection(db, 'clients'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(clientsQuery, (snapshot) => {
      const fetchedClients = snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name as string }));
      setAvailableClients(fetchedClients);
      setIsLoadingClients(false);
    }, (error) => {
      console.error("Error fetching clients for enrollment form: ", error);
      toast({ variant: "destructive", title: "Error Loading Clients", description: "Could not load client list." });
      setIsLoadingClients(false);
    });
    return () => unsubscribe();
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        setCameraStream(stream);
      } catch (err) {
        console.error("Error accessing camera:", err);
        setCameraError("Could not access camera. Please ensure permission is granted in your browser settings.");
        toast({ variant: "destructive", title: "Camera Error", description: "Could not access camera." });
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
        
        form.setValue(activeCameraField, capturedFile, { shouldValidate: true });

        const previewUrl = URL.createObjectURL(capturedFile);
        if (activeCameraField === "profilePicture") setProfilePicPreview(previewUrl);
        else if (activeCameraField === "idProofDocument") setIdProofPreview(previewUrl);
        else if (activeCameraField === "bankPassbookStatement") setBankPassbookPreview(previewUrl);
        
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
    fieldName: keyof Pick<EnrollmentFormValues, "profilePicture" | "idProofDocument" | "bankPassbookStatement">, 
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
    toast({ title: "Processing Registration...", description: "Please wait. Initializing submission..." });

    let profilePictureUrl: string | null = null;
    let idProofDocumentUrl: string | null = null;
    let bankPassbookStatementUrl: string | null = null;

    try {
      const uploadPromises = [];
      const phoneNumber = data.phoneNumber.replace(/\D/g, ""); 

      toast({ title: "File Processing", description: "Preparing files for upload..." });

      if (data.profilePicture) {
        const file = data.profilePicture;
        const storagePath = `employees/${phoneNumber}/profilePictures/${Date.now()}_profile.jpg`;
        toast({ title: "Profile Picture", description: "Compressing profile picture..." });
        uploadPromises.push(
          compressImage(file, { maxWidth: 500, maxHeight: 500, quality: 0.8, targetMimeType: 'image/jpeg' })
            .then(blob => {
              toast({ title: "Profile Picture", description: "Uploading profile picture..." });
              return uploadFileToStorage(blob, storagePath);
            })
            .then(url => { profilePictureUrl = url; toast({ title: "Profile Picture", description: "Upload complete." }); })
            .catch(err => { 
              console.error("Profile picture processing/upload error:", err); 
              throw new Error(`Profile picture processing failed: ${err.message}`); 
            })
        );
      }

      if (data.idProofDocument) {
        const file = data.idProofDocument;
        const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
        const storagePath = `employees/${phoneNumber}/idProofs/${Date.now()}_idProof.${file.type.startsWith("image/") ? 'jpg' : ext}`;
        toast({ title: "ID Proof", description: `Preparing ID proof (${file.type})...` });
        
        const processAndUpload = file.type.startsWith("image/") 
          ? compressImage(file, { maxWidth: 1024, maxHeight: 1024, quality: 0.7, targetMimeType: 'image/jpeg' })
              .then(blob => {
                toast({ title: "ID Proof", description: "Uploading ID proof image..." });
                return uploadFileToStorage(blob, storagePath);
              })
          : (() => {
              toast({ title: "ID Proof", description: "Uploading ID proof document (PDF)..." });
              return uploadFileToStorage(file, storagePath);
            })();

        uploadPromises.push(
          processAndUpload
            .then(url => { idProofDocumentUrl = url; toast({ title: "ID Proof", description: "Upload complete." });})
            .catch(err => { 
              console.error("ID proof processing/upload error:", err); 
              throw new Error(`ID proof processing failed: ${err.message}`); 
            })
        );
      }
      
      if (data.bankPassbookStatement) {
        const file = data.bankPassbookStatement;
        const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
        const storagePath = `employees/${phoneNumber}/bankDocuments/${Date.now()}_bankDoc.${file.type.startsWith("image/") ? 'jpg' : ext}`;
        toast({ title: "Bank Document", description: `Preparing bank document (${file.type})...` });

        const processAndUpload = file.type.startsWith("image/")
          ? compressImage(file, { maxWidth: 1024, maxHeight: 1024, quality: 0.7, targetMimeType: 'image/jpeg' })
              .then(blob => {
                toast({ title: "Bank Document", description: "Uploading bank document image..." });
                return uploadFileToStorage(blob, storagePath);
              })
          : (() => {
              toast({ title: "Bank Document", description: "Uploading bank document (PDF)..." });
              return uploadFileToStorage(file, storagePath);
            })();

        uploadPromises.push(
          processAndUpload
            .then(url => { bankPassbookStatementUrl = url; toast({ title: "Bank Document", description: "Upload complete." });})
            .catch(err => { 
              console.error("Bank document processing/upload error:", err); 
              throw new Error(`Bank document processing failed: ${err.message}`); 
            })
        );
      }

      if (uploadPromises.length > 0) {
        toast({ title: "Uploading All Files...", description: "This may take a moment. Please monitor individual file completion messages."});
        await Promise.all(uploadPromises);
        toast({ title: "All Files Uploaded", description: "File uploads completed successfully. Proceeding to save data."});
      } else {
        toast({ title: "No Files to Upload", description: "Skipping file upload step. Note: File fields are currently required."});
        if (!data.profilePicture || !data.idProofDocument || !data.bankPassbookStatement) {
            throw new Error("Required document files are missing.");
        }
      }
      
      toast({ title: "Saving Employee Data...", description: "Preparing data for database..."});

      if (!profilePictureUrl || !idProofDocumentUrl || !bankPassbookStatementUrl) {
          console.error("One or more file URLs are null after upload attempts. Profile:", profilePictureUrl, "ID:", idProofDocumentUrl, "Bank:", bankPassbookStatementUrl);
          throw new Error("A required document failed to upload or its URL was not retrieved. Cannot save record.");
      }

      const employeeDataForFirestore = {
        clientName: data.clientName,
        resourceIdNumber: data.resourceIdNumber,
        firstName: data.firstName,
        lastName: data.lastName,
        fatherName: data.fatherName,
        motherName: data.motherName,
        joiningDate: Timestamp.fromDate(data.joiningDate),
        dateOfBirth: Timestamp.fromDate(data.dateOfBirth),
        gender: data.gender,
        maritalStatus: data.maritalStatus,
        spouseName: data.spouseName,
        district: data.district,
        panNumber: data.panNumber,
        idProofType: data.idProofType,
        idProofNumber: data.idProofNumber,
        epfUanNumber: data.epfUanNumber,
        esicNumber: data.esicNumber,
        bankAccountNumber: data.bankAccountNumber,
        ifscCode: data.ifscCode,
        bankName: data.bankName,
        fullAddress: data.fullAddress,
        emailAddress: data.emailAddress,
        phoneNumber: data.phoneNumber,
        profilePictureUrl, 
        idProofDocumentUrl,  
        bankPassbookStatementUrl, 
        status: 'Active', 
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      
      const finalDataForFirestore: any = {};
      const optionalStringFields = ['resourceIdNumber', 'spouseName', 'panNumber', 'epfUanNumber', 'esicNumber'];

      for (const key in employeeDataForFirestore) {
        const value = (employeeDataForFirestore as any)[key];
        if (value !== undefined) { 
          if (typeof value === 'string' && value.trim() === '' && optionalStringFields.includes(key)) {
            continue;
          }
          finalDataForFirestore[key] = value;
        }
      }
      
      toast({ title: "Finalizing Data...", description: "Saving to database..." });
      console.log("Data being sent to Firestore:", finalDataForFirestore);
      const docRef = await addDoc(collection(db, "employees"), finalDataForFirestore);
      
      toast({
        title: "Registration Successful!",
        description: `${data.firstName} ${data.lastName}'s registration (ID: ${docRef.id}) has been saved.`,
        action: <Check className="h-5 w-5 text-green-500" />,
      });
      form.reset();
      setProfilePicPreview(null);
      setIdProofPreview(null);
      setBankPassbookPreview(null);

    } catch (error: any) {
      console.error("Detailed Registration or Upload Error: ", error, error.stack);
      let description = "An unexpected error occurred. Could not save employee data or upload files. Please check details and try again.";
      if (error instanceof Error) {
        description = error.message;
      } else if (typeof error === 'string') {
        description = error;
      } else {
        try {
          description = JSON.stringify(error); 
        } catch (e) {
           description = "An unknown error occurred during submission. Check console for details."
        }
      }
      toast({
        variant: "destructive",
        title: "Registration Failed",
        description: description,
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
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Link href="/" className="flex items-center text-sm text-primary hover:underline">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Home
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
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Location & Identification</h2>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField control={form.control} name="district" render={({ field }) => ( <FormItem><FormLabel>District <span className="text-destructive">*</span></FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select your district" /></SelectTrigger></FormControl><SelectContent>{keralaDistricts.map(dist => <SelectItem key={dist} value={dist}>{dist}</SelectItem>)}</SelectContent></Select><FormDescription>Your current district of residence</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="panNumber" render={({ field }) => (<FormItem><FormLabel>PAN Card Number</FormLabel><FormControl><Input placeholder="Enter PAN card number" {...field} /></FormControl><FormDescription>E.g., ABCDE1234F (optional)</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="idProofType" render={({ field }) => ( <FormItem><FormLabel>ID Proof Type <span className="text-destructive">*</span></FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select ID proof type" /></SelectTrigger></FormControl><SelectContent>{idProofTypes.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select><FormDescription>Type of identity document</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="idProofNumber" render={({ field }) => (<FormItem><FormLabel>ID Proof Number <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter ID proof number" {...field} /></FormControl><FormDescription>Number on your ID document</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="epfUanNumber" render={({ field }) => (<FormItem><FormLabel>EPF UAN Number</FormLabel><FormControl><Input placeholder="Enter EPF UAN number" {...field} /></FormControl><FormDescription>Universal Account Number (optional)</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="esicNumber" render={({ field }) => (<FormItem><FormLabel>ESIC Number</FormLabel><FormControl><Input placeholder="Enter ESIC number" {...field} /></FormControl><FormDescription>ESIC Number (optional)</FormDescription><FormMessage /></FormItem>)} />
                 </div>
                 <FormField
                    control={form.control}
                    name="idProofDocument"
                    render={({ field }) => ( 
                      <FormItem className="mt-6 text-center">
                        <FormLabel className="block mb-2">ID Proof Document <span className="text-destructive">*</span></FormLabel>
                        {idProofPreview && (
                            idProofPreview === "/pdf-icon.png" ? 
                            <Image src={idProofPreview} alt="PDF icon" width={80} height={100} className="mx-auto mb-2 border object-contain h-32" data-ai-hint="document pdf"/> :
                            <Image src={idProofPreview} alt="ID Proof Preview" width={200} height={120} className="mx-auto mb-2 border object-contain h-32" data-ai-hint="id document"/>
                        )}
                        {!idProofPreview && <div className="flex items-center justify-center h-32 w-full bg-muted border rounded-md mb-2"><FileUp className="h-12 w-12 text-muted-foreground"/></div> }

                        <div className="flex justify-center gap-2">
                           <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('idProofDocumentInput')?.click()}>
                            <Upload className="mr-2 h-4 w-4" /> Upload
                          </Button>
                           <Button type="button" variant="outline" size="sm" onClick={() => openCamera("idProofDocument")}>
                            <Camera className="mr-2 h-4 w-4" /> Take Photo
                          </Button>
                        </div>
                        <FormControl>
                          <Input id="idProofDocumentInput" type="file" className="hidden" accept="image/jpeg,image/png,image/webp,.pdf" onChange={(e) => handleFileChange(e, "idProofDocument", setIdProofPreview)} />
                        </FormControl>
                         <FormDescription>Upload or take photo of ID (JPG, PNG, WEBP, PDF. Max 5MB).</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                        {bankPassbookPreview && (
                            bankPassbookPreview === "/pdf-icon.png" ?
                            <Image src={bankPassbookPreview} alt="PDF icon" width={80} height={100} className="mx-auto mb-2 border object-contain h-32" data-ai-hint="document pdf"/> :
                            <Image src={bankPassbookPreview} alt="Bank Passbook Preview" width={200} height={120} className="mx-auto mb-2 border object-contain h-32" data-ai-hint="bank document"/>
                        )}
                        {!bankPassbookPreview && <div className="flex items-center justify-center h-32 w-full bg-muted border rounded-md mb-2"><FileUp className="h-12 w-12 text-muted-foreground"/></div>}
                         <div className="flex justify-center gap-2">
                           <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('bankPassbookStatementInput')?.click()}>
                            <Upload className="mr-2 h-4 w-4" /> Upload
                          </Button>
                           <Button type="button" variant="outline" size="sm" onClick={() => openCamera("bankPassbookStatement")}>
                            <Camera className="mr-2 h-4 w-4" /> Take Photo
                          </Button>
                        </div>
                        <FormControl>
                          <Input id="bankPassbookStatementInput" type="file" className="hidden" accept="image/jpeg,image/png,image/webp,.pdf" onChange={(e) => handleFileChange(e, "bankPassbookStatement", setBankPassbookPreview)} />
                        </FormControl>
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
                  <FormField control={form.control} name="phoneNumber" render={({ field }) => (<FormItem><FormLabel>Phone Number <span className="text-destructive">*</span></FormLabel><FormControl><Input type="tel" placeholder="10-digit mobile number" {...field} disabled={isPhoneNumberPrefilled} /></FormControl><FormDescription>Your primary contact number. {isPhoneNumberPrefilled ? "(Pre-filled from login)" : ""}</FormDescription><FormMessage /></FormItem>)} />
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
              Use your device camera to capture a photo for the {activeCameraField?.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} field.
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

    </div>
  );
}
    
