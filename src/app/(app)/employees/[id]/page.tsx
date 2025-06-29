
"use client";

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { type Employee } from '@/types/employee';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Edit3, User, Briefcase, Banknote, ShieldCheck, QrCode, FileUp, Download, Loader2, AlertCircle, RefreshCw, ArrowLeft, Home, CalendarIcon, Upload, Camera } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { db, auth, storage } from '@/lib/firebase';
import { doc, getDoc, Timestamp, updateDoc, serverTimestamp, collection, query, orderBy, getDocs, deleteField } from 'firebase/firestore';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import QRCode from 'qrcode';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { ref, deleteObject } from 'firebase/storage';

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { compressImage, uploadFileToStorage, dataURLtoFile, deleteFileFromStorage } from "@/lib/storageUtils";


// Dropdown options
const keralaDistricts = ["Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod"];
const idProofTypes = ["Aadhar Card", "Voter ID", "Driving License", "Passport"];
const maritalStatuses = ["Married", "Unmarried"];
const genderOptions = ["Male", "Female", "Other"];
const employeeStatuses = ['Active', 'Inactive', 'OnLeave', 'Exited'];
interface ClientOption { id: string; name: string; }
type CameraField = "profilePicture" | "idProofDocument" | "bankPassbookStatement";

// Zod schema for validation
const employeeUpdateSchema = z.object({
  firstName: z.string().min(1, "First name is required."),
  lastName: z.string().min(1, "Last name is required."),
  dateOfBirth: z.date({ required_error: "Date of birth is required." }),
  gender: z.enum(["Male", "Female", "Other"]),
  fatherName: z.string().min(2, "Father's name is required."),
  motherName: z.string().min(2, "Mother's name is required."),
  maritalStatus: z.enum(["Married", "Unmarried"]),
  spouseName: z.string().optional(),
  district: z.string(),
  fullAddress: z.string().min(10, "Address is required."),
  phoneNumber: z.string().regex(/^\d{10}$/, "Must be 10 digits."),
  emailAddress: z.string().email(),
  clientName: z.string().min(1, "Client name is required."),
  resourceIdNumber: z.string().optional(),
  joiningDate: z.date({ required_error: "Joining date is required." }),
  status: z.enum(['Active', 'Inactive', 'OnLeave', 'Exited']),
  exitDate: z.date().optional().nullable(),
  bankName: z.string().min(2, "Bank name is required."),
  bankAccountNumber: z.string().min(5, "Account number is required."),
  ifscCode: z.string().length(11, "IFSC code must be 11 characters."),
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN format.").optional().or(z.literal('')),
  idProofType: z.string().min(1, "ID Proof type is required."),
  idProofNumber: z.string().min(5, "ID Proof number is required."),
  epfUanNumber: z.string().optional(),
  esicNumber: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.maritalStatus === "Married" && (!data.spouseName || data.spouseName.trim() === "")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Spouse name is required if married.", path: ["spouseName"] });
  }
  if (data.status === 'Exited' && !data.exitDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Exit date is required if status is Exited.", path: ["exitDate"] });
  }
});
type EmployeeUpdateValues = z.infer<typeof employeeUpdateSchema>;


const DetailItem: React.FC<{ label: string; value?: string | number | null | Date; isDate?: boolean }> = ({ label, value, isDate }) => {
  let displayValue = 'N/A';
  if (value !== null && value !== undefined) {
    if (value instanceof Timestamp) {
      displayValue = format(value.toDate(), "PPP");
    } else if (isDate && (value instanceof Date || typeof value === 'string')) {
       try {
        displayValue = format(new Date(value), "PPP");
       } catch (e) {
        displayValue = 'Invalid Date';
       }
    } else {
      displayValue = String(value);
    }
  }
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5">
      <span className="text-sm text-muted-foreground col-span-1">{label}</span>
      <span className="text-sm font-medium col-span-2">{displayValue}</span>
    </div>
  );
};


