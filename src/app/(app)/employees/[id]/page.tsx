

"use client";

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { type Employee } from '@/types/employee';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from '@/components/ui/separator';
import { Edit3, User, Briefcase, Banknote, ShieldCheck, QrCode, FileUp, Download, Loader2, AlertCircle, RefreshCw, ArrowLeft, Home, CalendarIcon, Upload, Camera, Edit, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { db, auth, storage } from '@/lib/firebase';
import { doc, getDoc, Timestamp, updateDoc, serverTimestamp, collection, query, orderBy, getDocs, deleteField } from 'firebase/firestore';
import { format, subYears, addYears } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import QRCode from 'qrcode';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { ref, getBytes } from 'firebase/storage';


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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { compressImage, uploadFileToStorage, dataURLtoFile, deleteFileFromStorage } from "@/lib/storageUtils";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';

// #region PDF Text Helper Functions
// Normalize weird whitespace, keep intended line breaks as separators.
function normalizePdfText(input: unknown) {
  let s = (input ?? '').toString();
  s = s.replace(/\r\n/g, '\n');         // normalize CRLF
  s = s.replace(/\r/g, '\n');           // normalize CR
  s = s.replace(/\u00A0/g, ' ');        // nbsp → space
  s = s.replace(/\t/g, ' ');            // tabs → space
  s = s.replace(/[\u2028\u2029]/g, ' ');// LS/PS → space
  return s;
}

// Simple width-based wrapper using pdf-lib-like API
function wrapTextToWidth(
  text: string,
  font: any,               // the embedded font object
  fontSize: number,
  maxWidth: number
) {
  const lines: string[] = [];
  for (const raw of normalizePdfText(text).split('\n')) {
    const words = raw.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      const width = font.widthOfTextAtSize(test, fontSize);
      if (width > maxWidth) {
        if (line) lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    lines.push(line || ''); // push even if empty line
  }
  return lines;
}

// Safe draw that never feeds \n into width/draw calls
function drawMultilineText(opts: {
  page: any;
  text: string;
  font: any;
  fontSize: number;
  x: number;
  y: number;          // top baseline
  maxWidth: number;
  lineHeight?: number;
  color?: any;
}) {
  const { page, text, font, fontSize, x, y, maxWidth, lineHeight = fontSize * 1.2, color } = opts;
  const lines = wrapTextToWidth(text, font, fontSize, maxWidth);
  let yy = y;
  for (const line of lines) {
    // IMPORTANT: line contains no \n now
    page.drawText(line, { x, y: yy, size: fontSize, font, color });
    yy -= lineHeight;
  }
}
// #endregion

// Ensure individual strings passed to drawText/widthOfTextAtSize contain no newlines
function sanitizePdfString(input: unknown): string {
  const s = normalizePdfText(input);
  return s.replace(/\n/g, ' ');
}


// Dropdown options
// Keep this list in sync with the public enrollment form.
const keralaDistricts = [
  "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha",
  "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad",
  "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod", "Lakshadweep"
];
const idProofOptions = ["PAN Card", "Voter ID", "Driving License", "Passport", "Birth Certificate", "School Certificate", "Aadhar Card"];
const maritalStatuses = ["Married", "Unmarried"];
const genderOptions = ["Male", "Female", "Other"];
const employeeStatuses = ['Active', 'Inactive', 'OnLeave', 'Exited'];
const educationOptions = ["Primary School", "High School", "Diploma", "Graduation", "Post Graduation", "Doctorate", "Any Other Qualification"];
interface ClientOption { id: string; name: string; }
type CameraField = "profilePicture" | "identityProofUrlFront" | "identityProofUrlBack" | "addressProofUrlFront" | "addressProofUrlBack" | "signatureUrl" | "bankPassbookStatement" | "policeClearanceCertificate";


const proofTypes = z.enum(["PAN Card", "Voter ID", "Driving License", "Passport", "Birth Certificate", "School Certificate", "Aadhar Card"]);
const qualificationTypes = z.enum(["Primary School", "High School", "Diploma", "Graduation", "Post Graduation", "Doctorate", "Any Other Qualification"]);


// Zod schema for validation
const employeeUpdateSchema = z.object({
  firstName: z.string().min(1, "First name is required."),
  lastName: z.string().min(1, "Last name is required."),
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
  gender: z.enum(["Male", "Female", "Other"]),
  fatherName: z.string().min(2, "Father's name is required."),
  motherName: z.string().min(2, "Mother's name is required."),
  maritalStatus: z.enum(["Married", "Unmarried"]),
  spouseName: z.string().optional(),
  educationalQualification: qualificationTypes,
  otherQualification: z.string().optional(),
  district: z.string(),
  fullAddress: z.string().min(10, "Address is required."),
  phoneNumber: z.string().regex(/^\d{10}$/, "Must be 10 digits."),
  emailAddress: z.string().email(),
  clientName: z.string().min(1, "Client name is required."),
  resourceIdNumber: z.string().optional(),
  joiningDate: z.date({ required_error: "Joining date is required." }),
  status: z.enum(['Active', 'Inactive', 'OnLeave', 'Exited']),
  exitDate: z.date().optional().nullable(),
  bankName: z.string().optional().or(z.literal('')),
  bankAccountNumber: z.string().optional().or(z.literal('')),
  ifscCode: z.string().optional().or(z.literal('')),
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN format.").optional().or(z.literal('')),
  
  identityProofType: proofTypes,
  identityProofNumber: z.string().min(5, "ID Proof number is required."),
  
  addressProofType: proofTypes,
  addressProofNumber: z.string().min(5, { message: "Address proof number is required." }),

  epfUanNumber: z.string().optional(),
  esicNumber: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.maritalStatus === "Married" && (!data.spouseName || data.spouseName.trim() === "")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Spouse name is required if married.", path: ["spouseName"] });
  }
  if (data.status === 'Exited' && !data.exitDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Exit date is required if status is Exited.", path: ["exitDate"] });
  }
  if (data.educationalQualification === "Any Other Qualification" && (!data.otherQualification || data.otherQualification.trim() === "")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please specify your qualification.", path: ["otherQualification"] });
  }
});
type EmployeeUpdateValues = z.infer<typeof employeeUpdateSchema>;

const toTitleCase = (str: string | null | undefined): string => {
    if (!str) return '';
    if (str.includes('@')) return str.toLowerCase(); // Keep emails lowercase
    if (str.toUpperCase() === str) { // Likely an all-caps address
        return str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
    }
    return str.replace(/\b\w/g, char => char.toUpperCase());
};

const DetailItem: React.FC<{ label: string; value?: string | number | null | Date; isDate?: boolean; isName?: boolean; isAddress?: boolean }> = ({ label, value, isDate, isName, isAddress }) => {
  let displayValue: string | number = 'N/A';
  if (value !== null && value !== undefined) {
    if (value instanceof Timestamp) {
      displayValue = format(value.toDate(), "dd-MM-yyyy");
    } else if (isDate && (value instanceof Date || typeof value === 'string')) {
       try {
        displayValue = format(new Date(value), "dd-MM-yyyy");
       } catch (e) {
        displayValue = 'Invalid Date';
       }
    } else {
      displayValue = String(value);
      if (isName || isAddress) {
          displayValue = toTitleCase(displayValue);
      }
    }
  }
  return (
    <div className="flex flex-col sm:grid sm:grid-cols-3 gap-1 sm:gap-2 py-1.5">
      <span className="text-sm text-muted-foreground sm:col-span-1">{label}</span>
      <span className="text-sm font-medium sm:col-span-2">{displayValue}</span>
    </div>
  );
};


const DocumentItem: React.FC<{ name: string, url?: string, type?: string }> = ({ name, url, type }) => (
    <div className="flex items-center justify-between p-3 border rounded-md">
        <div className="flex items-center gap-3">
            <FileUp className="h-5 w-5 text-primary" />
            <div>
                <p className="text-sm font-medium">{name}</p>
                {type && <p className="text-xs text-muted-foreground">{type}</p>}
            </div>
        </div>
        {url ? (
            <Button variant="outline" size="sm" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer" data-ai-hint={`${type || 'document'} document`}>
                    <Download className="mr-2 h-4 w-4" /> View/Download
                </a>
            </Button>
        ) : (
            <Badge variant="outline">Not Uploaded</Badge>
        )}
    </div>
);

// Employee ID Generation Logic
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
        // Use correct QRCode.toDataURL overload (text, options)
        const url = await QRCode.toDataURL(dataString, {
            errorCorrectionLevel: 'H',
            margin: 1,
            width: 256,
            // type is allowed in latest qrcode types; keep as any cast to satisfy older types
            type: 'image/png' as any,
        } as any);
        return url as unknown as string;
    } catch (err) {
        console.error('QR code generation failed:', err);
        throw new Error('Failed to generate QR code.');
    }
};

async function fetchImageBytes(url: string | undefined): Promise<Uint8Array | null> {
    if (!url) return null;
    try {
      // The Firebase Storage SDK is the most reliable way to fetch storage objects
      // as it handles authentication and permissions gracefully.
      const storageRef = ref(storage, url);
      const bytes = await getBytes(storageRef);
      // Return as Uint8Array for pdf-lib embed
      return new Uint8Array(bytes);
    } catch (error: any) {
      if (error.code === 'storage/object-not-found') {
        console.warn(`Image not found at path: ${url}. The file may have been deleted or the URL is incorrect.`);
      } else {
        console.error(`Error fetching image bytes for ${url}:`, error);
      }
      return null;
    }
  }


export default function AdminEmployeeProfilePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const employeeIdFromUrl = params.id as string;
  

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isEditing, setIsEditing] = useState(false);
  const [isRegeneratingQr, setIsRegeneratingQr] = useState(false);
  const [isRegeneratingId, setIsRegeneratingId] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const [availableClients, setAvailableClients] = useState<ClientOption[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // State for new file uploads
  const [newProfilePicture, setNewProfilePicture] = useState<File | null>(null);
  const [newIdentityProofUrlFront, setNewIdentityProofUrlFront] = useState<File | null>(null);
  const [newIdentityProofUrlBack, setNewIdentityProofUrlBack] = useState<File | null>(null);
  const [newAddressProofUrlFront, setNewAddressProofUrlFront] = useState<File | null>(null);
  const [newAddressProofUrlBack, setNewAddressProofUrlBack] = useState<File | null>(null);
  const [newSignatureUrl, setNewSignatureUrl] = useState<File | null>(null);
  const [newBankPassbookStatement, setNewBankPassbookStatement] = useState<File | null>(null);
  const [newPoliceClearanceCertificate, setNewPoliceClearanceCertificate] = useState<File | null>(null);

  // State for file previews
  const [profilePicPreview, setProfilePicPreview] = useState<string | null>(null);
  const [identityProofUrlFrontPreview, setIdentityProofUrlFrontPreview] = useState<string | null>(null);
  const [identityProofUrlBackPreview, setIdentityProofUrlBackPreview] = useState<string | null>(null);
  const [addressProofUrlFrontPreview, setAddressProofUrlFrontPreview] = useState<string | null>(null);
  const [addressProofUrlBackPreview, setAddressProofUrlBackPreview] = useState<string | null>(null);
  const [signatureUrlPreview, setSignatureUrlPreview] = useState<string | null>(null);
  const [bankPassbookPreview, setBankPassbookPreview] = useState<string | null>(null);
  const [policeCertificatePreview, setPoliceCertificatePreview] = useState<string | null>(null);
  
  // State for camera dialog
  const [activeCameraField, setActiveCameraField] = useState<CameraField | null>(null);
  const [isCameraDialogOpen, setIsCameraDialogOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [isDobPopoverOpen, setIsDobPopoverOpen] = useState(false);
  const [isJoiningDatePopoverOpen, setIsJoiningDatePopoverOpen] = useState(false);

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
      educationalQualification: undefined,
      otherQualification: "",
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
      identityProofType: undefined,
      identityProofNumber: "",
      addressProofType: undefined,
      addressProofNumber: "",
      epfUanNumber: "",
      esicNumber: "",
    },
  });
  
  const watchStatus = form.watch('status');
  const watchMaritalStatus = form.watch('maritalStatus');
  const watchEducationalQualification = form.watch("educationalQualification");


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
    setIsEditing(isAdminView && searchParams.get('edit') === 'true');
  }, [searchParams, isAdminView]);

  useEffect(() => {
    if (employee) {
      const legacy = employee as any;
      const getInitialValue = (key: keyof Employee, fallback: any = "") => {
          const value = employee[key];
          return value === undefined || value === null ? fallback : value;
      };
  
      form.reset({
        ...employee,
        joiningDate: employee.joiningDate?.toDate ? employee.joiningDate.toDate() : new Date(employee.joiningDate),
        dateOfBirth: employee.dateOfBirth?.toDate ? employee.dateOfBirth.toDate() : new Date(employee.dateOfBirth),
        exitDate: employee.exitDate?.toDate ? employee.exitDate.toDate() : (employee.exitDate ? new Date(employee.exitDate) : null),
        spouseName: getInitialValue('spouseName', ''),
        resourceIdNumber: getInitialValue('resourceIdNumber', ''),
        panNumber: getInitialValue('panNumber', ''),
        epfUanNumber: getInitialValue('epfUanNumber', ''),
        esicNumber: getInitialValue('esicNumber', ''),
        otherQualification: getInitialValue('otherQualification', ''),
        identityProofType: (employee.identityProofType || legacy.idProofType) as any,
        identityProofNumber: (employee.identityProofNumber || legacy.idProofNumber) ?? '',
        addressProofType: employee.addressProofType as any,
        addressProofNumber: getInitialValue('addressProofNumber', ''),
        bankName: getInitialValue('bankName', ''),
        bankAccountNumber: getInitialValue('bankAccountNumber', ''),
        ifscCode: getInitialValue('ifscCode', ''),
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
  };

  useEffect(() => {
    async function getCameraStream() {
      if (!isCameraDialogOpen) return;
      try {
        let facingMode: VideoFacingModeEnum = "user";
        if (activeCameraField && activeCameraField !== 'profilePicture') {
            facingMode = "environment";
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
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
  }, [isCameraDialogOpen, activeCameraField]);
  
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

      const previewUrl = URL.createObjectURL(file);

      switch (activeCameraField) {
        case 'profilePicture': setNewProfilePicture(file); setProfilePicPreview(previewUrl); break;
        case 'identityProofUrlFront': setNewIdentityProofUrlFront(file); setIdentityProofUrlFrontPreview(previewUrl); break;
        case 'identityProofUrlBack': setNewIdentityProofUrlBack(file); setIdentityProofUrlBackPreview(previewUrl); break;
        case 'addressProofUrlFront': setNewAddressProofUrlFront(file); setAddressProofUrlFrontPreview(previewUrl); break;
        case 'addressProofUrlBack': setNewAddressProofUrlBack(file); setAddressProofUrlBackPreview(previewUrl); break;
        case 'signatureUrl': setNewSignatureUrl(file); setSignatureUrlPreview(previewUrl); break;
        case 'bankPassbookStatement': setNewBankPassbookStatement(file); setBankPassbookPreview(previewUrl); break;
        case 'policeClearanceCertificate': setNewPoliceClearanceCertificate(file); setPoliceCertificatePreview(previewUrl); break;
      }
      closeCameraDialog();
    }
  };


  async function handleSaveChanges(data: EmployeeUpdateValues) {
    if (!employee) return;
    const legacy = employee as any;
    
    // Custom check for mandatory file fields, considering legacy data
    if (!newProfilePicture && !employee.profilePictureUrl) { toast({ variant: "destructive", title: "Missing Document", description: "Profile Picture is required."}); return; }
    if (!newIdentityProofUrlFront && !employee.identityProofUrlFront && !legacy.idProofDocumentUrlFront && !legacy.idProofDocumentUrl) { toast({ variant: "destructive", title: "Missing Document", description: "Identity Proof (Front) is required."}); return; }
    if (!newIdentityProofUrlBack && !employee.identityProofUrlBack && !legacy.idProofDocumentUrlBack) { toast({ variant: "destructive", title: "Missing Document", description: "Identity Proof (Back) is required."}); return; }
    if (!newAddressProofUrlFront && !employee.addressProofUrlFront) { toast({ variant: "destructive", title: "Missing Document", description: "Address Proof (Front) is required."}); return; }
    if (!newAddressProofUrlBack && !employee.addressProofUrlBack) { toast({ variant: "destructive", title: "Missing Document", description: "Address Proof (Back) is required."}); return; }
    if (!newSignatureUrl && !employee.signatureUrl) { toast({ variant: "destructive", title: "Missing Document", description: "Signature is required."}); return; }
    
    // Bank passbook is optional
    // if (!newBankPassbookStatement && !employee.bankPassbookStatementUrl) { toast({ variant: "destructive", title: "Missing Document", description: "Bank Document is required."}); return; }

    setIsSubmitting(true);
    toast({ title: "Saving...", description: "Updating employee profile." });

    const updatedUrls: { [key: string]: string | null } = {};

    const uploadAndSetUrl = async (
        newFile: File | null,
        oldUrl: string | undefined,
        filePath: string,
        urlKey: keyof typeof updatedUrls,
        isImage: boolean
    ) => {
        if (!newFile) return;
        if (oldUrl) {
            await deleteFileFromStorage(oldUrl);
        }
        
        const fileToUpload = isImage
            ? await compressImage(newFile, { maxWidth: 1024, maxHeight: 1024, quality: 0.7 })
            : newFile;
            
        updatedUrls[urlKey] = await uploadFileToStorage(fileToUpload, filePath);
    };

    try {
        const uploadJobs = [
            { file: newProfilePicture, oldUrl: employee.profilePictureUrl, path: `employees/${employee.phoneNumber}/profilePictures/${Date.now()}_profile.jpg`, key: 'profilePictureUrl', isImage: true },
            { file: newIdentityProofUrlFront, oldUrl: employee.identityProofUrlFront, path: `employees/${employee.phoneNumber}/idProofs/${Date.now()}_id_front.${newIdentityProofUrlFront?.name.split('.').pop()}`, key: 'identityProofUrlFront', isImage: newIdentityProofUrlFront?.type.startsWith("image/") ?? false },
            { file: newIdentityProofUrlBack, oldUrl: employee.identityProofUrlBack, path: `employees/${employee.phoneNumber}/idProofs/${Date.now()}_id_back.${newIdentityProofUrlBack?.name.split('.').pop()}`, key: 'identityProofUrlBack', isImage: newIdentityProofUrlBack?.type.startsWith("image/") ?? false },
            { file: newAddressProofUrlFront, oldUrl: employee.addressProofUrlFront, path: `employees/${employee.phoneNumber}/addressProofs/${Date.now()}_addr_front.${newAddressProofUrlFront?.name.split('.').pop()}`, key: 'addressProofUrlFront', isImage: newAddressProofUrlFront?.type.startsWith("image/") ?? false },
            { file: newAddressProofUrlBack, oldUrl: employee.addressProofUrlBack, path: `employees/${employee.phoneNumber}/addressProofs/${Date.now()}_addr_back.${newAddressProofUrlBack?.name.split('.').pop()}`, key: 'addressProofUrlBack', isImage: newAddressProofUrlBack?.type.startsWith("image/") ?? false },
            { file: newSignatureUrl, oldUrl: employee.signatureUrl, path: `employees/${employee.phoneNumber}/signatures/${Date.now()}_sig.jpg`, key: 'signatureUrl', isImage: true },
            { file: newBankPassbookStatement, oldUrl: employee.bankPassbookStatementUrl, path: `employees/${employee.phoneNumber}/bankDocuments/${Date.now()}_bank.${newBankPassbookStatement?.name.split('.').pop()}`, key: 'bankPassbookStatementUrl', isImage: newBankPassbookStatement?.type.startsWith("image/") ?? false },
            { file: newPoliceClearanceCertificate, oldUrl: employee.policeClearanceCertificateUrl, path: `employees/${employee.phoneNumber}/policeCertificates/${Date.now()}_pcc.${newPoliceClearanceCertificate?.name.split('.').pop()}`, key: 'policeClearanceCertificateUrl', isImage: newPoliceClearanceCertificate?.type.startsWith("image/") ?? false },
        ];

        for (const job of uploadJobs) {
            await uploadAndSetUrl(job.file, job.oldUrl, job.path, job.key as any, job.isImage);
        }

        const formPayload: Record<string, any> = {};
        const original = employee;

        (Object.keys(data) as Array<keyof EmployeeUpdateValues>).forEach(key => {
            const formValue = data[key];
            const originalValue = original[key as keyof Employee];
            if (key === 'dateOfBirth' || key === 'joiningDate' || key === 'exitDate') {
                const formDate = formValue as Date | null | undefined;
                const originalDate = originalValue?.toDate ? originalValue.toDate() : (originalValue ? new Date(originalValue) : null);
                if ((formDate instanceof Date ? formDate.getTime() : undefined) !== originalDate?.getTime()) {
                    formPayload[key] = formDate instanceof Date ? Timestamp.fromDate(formDate) : (key === 'exitDate' ? deleteField() : originalValue);
                }
            } else if (formValue !== originalValue) {
                formPayload[key] = formValue;
            }
        });

        if (data.status !== 'Exited' && employee.exitDate) formPayload.exitDate = deleteField();
        if (data.maritalStatus !== 'Married' && employee.spouseName) formPayload.spouseName = "";
        
        const fullName = `${data.firstName} ${data.lastName}`;
        formPayload.fullName = fullName.toUpperCase();
        
        if (data.educationalQualification !== "Any Other Qualification") {
            formPayload.otherQualification = "";
        }

        const finalPayload = { ...formPayload, ...updatedUrls };
        
        if (finalPayload.fullName || finalPayload.phoneNumber || finalPayload.employeeId || finalPayload.firstName || finalPayload.lastName) {
             const nameParts = (finalPayload.fullName || employee.fullName).toUpperCase().split(' ').filter(Boolean);
             finalPayload.searchableFields = Array.from(new Set([
                ...nameParts,
                (finalPayload.firstName || employee.firstName).toUpperCase(),
                (finalPayload.lastName || employee.lastName).toUpperCase(),
                (finalPayload.employeeId || employee.employeeId).toUpperCase(),
                finalPayload.phoneNumber || employee.phoneNumber
             ].filter(Boolean)));
        }

        // Update publicProfile object
        finalPayload.publicProfile = {
            fullName: finalPayload.fullName || employee.fullName,
            employeeId: employee.employeeId,
            clientName: finalPayload.clientName || employee.clientName,
            profilePictureUrl: finalPayload.profilePictureUrl || employee.profilePictureUrl,
            status: finalPayload.status || employee.status,
        };

        if (Object.keys(finalPayload).length > 0) {
            finalPayload.updatedAt = serverTimestamp();
            const employeeDocRef = doc(db, "employees", employee.id);
            await updateDoc(employeeDocRef, finalPayload);
            toast({ title: "Profile Updated", description: "Employee details have been saved." });
            await fetchEmployee();
            toggleEditMode();
        } else {
            toast({ title: "No Changes", description: "No changes were detected to save." });
            toggleEditMode();
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

  const handleRegenerateEmployeeId = async () => {
    if (!employee) return;
    setIsRegeneratingId(true);
    try {
        const newEmployeeId = generateEmployeeId(employee.clientName);
        const newQrCodeUrl = await generateQrCodeDataUrl(newEmployeeId, employee.fullName, employee.phoneNumber);

        const newSearchableFields = Array.from(new Set([
            ...employee.fullName.split(' ').filter(Boolean),
            employee.firstName,
            employee.lastName,
            newEmployeeId,
            employee.phoneNumber
        ].map(s => s.toUpperCase())));

        const updateData = {
            employeeId: newEmployeeId,
            qrCodeUrl: newQrCodeUrl,
            searchableFields: newSearchableFields,
            publicProfile: {
                fullName: employee.fullName,
                employeeId: newEmployeeId,
                clientName: employee.clientName,
                profilePictureUrl: employee.profilePictureUrl,
                status: employee.status,
            },
            updatedAt: serverTimestamp(),
        };

        const employeeDocRef = doc(db, "employees", employee.id);
        await updateDoc(employeeDocRef, updateData);
        
        toast({ title: "Employee ID Regenerated", description: `New ID: ${newEmployeeId}` });
        await fetchEmployee(); // Refresh data
    } catch (err: any) {
        toast({ variant: "destructive", title: "Regeneration Failed", description: err.message });
    } finally {
        setIsRegeneratingId(false);
    }
  };

  const handleRegenerateQrCode = async () => {
    if (!employee) return;
    setIsRegeneratingQr(true);
    try {
        const newQrCodeUrl = await generateQrCodeDataUrl(employee.employeeId, employee.fullName, employee.phoneNumber);
        const employeeDocRef = doc(db, "employees", employee.id);
        await updateDoc(employeeDocRef, {
            qrCodeUrl: newQrCodeUrl,
            updatedAt: serverTimestamp(),
        });
        toast({ title: "QR Code Regenerated", description: "The employee's QR code has been updated." });
        await fetchEmployee(); // Refresh data
    } catch (err: any) {
        toast({ variant: "destructive", title: "QR Regeneration Failed", description: err.message });
    } finally {
        setIsRegeneratingQr(false);
    }
  };

  const handleDownloadProfile = async () => {
    if (!employee) return;
    setIsDownloadingPdf(true);
    toast({ title: "Generating PDF...", description: "Please wait, this may take a moment." });
    const legacy = employee as any;

    try {
        const pdfDoc = await PDFDocument.create();
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        
        const cissLogoUrl = '/ciss-logo.png';
        const logoBytes = await fetch(cissLogoUrl).then(res => res.arrayBuffer());
        const logoImage = await pdfDoc.embedPng(logoBytes);
        
        // --- Page 1: Biodata ---
        const page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        const margin = 40;

        const drawText = (text: string, x: number, y: number, font: PDFFont, size: number, color = rgb(0, 0, 0)) => {
            page.drawText(text || 'N/A', { x, y, font, size, color });
        };
        
        // Header
        logoImage.scaleToFit(50, 50);
        page.drawImage(logoImage, { x: margin, y: height - margin - 50, width: 50, height: 50 });
        
        const safeFullNameHeader = toTitleCase(sanitizePdfString(employee.fullName));
        const safeEmpIdHeader = sanitizePdfString(`Employee ID: ${employee.employeeId}`);
        const safeClientHeader = sanitizePdfString(`Client: ${employee.clientName}`);
        page.drawText(safeFullNameHeader, { x: margin + 65, y: height - margin - 25, font: helveticaBoldFont, size: 22, color: rgb(0.05, 0.2, 0.45) });
        page.drawText(safeEmpIdHeader, { x: margin + 65, y: height - margin - 45, font: helveticaFont, size: 10, color: rgb(0.3, 0.3, 0.3) });
        page.drawText(safeClientHeader, { x: margin + 65, y: height - margin - 60, font: helveticaFont, size: 10, color: rgb(0.3, 0.3, 0.3) });
        
        const profilePicBytes = await fetchImageBytes(employee.profilePictureUrl);
        if (profilePicBytes) {
            let image;
            try {
                if (employee.profilePictureUrl?.toLowerCase().includes('.png') || (profilePicBytes[0] === 0x89 && profilePicBytes[1] === 0x50)) {
                    image = await pdfDoc.embedPng(profilePicBytes);
                } else {
                    image = await pdfDoc.embedJpg(profilePicBytes);
                }
                const imgDims = image.scaleToFit(80, 100);
                page.drawImage(image, { x: width - margin - imgDims.width, y: height - margin - 100, width: imgDims.width, height: imgDims.height });
                page.drawRectangle({x: width - margin - imgDims.width - 2, y: height - margin - 100 - 2, width: imgDims.width+4, height: imgDims.height+4, borderColor: rgb(0.9, 0.9, 0.9), borderWidth: 1});
            } catch (e) {
                console.error("Error embedding profile picture:", e);
            }
        }
        
        let y = height - margin - 120;
        page.drawLine({ start: { x: margin, y: y }, end: { x: width - margin, y: y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
        y -= 25;

        // Helper to draw a section with a title and grid items
        const drawSection = (title: string, items: {label: string, value: any}[], startY: number): number => {
            page.drawText(title, { x: margin, y: startY, font: helveticaBoldFont, size: 14, color: rgb(0.05, 0.2, 0.45) });
            startY -= 25;

            const col1X = margin;
            const col2X = margin + 280;
            
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const col = i % 2;
                const x = col === 0 ? col1X : col2X;
                
                 if (i > 0 && i % 2 === 0) {
                     startY -= 40;
                }
                
                drawText(item.label, x, startY, helveticaFont, 9, rgb(0.4, 0.4, 0.4));
                const safeValue = toTitleCase(sanitizePdfString(String(item.value)) || 'N/A');
                page.drawText(safeValue, { x, y: startY - 15, font: helveticaFont, size: 11 });
            }
            startY -= 40; 
            
            page.drawLine({ start: { x: margin, y: startY + 15 }, end: { x: width - margin, y: startY + 15 }, thickness: 0.2, color: rgb(0.85, 0.85, 0.85) });
            
            return startY;
        };

        const personalItems = [
            { label: 'Date of Birth', value: format(employee.dateOfBirth.toDate(), 'dd-MM-yyyy') },
            { label: 'Gender', value: sanitizePdfString(employee.gender) },
            { label: "Father's Name", value: sanitizePdfString(employee.fatherName) },
            { label: "Mother's Name", value: sanitizePdfString(employee.motherName) },
            { label: 'Marital Status', value: sanitizePdfString(employee.maritalStatus) },
            ...(employee.maritalStatus === 'Married' ? [{ label: "Spouse's Name", value: sanitizePdfString(employee.spouseName) }] : [{label: "Spouse's Name", value: 'N/A'}]),
            { label: "Educational Qualification", value: employee.educationalQualification === 'Any Other Qualification' ? sanitizePdfString(employee.otherQualification) : sanitizePdfString(employee.educationalQualification) },
        ];
        y = drawSection("Personal Information", personalItems, y);

        const contactItems = [
             { label: "Phone Number", value: sanitizePdfString(employee.phoneNumber) },
             { label: "Email Address", value: sanitizePdfString(employee.emailAddress) },
             { label: "District", value: sanitizePdfString(employee.district) },
        ];
        
        y = drawSection("Contact Information", contactItems, y);
        
        const addressY = y + 25;
        drawText("Full Address", margin, addressY, helveticaFont, 9, rgb(0.4, 0.4, 0.4));
        drawMultilineText({ page, text: toTitleCase(sanitizePdfString(employee.fullAddress)), x: margin, y: addressY - 15, maxWidth: width - margin * 2, font: helveticaFont, fontSize: 11 });
        // Estimate height, this is not perfect but better than nothing
        const addressLines = wrapTextToWidth(toTitleCase(sanitizePdfString(employee.fullAddress)), helveticaFont, 11, width-margin*2).length;
        y -= (addressLines * (11*1.2)) + 25;

        
        const employmentItems = [
            { label: "Joining Date", value: format(employee.joiningDate.toDate(), 'dd-MM-yyyy') },
            { label: "Status", value: sanitizePdfString(employee.status) },
            { label: "Resource ID (if any)", value: sanitizePdfString(employee.resourceIdNumber) },
            ...(employee.status === 'Exited' && employee.exitDate ? [{ label: "Exit Date", value: format(employee.exitDate.toDate(), 'dd-MM-yyyy') }] : [{ label: "Exit Date", value: "N/A" }]),
        ];
        y = drawSection("Employment Details", employmentItems, y);
        
        const statutoryItems = [
            { label: "PAN Number", value: sanitizePdfString(employee.panNumber) },
            { label: "EPF / UAN", value: sanitizePdfString(employee.epfUanNumber) },
            { label: "ESIC Number", value: sanitizePdfString(employee.esicNumber) },
            { label: "Bank Name", value: sanitizePdfString(employee.bankName) },
            { label: "Bank Account No.", value: sanitizePdfString(employee.bankAccountNumber) },
            { label: "Bank IFSC Code", value: sanitizePdfString(employee.ifscCode) },
            { label: "Identity Proof", value: sanitizePdfString(`${employee.identityProofType || legacy.idProofType} - ${employee.identityProofNumber || legacy.idProofNumber}`)},
            { label: "Address Proof", value: sanitizePdfString(`${employee.addressProofType} - ${employee.addressProofNumber}`)},
        ];
        y = drawSection("Bank & Statutory Details", statutoryItems, y);

        // --- Page 2: QR Code ---
        if (employee.qrCodeUrl) {
            try {
                const qrPage = pdfDoc.addPage();
                const pageW = qrPage.getWidth();
                const pageH = qrPage.getHeight();

                const qrDataUri = employee.qrCodeUrl;
                 if (qrDataUri.startsWith('data:image/png;base64,')) {
                    const qrPngBase64 = qrDataUri.substring('data:image/png;base64,'.length);
                    const qrPngBytes = Buffer.from(qrPngBase64, 'base64');
                    const qrImage = await pdfDoc.embedPng(qrPngBytes);
                    const qrDims = qrImage.scaleToFit(250, 250);

                    const title = "Employee QR Code for Attendance";
                    const titleWidth = helveticaBoldFont.widthOfTextAtSize(title, 16);
                     qrPage.drawText(title, {
                        x: (pageW - titleWidth) / 2,
                        y: pageH - margin - 50,
                        font: helveticaBoldFont,
                        size: 16,
                        color: rgb(0.05, 0.2, 0.45)
                    });
                    
                    const qrBoxY = pageH - margin - 80 - qrDims.height - 20;
                    qrPage.drawRectangle({
                        x: (pageW - qrDims.width) / 2 - 20,
                        y: qrBoxY,
                        width: qrDims.width + 40,
                        height: qrDims.height + 40,
                        borderColor: rgb(0.8, 0.8, 0.8),
                        borderWidth: 1,
                    });

                    qrPage.drawImage(qrImage, {
                        x: (pageW - qrDims.width) / 2,
                        y: qrBoxY + 20,
                        width: qrDims.width,
                        height: qrDims.height,
                    });
                    
                    let instructionsY = qrBoxY - 50;
                    
                    const howToUse = "How to Use:";
                    const howToUseWidth = helveticaBoldFont.widthOfTextAtSize(howToUse, 12);
                    qrPage.drawText(howToUse, {
                        x: (pageW - howToUseWidth) / 2,
                        y: instructionsY,
                        font: helveticaBoldFont,
                        size: 12
                    });
                    instructionsY -= 25;
                    
                    const instructions = [
                      "1. Open the attendance marking page on the official CISS Workforce app or portal.",
                      "2. Select the 'Scan QR & Verify' option.",
                      "3. Point your device camera at this QR code.",
                      "4. Follow on-screen instructions to complete check-in/out."
                    ];

                    for(const instruction of instructions) {
                        const safeInstruction = sanitizePdfString(instruction);
                        drawMultilineText({ page: qrPage, text: safeInstruction, font: helveticaFont, fontSize: 10, x: (pageW - helveticaFont.widthOfTextAtSize(safeInstruction, 10))/2, y: instructionsY, maxWidth: pageW - margin * 2 });
                        instructionsY -= (10 * 1.2 * 2);
                    }
                }
            } catch (qrError) {
                console.error("Could not embed QR code:", qrError);
            }
        }
        
        // --- Subsequent Pages: Documents ---
        const documents = [
            { url: employee.identityProofUrlFront || legacy.idProofDocumentUrlFront || legacy.idProofDocumentUrl, title: "Identity Proof (Front)"},
            { url: employee.identityProofUrlBack || legacy.idProofDocumentUrlBack, title: "Identity Proof (Back)"},
            { url: employee.addressProofUrlFront, title: "Address Proof (Front)" },
            { url: employee.addressProofUrlBack, title: "Address Proof (Back)"},
            { url: employee.bankPassbookStatementUrl, title: "Bank Document" },
            { url: employee.policeClearanceCertificateUrl, title: "Police Clearance Certificate" },
        ];

        for (const doc of documents) {
            if (!doc.url) continue;
            const imageBytes = await fetchImageBytes(doc.url);
            if (imageBytes) {
                const docPage = pdfDoc.addPage();
                let image;
                 try {
                    if (doc.url.toLowerCase().includes('.png') || (imageBytes[0] === 0x89 && imageBytes[1] === 0x50 && imageBytes[2] === 0x4E && imageBytes[3] === 0x47)) {
                        image = await pdfDoc.embedPng(imageBytes);
                    } else {
                        image = await pdfDoc.embedJpg(imageBytes);
                    }
                } catch (e) {
                     console.error(`Could not embed image for ${doc.url}:`, e); 
                     docPage.drawText(`Error embedding document: ${doc.title}`, { x: margin, y: docPage.getHeight() - margin, font: helveticaBoldFont, size: 14, color: rgb(1,0,0)});
                     continue;
                }
                
                docPage.drawText(doc.title, { x: margin, y: docPage.getHeight() - margin, font: helveticaBoldFont, size: 14});
                const { width: pageWidth, height: pageHeight } = docPage.getSize();
                const dims = image.scaleToFit(pageWidth - margin * 2, pageHeight - margin * 2 - 50);
                docPage.drawImage(image, {
                    x: (pageWidth - dims.width) / 2,
                    y: (pageHeight - dims.height - 50) / 2,
                    width: dims.width,
                    height: dims.height,
                });
            }
        }
        
        // --- Last Page: Terms and Conditions ---
        const tcPage = pdfDoc.addPage();
        const tcWidth = tcPage.getWidth();
        let tcY = tcPage.getHeight() - margin;
        
        const tcTitle = "Terms & Conditions";
        tcPage.drawText(tcTitle, { x: (tcWidth - helveticaBoldFont.widthOfTextAtSize(tcTitle, 16))/2, y: tcY, font: helveticaBoldFont, size: 16, color: rgb(0.05, 0.2, 0.45) });
        tcY -= 40;

        // Copy text exactly as shown on the enrollment form
        const tcContent = [
            { title: "I. General Eligibility and Compliance", 
              points: [
                "I confirm I meet the eligibility criteria under the PSARA Act, 2005 and Kerala state rules, including age (18-65), physical fitness, and Indian citizenship.",
                "I understand my enrollment is provisional and subject to a successful background and character verification by the relevant authorities.",
                "I agree to complete all mandatory training and refresher courses as required by the company and regulatory bodies."
              ]},
            { title: "II. Employment Terms & Responsibilities",
              points: [
                "My employment terms, including working hours, wages, and leaves, will be governed by applicable labour laws.",
                "I will perform my duties diligently, maintain strict discipline, protect client property, and follow all lawful instructions.",
                "I will maintain strict confidentiality of all client and company information and will not disclose it to any unauthorized person.",
                "I will report for duty on time, in uniform, and will not consume intoxicating substances on duty, use unauthorized force, or abandon my post without proper relief."
              ]},
            { title: "III. Disciplinary Action",
              points: [
                "I understand that any breach of these terms, misconduct, or violation of laws can lead to disciplinary action, up to and including termination of employment."
              ]},
            { title: "IV. Declaration",
              points: [
                "I hereby declare that I have read, understood, and agree to abide by all the terms and conditions stated above for my enrollment. I confirm that all information and documents provided by me are true and correct to the best of my knowledge."
              ]}
        ];

        const bulletX = margin + 15;
        const contentMaxWidth = tcWidth - (margin * 2) - 15;
        for(const section of tcContent) {
            tcPage.drawText(section.title, { x: margin, y: tcY, font: helveticaBoldFont, size: 12, color: rgb(0.05, 0.2, 0.45) });
            tcY -= 20;
            for(const point of section.points) {
                const safePoint = sanitizePdfString(`• ${point}`);
                drawMultilineText({ page: tcPage, text: safePoint, font: helveticaFont, fontSize: 10.5, x: bulletX, y: tcY, maxWidth: contentMaxWidth, lineHeight: 13 });
                const lines = wrapTextToWidth(safePoint, helveticaFont, 10.5, contentMaxWidth);
                tcY -= lines.length * 13;
                tcY -= 4; // small gap between bullets
            }
            tcY -= 10; // gap between sections
        }

        // Add Signature (place it a little below after all paragraphs with ~2 line spacing)
        const signatureBytes = await fetchImageBytes(employee.signatureUrl);
        if (signatureBytes) {
            let signatureImage;
            try {
                 if (employee.signatureUrl?.toLowerCase().includes('.png') || (signatureBytes[0] === 0x89 && signatureBytes[1] === 0x50)) {
                    signatureImage = await pdfDoc.embedPng(signatureBytes);
                } else {
                    signatureImage = await pdfDoc.embedJpg(signatureBytes);
                }
                const sigDims = signatureImage.scaleToFit(120, 50);
                // Anchor signature area to bottom-right with safe padding (prevents overlap)
                const signatureY = margin + 40;
                tcPage.drawImage(signatureImage, {
                    x: tcWidth - margin - sigDims.width,
                    y: signatureY,
                    width: sigDims.width,
                    height: sigDims.height,
                });
                 tcPage.drawLine({ start: { x: tcWidth - margin - 130, y: signatureY - 5 }, end: { x: tcWidth - margin, y: signatureY - 5 }, thickness: 0.5 });
                 tcPage.drawText("Signature of Applicant", { x: tcWidth - margin - 125, y: signatureY - 18, font: helveticaFont, size: 8, color: rgb(0.4, 0.4, 0.4) });

            } catch (sigError) {
                 console.error("Could not embed signature", sigError);
            }
        }


        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        const formattedJoiningDate = format((employee.joiningDate as any).toDate ? (employee.joiningDate as any).toDate() : new Date(employee.joiningDate as any), 'yyyy-MM-dd');
        const cleanFullName = employee.fullName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
        const cleanClientName = employee.clientName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
        const fileName = `ProfileKit_${cleanFullName}_${cleanClientName}_${formattedJoiningDate}.pdf`;
        a.download = fileName;

        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        toast({ title: "Download Started", description: "Your PDF profile kit is downloading." });
    } catch (error: any) {
        console.error("Error during PDF generation:", error);
        toast({
            variant: "destructive",
            title: "PDF Generation Failed",
            description: `Could not generate the profile kit. ${error.message || 'An unknown error occurred.'}`,
            duration: 7000
        });
    } finally {
        setIsDownloadingPdf(false);
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
            <Button onClick={() => router.push(`/employees?${searchParams.toString()}`)} className="mt-4">
              <ArrowLeft className="mr-2 h-4 w-4" />Back to Directory
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
                <Button onClick={() => router.push(`/employees?${searchParams.toString()}`)} className="mt-4">
                   <ArrowLeft className="mr-2 h-4 w-4" />Back to Directory
                </Button>
            </AlertDescription>
        </Alert>
    );
  }

  const fromYear = new Date().getFullYear() - 65;
  const toYear = new Date().getFullYear() - 18;
  const defaultCalendarMonth = new Date(employee.dateOfBirth?.toDate ? employee.dateOfBirth.toDate() : employee.dateOfBirth);
  if (isNaN(defaultCalendarMonth.getTime())) {
      const fallbackDate = new Date();
      fallbackDate.setFullYear(toYear - 10);
      defaultCalendarMonth.setTime(fallbackDate.getTime());
  }

  const toggleEditMode = () => {
    setIsEditing(!isEditing);
    // Add logic to toggle query parameter
    const newSearchParams = new URLSearchParams(searchParams.toString());
    if (!isEditing) {
        newSearchParams.set('edit', 'true');
    } else {
        newSearchParams.delete('edit');
    }
    router.push(`${window.location.pathname}?${newSearchParams.toString()}`);
  };

  const handleRemoveFile = async (
    fileKey: keyof Employee,
    setFile: (file: File | null) => void,
    setPreview: (preview: string | null) => void
  ) => {
    if (!employee) return;
    const urlToRemove = employee[fileKey] as string | undefined;

    // Resetting the UI state immediately for better UX
    setFile(null);
    setPreview(null);
    
    // Create a payload to nullify the field in Firestore
    const updatePayload = {
      [fileKey]: deleteField(),
      updatedAt: serverTimestamp(),
    };
    
    try {
        const employeeDocRef = doc(db, "employees", employee.id);
        await updateDoc(employeeDocRef, updatePayload);
        
        // Also remove the old file from storage
        if (urlToRemove) {
            await deleteFileFromStorage(urlToRemove);
        }

        toast({ title: "File Removed", description: `The file for ${fileKey} has been marked for removal. It will be deleted upon saving changes.` });
        
        // Refetch employee data to update the UI correctly
        await fetchEmployee();

    } catch (err: any) {
        console.error("Error removing file:", err);
        toast({ variant: 'destructive', title: 'Removal Failed', description: 'Could not remove the file.' });
    }
  };

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="mb-4">
          <Button variant="outline" size="sm" onClick={() => router.push(`/employees?${searchParams.toString()}`)}>
              <ArrowLeft className="mr-2 h-4 w-4" />Back to Employee Directory
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-24 w-24 border-4 border-primary shadow-md">
              <AvatarImage src={employee.profilePictureUrl} alt={employee.fullName || 'Employee profile picture'} />
              <AvatarFallback className="text-3xl">
                {employee.fullName?.split(' ').map(n => n[0]).join('') || 'U'}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{toTitleCase(employee.fullName)}</h1>
              <p className="text-muted-foreground">{employee.employeeId} - {employee.clientName || "N/A"}</p>
              <Badge variant={getStatusBadgeVariant(employee.status)} className="mt-1">{employee.status}</Badge>
            </div>
          </div>
          {isAdminView && (
            <div className="flex gap-2 mt-4 sm:mt-0 w-full sm:w-auto">
              <Button onClick={handleDownloadProfile} variant="outline" className="flex-1 sm:flex-none" disabled={isDownloadingPdf}>
                  {isDownloadingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Download Profile Kit
              </Button>
              <Button onClick={() => toggleEditMode()} className="flex-1 sm:flex-none">
                  <Edit3 className="mr-2 h-4 w-4" /> {isEditing ? "Cancel" : "Edit Profile"}
              </Button>
            </div>
          )}
        </div>

        {!isEditing && (
          <Tabs defaultValue="personal" className="w-full">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 gap-2 h-auto">
              <TabsTrigger value="personal" className="py-2"><User className="mr-2 h-4 w-4 md:inline-block" />Personal</TabsTrigger>
              <TabsTrigger value="employment" className="py-2"><Briefcase className="mr-2 h-4 w-4 md:inline-block" />Employment</TabsTrigger>
              <TabsTrigger value="bank" className="py-2"><Banknote className="mr-2 h-4 w-4 md:inline-block" />Bank</TabsTrigger>
              <TabsTrigger value="identification" className="py-2"><ShieldCheck className="mr-2 h-4 w-4 md:inline-block" />Identification</TabsTrigger>
              <TabsTrigger value="qr" className="py-2"><QrCode className="mr-2 h-4 w-4 md:inline-block" />QR & Docs</TabsTrigger>
            </TabsList>
            <Card className="mt-4">
              <CardContent className="pt-6">
                <TabsContent value="personal">
                  <CardTitle className="mb-4">Personal Information</CardTitle>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    <DetailItem label="First Name" value={employee.firstName} isName />
                    <DetailItem label="Last Name" value={employee.lastName} isName />
                    <DetailItem label="Date of Birth" value={employee.dateOfBirth} isDate />
                    <DetailItem label="Gender" value={employee.gender} />
                    <DetailItem label="Father's Name" value={employee.fatherName} isName />
                    <DetailItem label="Mother's Name" value={employee.motherName} isName />
                    <DetailItem label="Marital Status" value={employee.maritalStatus} />
                    {employee.maritalStatus === "Married" && <DetailItem label="Spouse Name" value={employee.spouseName} isName />}
                    <DetailItem label="Educational Qualification" value={employee.educationalQualification === 'Any Other Qualification' ? employee.otherQualification : employee.educationalQualification} />
                    <DetailItem label="District" value={employee.district} isName />
                  </div>
                  <Separator className="my-6" />
                  <CardTitle className="text-lg mb-2">Contact Details</CardTitle>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    <DetailItem label="Phone Number" value={employee.phoneNumber} />
                    <DetailItem label="Email Address" value={employee.emailAddress} />
                     <div className="md:col-span-2">
                        <DetailItem label="Full Address" value={employee.fullAddress.replace(/\n/g, ", ")} isAddress />
                     </div>
                  </div>
                </TabsContent>
                <TabsContent value="employment">
                  <CardTitle className="mb-4">Employment Details</CardTitle>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    <div className="flex flex-col sm:grid sm:grid-cols-3 gap-1 sm:gap-2 py-1.5 items-start sm:items-center">
                        <span className="text-sm text-muted-foreground sm:col-span-1">Employee ID</span>
                        <span className="text-sm font-medium sm:col-span-2 flex items-center gap-2">
                            {employee.employeeId}
                            {isAdminView && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isRegeneratingId} title="Regenerate Employee ID">
                                            {isRegeneratingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Confirm Employee ID Regeneration</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will generate a new employee ID and a new QR code. This action cannot be undone. Are you sure?
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={handleRegenerateEmployeeId}>Confirm</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                        </span>
                    </div>
                    <DetailItem label="Client Name" value={employee.clientName} isName />
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
                    <DetailItem label="Bank Name" value={employee.bankName} isName />
                    <DetailItem label="Account Number" value={employee.bankAccountNumber} />
                    <DetailItem label="IFSC Code" value={employee.ifscCode} />
                  </div>
                </TabsContent>
                <TabsContent value="identification">
                  <CardTitle className="mb-4">Identification Details</CardTitle>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    <DetailItem label="PAN Number" value={employee.panNumber} />
                    <DetailItem label="Identity Proof" value={`${employee.identityProofType || (employee as any).idProofType || 'N/A'} - ${employee.identityProofNumber || (employee as any).idProofNumber || 'N/A'}`} />
                    <DetailItem label="Address Proof" value={`${employee.addressProofType || 'N/A'} - ${employee.addressProofNumber || 'N/A'}`} />
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
                             {isAdminView && (
                                <Button onClick={handleRegenerateQrCode} variant="outline" size="sm" className="mt-4" disabled={isRegeneratingQr}>
                                    {isRegeneratingQr ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <RefreshCw className="mr-2 h-4 w-4"/>}
                                    Regenerate QR Code
                                </Button>
                            )}
                        </div>
                    </div>
                    <div>
                        <CardTitle className="mb-4">Uploaded Documents</CardTitle>
                        <div className="space-y-3">
                            <DocumentItem name="Profile Picture" url={employee.profilePictureUrl} type="Employee Photo" />
                            <DocumentItem name="Signature" url={employee.signatureUrl} type="Employee Signature" />
                            <DocumentItem name="Identity Proof (Front)" url={employee.identityProofUrlFront || (employee as any).idProofDocumentUrlFront || (employee as any).idProofDocumentUrl} type={employee.identityProofType || (employee as any).idProofType} />
                            <DocumentItem name="Identity Proof (Back)" url={employee.identityProofUrlBack || (employee as any).idProofDocumentUrlBack} type={employee.identityProofType || (employee as any).idProofType} />
                            <DocumentItem name="Address Proof (Front)" url={employee.addressProofUrlFront} type={employee.addressProofType} />
                            <DocumentItem name="Address Proof (Back)" url={employee.addressProofUrlBack} type={employee.addressProofType} />
                            <DocumentItem name="Bank Passbook/Statement" url={employee.bankPassbookStatementUrl} type="Bank Document" />
                            <DocumentItem name="Police Clearance Certificate" url={employee.policeClearanceCertificateUrl} type="Police Verification" />
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
                    <h3 className="text-lg font-semibold mb-4 border-b pb-2">Personal &amp; Contact</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField control={form.control} name="firstName" render={({ field }) => (<FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="lastName" render={({ field }) => (<FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="fatherName" render={({ field }) => (<FormItem><FormLabel>Father's Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="motherName" render={({ field }) => (<FormItem><FormLabel>Mother's Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="dateOfBirth" render={({ field }) => (
                        <FormItem className="flex flex-col">
                            <FormLabel>Date of Birth</FormLabel>
                            <Popover open={isDobPopoverOpen} onOpenChange={setIsDobPopoverOpen}>
                                <PopoverTrigger asChild>
                                    <FormControl>
                                        <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}>
                                            {field.value ? format(field.value, "dd-MM-yyyy") : <span>Pick a date</span>}
                                            <CalendarIcon className="ml-auto h-4 w-4" />
                                        </Button>
                                    </FormControl>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
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
                            <FormDescription>Age must be between 18 and 65.</FormDescription>
                            <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="gender" render={({ field }) => (<FormItem><FormLabel>Gender</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{genderOptions.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="maritalStatus" render={({ field }) => (<FormItem><FormLabel>Marital Status</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{maritalStatuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                      {watchMaritalStatus === 'Married' && <FormField control={form.control} name="spouseName" render={({ field }) => (<FormItem><FormLabel>Spouse Name</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />}
                       <FormField
                        control={form.control}
                        name="educationalQualification"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Educational Qualification</FormLabel>
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
                              <FormLabel>Please Specify Qualification</FormLabel>
                              <FormControl><Input placeholder="e.g., B.Tech in Computer Science" {...field} value={field.value ?? ''} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
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
                      <FormItem><FormLabel>Employee ID</FormLabel><FormControl><Input value={employee.employeeId} disabled /></FormControl><FormDescription>Employee ID cannot be changed here. Regenerate it from the view mode.</FormDescription></FormItem>
                      <FormField control={form.control} name="clientName" render={({ field }) => (<FormItem><FormLabel>Client Name</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoadingClients}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{availableClients.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="resourceIdNumber" render={({ field }) => (<FormItem><FormLabel>Resource ID</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="joiningDate" render={({ field }) => (
                          <FormItem className="flex flex-col">
                              <FormLabel>Joining Date</FormLabel>
                              <Popover open={isJoiningDatePopoverOpen} onOpenChange={setIsJoiningDatePopoverOpen}>
                                  <PopoverTrigger asChild>
                                      <FormControl>
                                          <Button variant="outline" className={cn("w-full justify-start", !field.value && "text-muted-foreground")}>
                                              {field.value ? format(field.value, "dd-MM-yyyy") : <span>Pick a date</span>}
                                              <CalendarIcon className="ml-auto h-4 w-4" />
                                          </Button>
                                      </FormControl>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0">
                                      <Calendar 
                                          mode="single" 
                                          selected={field.value} 
                                          onSelect={(date) => {
                                              field.onChange(date);
                                              setIsJoiningDatePopoverOpen(false);
                                          }} 
                                          initialFocus 
                                          disabled={(d) => d > new Date()}
                                      />
                                  </PopoverContent>
                              </Popover>
                              <FormMessage />
                          </FormItem>
                      )} />
                      <FormField control={form.control} name="status" render={({ field }) => (<FormItem><FormLabel>Status</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{employeeStatuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                      {watchStatus === 'Exited' && <FormField control={form.control} name="exitDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>Exit Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant="outline" className={cn("w-full justify-start", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "dd-MM-yyyy") : <span>Pick exit date</span>}<CalendarIcon className="ml-auto h-4 w-4" /></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value ?? undefined} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage /></FormItem>)} />}
                    </div>
                  </section>
                  {/* Bank &amp; ID Section */}
                  <section>
                    <h3 className="text-lg font-semibold mb-4 border-b pb-2">Bank &amp; Statutory Details</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField control={form.control} name="bankName" render={({ field }) => (<FormItem><FormLabel>Bank Name</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="bankAccountNumber" render={({ field }) => (<FormItem><FormLabel>Account Number</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="ifscCode" render={({ field }) => (<FormItem><FormLabel>IFSC Code</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="panNumber" render={({ field }) => (<FormItem><FormLabel>PAN Number</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="epfUanNumber" render={({ field }) => (<FormItem><FormLabel>EPF UAN Number</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                      <FormField control={form.control} name="esicNumber" render={({ field }) => (<FormItem><FormLabel>ESIC Number</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                    </div>
                  </section>
                  
                  {/* Identification Documents Section */}
                  <section>
                    <h3 className="text-lg font-semibold mb-4 border-b pb-2">Identification Documents</h3>
                    <div className="p-4 border rounded-lg mt-4 space-y-4">
                        <h4 className="font-medium text-md">Identity Proof (Name, DOB, etc.)</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <FormField control={form.control} name="identityProofType" render={({ field }) => ( <FormItem><FormLabel>Document Type</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{idProofOptions.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                            <FormField control={form.control} name="identityProofNumber" render={({ field }) => (<FormItem><FormLabel>Document Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                           <ImageInputWithPreview label="Front Page" currentUrl={employee.identityProofUrlFront || (employee as any).idProofDocumentUrlFront || (employee as any).idProofDocumentUrl} preview={identityProofUrlFrontPreview} setFile={setNewIdentityProofUrlFront} setPreview={setIdentityProofUrlFrontPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('identityProofUrlFront')} onRemove={() => handleRemoveFile('identityProofUrlFront', setNewIdentityProofUrlFront, setIdentityProofUrlFrontPreview)} canRemove={isAdminView}/>
                           <ImageInputWithPreview label="Back Page" currentUrl={employee.identityProofUrlBack || (employee as any).idProofDocumentUrlBack} preview={identityProofUrlBackPreview} setFile={setNewIdentityProofUrlBack} setPreview={setIdentityProofUrlBackPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('identityProofUrlBack')} onRemove={() => handleRemoveFile('identityProofUrlBack', setNewIdentityProofUrlBack, setIdentityProofUrlBackPreview)} canRemove={isAdminView}/>
                        </div>
                    </div>

                    <div className="p-4 border rounded-lg mt-6 space-y-4">
                        <h4 className="font-medium text-md">Address Proof</h4>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <FormField control={form.control} name="addressProofType" render={({ field }) => ( <FormItem><FormLabel>Document Type</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{idProofOptions.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                            <FormField control={form.control} name="addressProofNumber" render={({ field }) => (<FormItem><FormLabel>Document Number</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                           <ImageInputWithPreview label="Front Page" currentUrl={employee.addressProofUrlFront} preview={addressProofUrlFrontPreview} setFile={setNewAddressProofUrlFront} setPreview={setAddressProofUrlFrontPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('addressProofUrlFront')} onRemove={() => handleRemoveFile('addressProofUrlFront', setNewAddressProofUrlFront, setAddressProofUrlFrontPreview)} canRemove={isAdminView}/>
                           <ImageInputWithPreview label="Back Page" currentUrl={employee.addressProofUrlBack} preview={addressProofUrlBackPreview} setFile={setNewAddressProofUrlBack} setPreview={setAddressProofUrlBackPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('addressProofUrlBack')} onRemove={() => handleRemoveFile('addressProofUrlBack', setNewAddressProofUrlBack, setAddressProofUrlBackPreview)} canRemove={isAdminView}/>
                        </div>
                    </div>
                  </section>

                  {/* Other Documents Section */}
                  <section>
                      <h3 className="text-lg font-semibold mb-4 border-b pb-2">Other Documents &amp; Signature</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <ImageInputWithPreview label="Profile Picture" currentUrl={employee.profilePictureUrl} preview={profilePicPreview} setFile={setNewProfilePicture} setPreview={setProfilePicPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('profilePicture')} isProfilePic={true} onRemove={() => handleRemoveFile('profilePictureUrl', setNewProfilePicture, setProfilePicPreview)} canRemove={isAdminView}/>
                          <ImageInputWithPreview label="Signature" currentUrl={employee.signatureUrl} preview={signatureUrlPreview} setFile={setNewSignatureUrl} setPreview={setSignatureUrlPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('signatureUrl')} isSignature={true} onRemove={() => handleRemoveFile('signatureUrl', setNewSignatureUrl, setSignatureUrlPreview)} canRemove={isAdminView}/>
                          <ImageInputWithPreview label="Bank Document" currentUrl={employee.bankPassbookStatementUrl} preview={bankPassbookPreview} setFile={setNewBankPassbookStatement} setPreview={setBankPassbookPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('bankPassbookStatement')} onRemove={() => handleRemoveFile('bankPassbookStatementUrl', setNewBankPassbookStatement, setBankPassbookPreview)} canRemove={isAdminView}/>
                          <ImageInputWithPreview label="Police Clearance Certificate" currentUrl={employee.policeClearanceCertificateUrl} preview={policeCertificatePreview} setFile={setNewPoliceClearanceCertificate} setPreview={setPoliceCertificatePreview} handleFileChange={handleFileChange} openCamera={() => openCamera('policeClearanceCertificate')} onRemove={() => handleRemoveFile('policeClearanceCertificateUrl', setNewPoliceClearanceCertificate, setPoliceCertificatePreview)} canRemove={isAdminView}/>
                      </div>
                  </section>
                </CardContent>
                <CardFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => toggleEditMode()} disabled={isSubmitting}>Cancel</Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </Form>
        )}
      </div>
    </>
  );
}

const ImageInputWithPreview: React.FC<{
    label: string;
    currentUrl?: string;
    preview: string | null;
    setFile: (file: File | null) => void;
    setPreview: (preview: string | null) => void;
    handleFileChange: (event: React.ChangeEvent<HTMLInputElement>, setFile: any, setPreview: any) => void;
    openCamera: () => void;
    onRemove: () => void;
    isProfilePic?: boolean;
    isSignature?: boolean;
    canRemove?: boolean;
}> = ({ label, currentUrl, preview, setFile, setPreview, handleFileChange, openCamera, onRemove, isProfilePic, isSignature, canRemove = false }) => {
    const uniqueId = React.useId();
    const finalPreview = preview || (currentUrl?.includes('.pdf') ? '/pdf-icon.png' : currentUrl);
    const hasImage = !!finalPreview;

    return (
        <div className="space-y-2">
            <Label className="text-base">{label}<span className="text-destructive">*</span></Label>
            <div className="p-4 border rounded-md text-center space-y-2 relative">
                {hasImage ? (
                     <Image
                        src={finalPreview}
                        alt={label}
                        width={isProfilePic || isSignature ? 128 : 200}
                        height={isProfilePic ? 128 : isSignature ? 64 : 120}
                        className={cn(
                            "object-contain justify-self-center mx-auto",
                            isProfilePic ? 'rounded-full h-32 w-32' : 'h-32 w-full',
                            isSignature && 'h-20'
                        )}
                        data-ai-hint={isProfilePic ? "profile picture" : isSignature ? "signature" : "id card"}
                    />
                ) : (
                    <div className="flex items-center justify-center h-32 w-full bg-muted border rounded-md mb-2"><FileUp className="h-12 w-12 text-muted-foreground"/></div>
                )}
               
                <div className="flex justify-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById(uniqueId)?.click()}><Upload className="mr-2 h-4 w-4" /> Upload</Button>
                    <Button type="button" size="sm" variant="outline" onClick={openCamera}><Camera className="mr-2 h-4 w-4" /> Camera</Button>
                    {hasImage && canRemove && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button type="button" size="sm" variant="destructive" title={`Remove ${label}`}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Confirm Removal</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Are you sure you want to remove the current {label.toLowerCase()}? This will permanently delete the existing file if you save your changes.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={onRemove}>Confirm &amp; Remove</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                    <Input id={uniqueId} type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => handleFileChange(e, setFile, setPreview)} />
                </div>
            </div>
        </div>
    );
};



    

    

    