const DocumentItem: React.FC<{ name: string, url?: string, type: string }> = ({ name, url, type }) => (
    <div className="flex items-center justify-between p-3 border rounded-md">
        <div className="flex items-center gap-3">
            <FileUp className="h-5 w-5 text-primary" />
            <div>
                <p className="text-sm font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">{type}</p>
            </div>
        </div>
        {url ? (
            <Button variant="outline" size="sm" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer" data-ai-hint={`${type} document`}>
                    <Download className="mr-2 h-4 w-4" /> View/Download
                </a>
            </Button>
        ) : (
            <Badge variant="outline">Not Uploaded</Badge>
        )}
    </div>
);


export default function AdminEmployeeProfilePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const employeeIdFromUrl = params.id as string;

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isEditing, setIsEditing] = useState(searchParams.get('edit') === 'true');
  const [isRegeneratingQr, setIsRegeneratingQr] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [availableClients, setAvailableClients] = useState<ClientOption[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // State for new file uploads
  const [newProfilePicture, setNewProfilePicture] = useState<File | null>(null);
  const [newIdProofDocument, setNewIdProofDocument] = useState<File | null>(null);
  const [newBankPassbookStatement, setNewBankPassbookStatement] = useState<File | null>(null);

  // State for file previews
  const [profilePicPreview, setProfilePicPreview] = useState<string | null>(null);
  const [idProofPreview, setIdProofPreview] = useState<string | null>(null);
  const [bankPassbookPreview, setBankPassbookPreview] = useState<string | null>(null);
  
  // State for camera dialog
  const [activeCameraField, setActiveCameraField] = useState<CameraField | null>(null);
  const [isCameraDialogOpen, setIsCameraDialogOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const isAdminView = !isAuthLoading && currentUser !== null;

  const form = useForm<EmployeeUpdateValues>({
    resolver: zodResolver(employeeUpdateSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      dateOfBirth: undefined,
      gender: undefined,
      fatherName: "",
      motherName: "",
      maritalStatus: undefined,
      spouseName: "",
      district: "",
      fullAddress: "",
      phoneNumber: "",
      emailAddress: "",
      clientName: "",
      resourceIdNumber: "",
      joiningDate: undefined,
      status: undefined,
      exitDate: null,
      bankName: "",
      bankAccountNumber: "",
      ifscCode: "",
      panNumber: "",
      idProofType: undefined,
      idProofNumber: "",
      epfUanNumber: "",
      esicNumber: "",
    },
  });
  
  const watchStatus = form.watch('status');
  const watchMaritalStatus = form.watch('maritalStatus');

  const fetchEmployee = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const employeeDocRef = doc(db, "employees", employeeIdFromUrl);
      const employeeDocSnap = await getDoc(employeeDocRef);

      if (employeeDocSnap.exists()) {
        const data = employeeDocSnap.data();
        const formattedData: Employee = {
          ...data,
          id: employeeDocSnap.id,
        } as Employee;
        setEmployee(formattedData);
        // Log the fetched data for debugging
        console.log("Fetched employee data for profile page:", formattedData);
      } else {
        setError("Employee not found with the provided ID.");
        toast({ variant: "destructive", title: "Not Found", description: "No employee record found for this ID."});
      }
    } catch (err: any) {
      console.error("Error fetching employee:", err);
      let message = "Failed to fetch employee data.";
      if(err.code === 'permission-denied') {
          message = "Permission Denied. Please ensure Firestore rules allow admins to read employee documents.";
      }
      setError(message);
      toast({ variant: "destructive", title: "Fetch Error", description: message});
    } finally {
      setIsLoading(false);
    }
  }, [employeeIdFromUrl, toast]);
  
  useEffect(() => {
    if (!employeeIdFromUrl) {
      setError("Employee ID not found in URL.");
      setIsLoading(false);
      return;
    }
    fetchEmployee();
  }, [employeeIdFromUrl, fetchEmployee]);

  useEffect(() => {
    if (employee) {
      form.reset({
        ...employee,
        joiningDate: employee.joiningDate?.toDate ? employee.joiningDate.toDate() : new Date(employee.joiningDate),
        dateOfBirth: employee.dateOfBirth?.toDate ? employee.dateOfBirth.toDate() : new Date(employee.dateOfBirth),
        exitDate: employee.exitDate?.toDate ? employee.exitDate.toDate() : (employee.exitDate ? new Date(employee.exitDate) : null),
        // Ensure optional string fields default to "" to avoid uncontrolled to controlled input error
        spouseName: employee.spouseName || "",
        resourceIdNumber: employee.resourceIdNumber || "",
        panNumber: employee.panNumber || "",
        epfUanNumber: employee.epfUanNumber || "",
        esicNumber: employee.esicNumber || "",
      });
    }
  }, [employee, form]);

  useEffect(() => {
    const fetchClients = async () => {
      if (!isAdminView) { setIsLoadingClients(false); return; }
        setIsLoadingClients(true);
        try {
            const clientsQuery = query(collection(db, 'clients'), orderBy('name', 'asc'));
            const snapshot = await getDocs(clientsQuery);
            const fetchedClients = snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name as string }));
            setAvailableClients(fetchedClients);
        } catch (error) {
            console.error("Error fetching clients: ", error);
        } finally {
            setIsLoadingClients(false);
        }
    };
    fetchClients();
  }, [isAdminView]);

  useEffect(() => {
    setIsEditing(isAdminView && searchParams.get('edit') === 'true');
  }, [searchParams, isAdminView]);

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    setFile: React.Dispatch<React.SetStateAction<File | null>>,
    setPreview: React.Dispatch<React.SetStateAction<string | null>>
  ) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({ variant: "destructive", title: "File too large", description: "Please select a file smaller than 5MB." });
        return;
      }
      setFile(file);
      if (file.type.startsWith("image/")) {
        setPreview(URL.createObjectURL(file));
      } else if (file.type === "application/pdf") {
        setPreview("/pdf-icon.png"); 
      }
    }
  };

  const openCamera = (fieldName: CameraField) => {
    setActiveCameraField(fieldName);
    setCameraError(null);
    setIsCameraDialogOpen(true);
    // Camera stream logic is handled in a useEffect to ensure dialog is open first
  };

  useEffect(() => {
    async function getCameraStream() {
      if (!isCameraDialogOpen) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        setCameraStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        setCameraError("Could not access camera. Please ensure permission is granted.");
        setIsCameraDialogOpen(false);
      }
    }
    getCameraStream();
  }, [isCameraDialogOpen]);
  
  const closeCameraDialog = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }
    setCameraStream(null);
    setIsCameraDialogOpen(false);
    setActiveCameraField(null);
  };
  
  const handleCapturePhoto = async () => {
    if (videoRef.current && canvasRef.current && activeCameraField) {
      const canvas = canvasRef.current;
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const context = canvas.getContext('2d');
      context?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const file = await dataURLtoFile(dataUrl, `${activeCameraField}.jpg`);

      if (activeCameraField === 'profilePicture') {
        setNewProfilePicture(file);
        setProfilePicPreview(URL.createObjectURL(file));
      } else if (activeCameraField === 'idProofDocument') {
        setNewIdProofDocument(file);
        setIdProofPreview(URL.createObjectURL(file));
      } else if (activeCameraField === 'bankPassbookStatement') {
        setNewBankPassbookStatement(file);
        setBankPassbookPreview(URL.createObjectURL(file));
      }
      closeCameraDialog();
    }
  };


  async function handleSaveChanges(data: EmployeeUpdateValues) {
    if (!employee) return;
    setIsSubmitting(true);
    toast({ title: "Saving...", description: "Updating employee profile." });

    const updatePromises: Promise<void>[] = [];
    const updatedUrls: { [key: string]: string } = {};

    // Handle Profile Picture
    if (newProfilePicture) {
        updatePromises.push((async () => {
            if (employee.profilePictureUrl) await deleteFileFromStorage(employee.profilePictureUrl);
            const storagePath = `employees/${employee.phoneNumber}/profilePictures/${Date.now()}_profile.jpg`;
            const blob = await compressImage(newProfilePicture, { maxWidth: 500, maxHeight: 500, quality: 0.8 });
            updatedUrls.profilePictureUrl = await uploadFileToStorage(blob, storagePath);
        })());
    }

    // Handle ID Proof
    if (newIdProofDocument) {
        updatePromises.push((async () => {
            if (employee.idProofDocumentUrl) await deleteFileFromStorage(employee.idProofDocumentUrl);
            const ext = newIdProofDocument.name.split('.').pop() || 'bin';
            const storagePath = `employees/${employee.phoneNumber}/idProofs/${Date.now()}_id.${newIdProofDocument.type.startsWith("image/") ? 'jpg' : ext}`;
            const fileToUpload = newIdProofDocument.type.startsWith("image/")
                ? await compressImage(newIdProofDocument, { maxWidth: 1024, maxHeight: 1024, quality: 0.7 })
                : newIdProofDocument;
            updatedUrls.idProofDocumentUrl = await uploadFileToStorage(fileToUpload, storagePath);
        })());
    }

    // Handle Bank Passbook
    if (newBankPassbookStatement) {
        updatePromises.push((async () => {
            if (employee.bankPassbookStatementUrl) await deleteFileFromStorage(employee.bankPassbookStatementUrl);
            const ext = newBankPassbookStatement.name.split('.').pop() || 'bin';
            const storagePath = `employees/${employee.phoneNumber}/bankDocuments/${Date.now()}_bank.${newBankPassbookStatement.type.startsWith("image/") ? 'jpg' : ext}`;
            const fileToUpload = newBankPassbookStatement.type.startsWith("image/")
                ? await compressImage(newBankPassbookStatement, { maxWidth: 1024, maxHeight: 1024, quality: 0.7 })
                : newBankPassbookStatement;
            updatedUrls.bankPassbookStatementUrl = await uploadFileToStorage(fileToUpload, storagePath);
        })());
    }
    
    try {
        await Promise.all(updatePromises);

        const formPayload: Record<string, any> = {};
        const original = employee;

        (Object.keys(data) as Array<keyof EmployeeUpdateValues>).forEach(key => {
            const formValue = data[key];
            const originalValue = original[key as keyof Employee];
            if (key === 'dateOfBirth' || key === 'joiningDate' || key === 'exitDate') {
                const formDate = formValue as Date | null | undefined;
                const originalDate = originalValue?.toDate ? originalValue.toDate() : (originalValue ? new Date(originalValue) : null);
                if (formDate?.getTime() !== originalDate?.getTime()) {
                    formPayload[key] = formValue ? Timestamp.fromDate(formValue) : (key === 'exitDate' ? deleteField() : originalValue);
                }
            } else if (formValue !== originalValue) {
                formPayload[key] = formValue;
            }
        });

        if (data.status !== 'Exited' && employee.exitDate) formPayload.exitDate = deleteField();
        if (data.maritalStatus !== 'Married' && employee.spouseName) formPayload.spouseName = "";

        const finalPayload = { ...formPayload, ...updatedUrls };

        if (Object.keys(finalPayload).length > 0) {
            finalPayload.updatedAt = serverTimestamp();
            const employeeDocRef = doc(db, "employees", employee.id);
            await updateDoc(employeeDocRef, finalPayload);
            toast({ title: "Profile Updated", description: "Employee details have been saved." });
            await fetchEmployee();
            toggleEditMode(false);
        } else {
            toast({ title: "No Changes", description: "No changes were detected to save." });
            toggleEditMode(false);
        }
    } catch (err: any) {
        console.error("Error updating profile:", err);
        toast({ variant: "destructive", title: "Update Failed", description: err.message || "An error occurred while saving." });
    } finally {
        setIsSubmitting(false);
    }
  }

  const getStatusBadgeVariant = (status?: Employee['status']) => {
    switch (status) {
      case 'Active': return 'default';
      case 'Inactive': return 'secondary';
      case 'OnLeave': return 'outline';
      case 'Exited': return 'destructive';
      default: return 'outline';
    }
  };

  const handleDownloadProfile = () => {
    toast({
      title: "Download Requested",
      description: "CV/Biodata download functionality is under development.",
    });
  };

  const handleRegenerateQrCode = async () => {
    if (!employee) return;
    setIsRegeneratingQr(true);
    try {
      const dataString = `Employee ID: ${employee.employeeId}\nName: ${employee.fullName}\nPhone: ${employee.phoneNumber}`;
      const newQrDataUrl = await QRCode.toDataURL(dataString, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        quality: 0.92,
        margin: 1,
        width: 256,
      });

      const employeeDocRef = doc(db, "employees", employee.id);
      await updateDoc(employeeDocRef, {
        qrCodeUrl: newQrDataUrl,
        updatedAt: serverTimestamp(),
      });

      setEmployee(prev => prev ? { ...prev, qrCodeUrl: newQrDataUrl } : null);
      toast({ title: "QR Code Regenerated", description: "Employee QR code has been updated." });

    } catch (err) {
      console.error("Error regenerating QR code:", err);
      toast({ variant: "destructive", title: "QR Regeneration Failed", description: "Could not regenerate the QR code." });
    } finally {
      setIsRegeneratingQr(false);
    }
  };
  
  const resetFileStates = () => {
      setNewProfilePicture(null);
      setNewIdProofDocument(null);
      setNewBankPassbookStatement(null);
      setProfilePicPreview(null);
      setIdProofPreview(null);
      setBankPassbookPreview(null);
  }

  const toggleEditMode = (forceState?: boolean) => {
    const newEditState = forceState !== undefined ? forceState : !isEditing;
    const path = `/employees/${employeeIdFromUrl}`;
    if (newEditState) {
      router.push(`${path}?edit=true`, { scroll: false });
    } else {
      resetFileStates();
      form.reset(employee ? {
          ...employee,
          joiningDate: employee.joiningDate?.toDate ? employee.joiningDate.toDate() : new Date(employee.joiningDate),
          dateOfBirth: employee.dateOfBirth?.toDate ? employee.dateOfBirth.toDate() : new Date(employee.dateOfBirth),
          exitDate: employee.exitDate?.toDate ? employee.exitDate.toDate() : (employee.exitDate ? new Date(employee.exitDate) : null),
      } : {});
      router.push(path, { scroll: false });
    }
  };
  
  if (isLoading || isAuthLoading) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-200px)]">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-lg text-muted-foreground">Loading employee profile...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="max-w-lg mx-auto my-10">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
            {error}
            <Button onClick={() => router.push(isAdminView ? '/employees' : '/')} className="mt-4">
              {isAdminView ? <><ArrowLeft className="mr-2 h-4 w-4" />Back to Directory</> : <><Home className="mr-2 h-4 w-4" />Back to Home</>}
            </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!employee) {
    return (
         <Alert variant="default" className="max-w-lg mx-auto my-10">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Employee Not Found</AlertTitle>
            <AlertDescription>
                The requested employee profile could not be found.
                <Button onClick={() => router.push(isAdminView ? '/employees' : '/')} className="mt-4">
                   {isAdminView ? <><ArrowLeft className="mr-2 h-4 w-4" />Back to Directory</> : <><Home className="mr-2 h-4 w-4" />Back to Home</>}
                </Button>
            </AlertDescription>
        </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="mb-4">
        <Button variant="outline" size="sm" onClick={() => router.push(isAdminView ? '/employees' : '/')}>
            {isAdminView ? <><ArrowLeft className="mr-2 h-4 w-4" />Back to Employee Directory</> : <><Home className="mr-2 h-4 w-4" />Back to Home</>}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Image
            src={employee.profilePictureUrl || "https://placehold.co/128x128.png"}
            alt={employee.fullName || 'Employee profile picture'}
            width={100}
            height={100}
            className="rounded-full border-4 border-primary shadow-md object-cover"
            data-ai-hint="profile picture"
          />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{employee.fullName}</h1>
            <p className="text-muted-foreground">{employee.employeeId} - {employee.clientName || "N/A"}</p>
            <Badge variant={getStatusBadgeVariant(employee.status)} className="mt-1">{employee.status}</Badge>
          </div>
        </div>
        {isAdminView && (
          <div className="flex gap-2 mt-4 sm:mt-0">
            <Button onClick={handleDownloadProfile} variant="outline">
                <Download className="mr-2 h-4 w-4" /> Download Profile
            </Button>
            <Button onClick={() => toggleEditMode()}>
                <Edit3 className="mr-2 h-4 w-4" /> {isEditing ? "Cancel Editing" : "Edit Profile"}
            </Button>
          </div>
        )}
      </div>

      {!isEditing && (
        <Tabs defaultValue="personal">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 gap-2">
            <TabsTrigger value="personal"><User className="mr-2 h-4 w-4 sm:hidden md:inline-block" />Personal</TabsTrigger>
            <TabsTrigger value="employment"><Briefcase className="mr-2 h-4 w-4 sm:hidden md:inline-block" />Employment</TabsTrigger>
            <TabsTrigger value="bank"><Banknote className="mr-2 h-4 w-4 sm:hidden md:inline-block" />Bank</TabsTrigger>
            <TabsTrigger value="identification"><ShieldCheck className="mr-2 h-4 w-4 sm:hidden md:inline-block" />Identification</TabsTrigger>
            <TabsTrigger value="qr"><QrCode className="mr-2 h-4 w-4 sm:hidden md:inline-block" />QR & Docs</TabsTrigger>
          </TabsList>
          <Card className="mt-4">
            <CardContent className="pt-6">
              <TabsContent value="personal">
                <CardTitle className="mb-4">Personal Information</CardTitle>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                  <DetailItem label="First Name" value={employee.firstName} />
                  <DetailItem label="Last Name" value={employee.lastName} />
                  <DetailItem label="Date of Birth" value={employee.dateOfBirth} isDate />
                  <DetailItem label="Gender" value={employee.gender} />
                  <DetailItem label="Father's Name" value={employee.fatherName} />
                  <DetailItem label="Mother's Name" value={employee.motherName} />
                  <DetailItem label="Marital Status" value={employee.maritalStatus} />
                  {employee.maritalStatus === "Married" && <DetailItem label="Spouse Name" value={employee.spouseName} />}
                  <DetailItem label="District" value={employee.district} />
                </div>
                <Separator className="my-6" />
                <CardTitle className="text-lg mb-2">Contact Details</CardTitle>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                  <DetailItem label="Phone Number" value={employee.phoneNumber} />
                  <DetailItem label="Email Address" value={employee.emailAddress} />
                   <div className="md:col-span-2">
                      <DetailItem label="Full Address" value={employee.fullAddress} />
                   </div>
                </div>
              </TabsContent>
              <TabsContent value="employment">
                <CardTitle className="mb-4">Employment Details</CardTitle>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                  <DetailItem label="Employee ID" value={employee.employeeId} />
                  <DetailItem label="Client Name" value={employee.clientName} />
                  {employee.resourceIdNumber && <DetailItem label="Resource ID" value={employee.resourceIdNumber} />}
                  <DetailItem label="Joining Date" value={employee.joiningDate} isDate />
                  <DetailItem label="Status" value={employee.status} />
                  {employee.status === 'Exited' && employee.exitDate && (
                      <DetailItem label="Exit Date" value={employee.exitDate} isDate />
                  )}
                </div>
              </TabsContent>
              <TabsContent value="bank">
                <CardTitle className="mb-4">Bank Account Details</CardTitle>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                  <DetailItem label="Bank Name" value={employee.bankName} />
                  <DetailItem label="Account Number" value={employee.bankAccountNumber} />
                  <DetailItem label="IFSC Code" value={employee.ifscCode} />
                </div>
              </TabsContent>
              <TabsContent value="identification">
                <CardTitle className="mb-4">Identification Details</CardTitle>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                  <DetailItem label="PAN Number" value={employee.panNumber} />
                  <DetailItem label="ID Proof Type" value={employee.idProofType} />
                  <DetailItem label="ID Proof Number" value={employee.idProofNumber} />
                  <DetailItem label="EPF UAN Number" value={employee.epfUanNumber} />
                  <DetailItem label="ESIC Number" value={employee.esicNumber} />
                </div>
              </TabsContent>
              <TabsContent value="qr">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                      <CardTitle className="mb-4">Employee QR Code</CardTitle>
                      <div className="flex flex-col items-center p-4 border rounded-md shadow-sm bg-muted/20">
                          {employee.qrCodeUrl ? (
                              <Image src={employee.qrCodeUrl} alt="Employee QR Code" width={200} height={200} data-ai-hint="qr code employee"/>
                          ) : (
                              <p className="text-muted-foreground">QR Code not available.</p>
                          )}
                      </div>
                  </div>
                  <div>
                      <CardTitle className="mb-4">Uploaded Documents</CardTitle>
                      <div className="space-y-3">
                          <DocumentItem name="Profile Picture" url={employee.profilePictureUrl} type="Employee Photo" />
                          <DocumentItem name="ID Proof" url={employee.idProofDocumentUrl} type={employee.idProofType || "ID Document"} />
                          <DocumentItem name="Bank Passbook/Statement" url={employee.bankPassbookStatementUrl} type="Bank Document" />
                      </div>
                  </div>
                </div>
              </TabsContent>
            </CardContent>
          </Card>
        </Tabs>
      )}

      {isAdminView && isEditing && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSaveChanges)}>
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Edit Profile Information</CardTitle>
                <CardDescription>Update employee details below. Click "Save Changes" when done.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                {/* Personal Information Section */}
                <section>
                  <h3 className="text-lg font-semibold mb-4 border-b pb-2">Personal & Contact</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField control={form.control} name="firstName" render={({ field }) => (<FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="lastName" render={({ field }) => (<FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="fatherName" render={({ field }) => (<FormItem><FormLabel>Father's Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="motherName" render={({ field }) => (<FormItem><FormLabel>Mother's Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="dateOfBirth" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>Date of Birth</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant="outline" className={cn("w-full justify-start", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4" /></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={(d) => d > new Date()} initialFocus /></PopoverContent></Popover><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="gender" render={({ field }) => (<FormItem><FormLabel>Gender</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{genderOptions.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="maritalStatus" render={({ field }) => (<FormItem><FormLabel>Marital Status</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{maritalStatuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                    {watchMaritalStatus === 'Married' && <FormField control={form.control} name="spouseName" render={({ field }) => (<FormItem><FormLabel>Spouse Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />}
                    <FormField control={form.control} name="phoneNumber" render={({ field }) => (<FormItem><FormLabel>Phone Number</FormLabel><FormControl><Input type="tel" {...field} /></FormControl><FormDescription>Cannot be changed after enrollment.</FormDescription><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="emailAddress" render={({ field }) => (<FormItem><FormLabel>Email Address</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="district" render={({ field }) => (<FormItem><FormLabel>District</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{keralaDistricts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="fullAddress" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>Full Address</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>)} />
                  </div>
                </section>
                {/* Employment Information Section */}
                <section>
                  <h3 className="text-lg font-semibold mb-4 border-b pb-2">Employment</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormItem><FormLabel>Employee ID</FormLabel><FormControl><Input value={employee.employeeId} disabled /></FormControl><FormDescription>Employee ID cannot be changed.</FormDescription></FormItem>
                    <FormField control={form.control} name="clientName" render={({ field }) => (<FormItem><FormLabel>Client Name</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoadingClients}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{availableClients.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="resourceIdNumber" render={({ field }) => (<FormItem><FormLabel>Resource ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="joiningDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>Joining Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant="outline" className={cn("w-full justify-start", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4" /></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="status" render={({ field }) => (<FormItem><FormLabel>Status</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{employeeStatuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                    {watchStatus === 'Exited' && <FormField control={form.control} name="exitDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>Exit Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant="outline" className={cn("w-full justify-start", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick exit date</span>}<CalendarIcon className="ml-auto h-4 w-4" /></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value ?? undefined} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage /></FormItem>)} />}
                  </div>
                </section>
                {/* Bank & ID Section */}
                <section>
                  <h3 className="text-lg font-semibold mb-4 border-b pb-2">Bank & Identification</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField control={form.control} name="bankName" render={({ field }) => (<FormItem><FormLabel>Bank Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="bankAccountNumber" render={({ field }) => (<FormItem><FormLabel>Account Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="ifscCode" render={({ field }) => (<FormItem><FormLabel>IFSC Code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="panNumber" render={({ field }) => (<FormItem><FormLabel>PAN Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="idProofType" render={({ field }) => (<FormItem><FormLabel>ID Proof Type</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{idProofTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="idProofNumber" render={({ field }) => (<FormItem><FormLabel>ID Proof Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="epfUanNumber" render={({ field }) => (<FormItem><FormLabel>EPF UAN Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="esicNumber" render={({ field }) => (<FormItem><FormLabel>ESIC Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                  </div>
                </section>
                {/* Documents Section */}
                <section>
                    <h3 className="text-lg font-semibold mb-4 border-b pb-2">Documents</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Profile Picture */}
                        <div className="flex flex-col items-center gap-2 p-4 border rounded-md">
                            <Label>Profile Picture</Label>
                            <Image src={profilePicPreview || employee.profilePictureUrl || "https://placehold.co/128x128.png"} alt="Profile" width={128} height={128} className="rounded-full object-cover h-32 w-32" data-ai-hint="profile picture" />
                            <div className="flex gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById('profilePictureInput')?.click()}><Upload className="mr-2 h-4 w-4" /> Upload</Button>
                                <Button type="button" size="sm" variant="outline" onClick={() => openCamera('profilePicture')}><Camera className="mr-2 h-4 w-4" /> Camera</Button>
                            </div>
                            <Input id="profilePictureInput" type="file" className="hidden" accept="image/*" onChange={(e) => handleFileChange(e, setNewProfilePicture, setProfilePicPreview)} />
                        </div>
                        {/* ID Proof */}
                        <div className="flex flex-col items-center gap-2 p-4 border rounded-md">
                            <Label>ID Proof</Label>
                             <Image src={idProofPreview || (employee.idProofDocumentUrl?.includes('.pdf') ? '/pdf-icon.png' : employee.idProofDocumentUrl) || "https://placehold.co/200x120.png"} alt="ID Proof" width={200} height={120} className="object-contain h-32 w-full" data-ai-hint="id card" />
                            <div className="flex gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById('idProofInput')?.click()}><Upload className="mr-2 h-4 w-4" /> Upload</Button>
                                <Button type="button" size="sm" variant="outline" onClick={() => openCamera('idProofDocument')}><Camera className="mr-2 h-4 w-4" /> Camera</Button>
                            </div>
                            <Input id="idProofInput" type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => handleFileChange(e, setNewIdProofDocument, setIdProofPreview)} />
                        </div>
                        {/* Bank Passbook */}
                        <div className="flex flex-col items-center gap-2 p-4 border rounded-md">
                            <Label>Bank Document</Label>
                            <Image src={bankPassbookPreview || (employee.bankPassbookStatementUrl?.includes('.pdf') ? '/pdf-icon.png' : employee.bankPassbookStatementUrl) || "https://placehold.co/200x120.png"} alt="Bank Document" width={200} height={120} className="object-contain h-32 w-full" data-ai-hint="bank document" />
                             <div className="flex gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById('bankPassbookInput')?.click()}><Upload className="mr-2 h-4 w-4" /> Upload</Button>
                                <Button type="button" size="sm" variant="outline" onClick={() => openCamera('bankPassbookStatement')}><Camera className="mr-2 h-4 w-4" /> Camera</Button>
                            </div>
                            <Input id="bankPassbookInput" type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => handleFileChange(e, setNewBankPassbookStatement, setBankPassbookPreview)} />
                        </div>
                    </div>
                </section>
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => toggleEditMode(false)} disabled={isSubmitting}>Cancel</Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </CardFooter>
            </Card>
          </form>
        </Form>
      )}

    <Dialog open={isCameraDialogOpen} onOpenChange={setIsCameraDialogOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Take Photo</DialogTitle>
            </DialogHeader>
            <div className="py-4">
                 {cameraError && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{cameraError}</AlertDescription></Alert>}
                <video ref={videoRef} autoPlay playsInline muted className={cn("w-full h-auto rounded-md border", { 'hidden': cameraError })} />
                <canvas ref={canvasRef} className="hidden" />
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={closeCameraDialog}>Cancel</Button>
                <Button onClick={handleCapturePhoto} disabled={!!cameraError || !cameraStream}>Capture</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    </div>
  );
}
