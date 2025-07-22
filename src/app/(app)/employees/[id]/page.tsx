
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
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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


// Dropdown options
const keralaDistricts = ["Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod"];
const idProofTypes = ["Aadhar Card", "Voter ID", "Driving License", "Passport"];
const maritalStatuses = ["Married", "Unmarried"];
const genderOptions = ["Male", "Female", "Other"];
const employeeStatuses = ['Active', 'Inactive', 'OnLeave', 'Exited'];
interface ClientOption { id: string; name: string; }
type CameraField = "profilePicture" | "idProofDocumentFront" | "idProofDocumentBack" | "bankPassbookStatement" | "policeClearanceCertificate";

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
      displayValue = format(value.toDate(), "PPP");
    } else if (isDate && (value instanceof Date || typeof value === 'string')) {
       try {
        displayValue = format(new Date(value), "PPP");
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

// #region PDF Generation Components

const pageStyle: React.CSSProperties = {
  width: '210mm',
  minHeight: '297mm',
  padding: '15mm',
  backgroundColor: 'white',
  color: 'black',
  fontFamily: 'Arial, sans-serif',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  boxSizing: 'border-box'
};

const PageFooter = ({ pageNumber }: { pageNumber: number }) => (
  <footer style={{
    position: 'absolute',
    bottom: '10mm',
    left: '15mm',
    right: '15mm',
    textAlign: 'center',
    fontSize: '9px',
    color: '#666',
    borderTop: '1px solid #ccc',
    paddingTop: '5px'
  }}>
    Page {pageNumber} | CISS Services Ltd. | Generated on: {format(new Date(), "PPP")}
  </footer>
);


const DetailGridItem = ({ label, value }: { label: string; value?: string | number | null }) => (
  <div>
    <p className="text-xs text-gray-500">{label}</p>
    <p className="font-medium text-gray-800">{value || 'N/A'}</p>
  </div>
);

const formatDate = (date: any) => {
  if (!date) return 'N/A';
  const dateObj = date.toDate ? date.toDate() : new Date(date);
  return format(dateObj, "PPP");
};

const BiodataPage = React.forwardRef<HTMLDivElement, { employee: Employee; pageNumber: number }>(({ employee, pageNumber }, ref) => (
  <div ref={ref} style={pageStyle}>
    <header className="flex justify-between items-start pb-4 border-b border-gray-300">
      <div className="flex items-center gap-4">
        <Image src="/ciss-logo.png" alt="CISS Logo" width={60} height={60} unoptimized={true} data-ai-hint="company logo"/>
        <div>
          <h1 className="text-3xl font-bold text-blue-800 tracking-tight">{toTitleCase(employee.fullName)}</h1>
          <p className="text-gray-600">Employee ID: {employee.employeeId}</p>
          <p className="text-gray-600">Client: {employee.clientName}</p>
        </div>
      </div>
      {employee.profilePictureUrl && (
        <Image 
            src={employee.profilePictureUrl} 
            alt={employee.fullName || 'Profile photo'} 
            width={100} 
            height={120} 
            className="rounded-lg border-2 border-gray-200 object-contain p-1 bg-gray-50" 
            crossOrigin="anonymous" 
            unoptimized={true}
            data-ai-hint="profile photo" 
        />
      )}
    </header>

    <main className="flex-grow mt-8 space-y-8 text-sm">
      <section>
        <h2 className="text-lg font-semibold text-blue-700 border-b pb-2 mb-4">Personal & Contact Information</h2>
        <div className="grid grid-cols-3 gap-x-6 gap-y-4">
          <DetailGridItem label="Date of Birth" value={formatDate(employee.dateOfBirth)} />
          <DetailGridItem label="Gender" value={employee.gender} />
          <DetailGridItem label="Marital Status" value={employee.maritalStatus} />
          <DetailGridItem label="Father's Name" value={toTitleCase(employee.fatherName)} />
          <DetailGridItem label="Mother's Name" value={toTitleCase(employee.motherName)} />
          {employee.maritalStatus === 'Married' && <DetailGridItem label="Spouse's Name" value={toTitleCase(employee.spouseName)} />}
          <DetailGridItem label="Phone Number" value={employee.phoneNumber} />
          <DetailGridItem label="Email Address" value={employee.emailAddress.toLowerCase()} />
          <DetailGridItem label="District" value={toTitleCase(employee.district)} />
          <div className="col-span-3">
            <DetailGridItem label="Full Address" value={toTitleCase(employee.fullAddress)} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-blue-700 border-b pb-2 mb-4">Employment & Statutory Details</h2>
        <div className="grid grid-cols-3 gap-x-6 gap-y-4">
          <DetailGridItem label="Joining Date" value={formatDate(employee.joiningDate)} />
          <DetailGridItem label="Status" value={employee.status} />
          {employee.resourceIdNumber && <DetailGridItem label="Resource ID" value={employee.resourceIdNumber} />}
          <DetailGridItem label="PAN Number" value={employee.panNumber} />
          <DetailGridItem label="EPF/UAN Number" value={employee.epfUanNumber} />
          <DetailGridItem label="ESIC Number" value={employee.esicNumber} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-blue-700 border-b pb-2 mb-4">Bank & Identification Details</h2>
        <div className="grid grid-cols-3 gap-x-6 gap-y-4">
          <DetailGridItem label="Bank Name" value={toTitleCase(employee.bankName)} />
          <DetailGridItem label="Account Number" value={employee.bankAccountNumber} />
          <DetailGridItem label="IFSC Code" value={employee.ifscCode} />
          <DetailGridItem label="ID Proof Type" value={employee.idProofType} />
          <DetailGridItem label="ID Proof Number" value={employee.idProofNumber} />
        </div>
      </section>
    </main>
    <PageFooter pageNumber={pageNumber} />
  </div>
));
BiodataPage.displayName = 'BiodataPage';


const QrPage = React.forwardRef<HTMLDivElement, { employee: Employee; pageNumber: number }>(({ employee, pageNumber }, ref) => (
  <div ref={ref} style={{...pageStyle, justifyContent: 'center', alignItems: 'center', textAlign: 'center'}}>
    <h1 className="text-2xl font-bold mb-4">Employee QR Code</h1>
    <p className="mb-2 text-lg">{toTitleCase(employee.fullName)}</p>
    <p className="mb-8 text-gray-600">{employee.employeeId}</p>
    <div className="p-4 bg-white border-4 border-gray-200 rounded-lg">
      <Image src={employee.qrCodeUrl!} alt="Employee QR Code" width={300} height={300} unoptimized={true} data-ai-hint="qr code" />
    </div>
    <div className="mt-8 text-gray-600 max-w-md">
      <p className="font-semibold mb-2">Instructions:</p>
      <p>This QR code is for marking your attendance. Please present this code for scanning when marking IN and OUT. Keep this document safe.</p>
    </div>
    <PageFooter pageNumber={pageNumber} />
  </div>
));
QrPage.displayName = 'QrPage';

const TermsPage = React.forwardRef<HTMLDivElement, { employee: Employee; pageNumber: number }>(({ employee, pageNumber }, ref) => {
  const companyName = "CISS Services Ltd.";
  return (
    <div ref={ref} style={pageStyle}>
      <h1 className="text-xl font-bold text-center mb-6">Terms and Conditions of Enrollment</h1>
      <div className="space-y-3 text-xs text-justify flex-grow">
        <section>
          <h2 className="text-sm font-bold mb-1">I. General Eligibility and Compliance</h2>
          <ul className="list-disc list-outside space-y-1 pl-4">
            <li>I confirm I meet the eligibility criteria under the PSARA Act, 2005 and Kerala state rules, including age (18-65), physical fitness, and Indian citizenship.</li>
            <li>I understand my enrollment is provisional and subject to a successful background and character verification by the relevant authorities.</li>
            <li>I agree to complete all mandatory training and refresher courses as required by the company and regulatory bodies.</li>
          </ul>
        </section>
        <section>
          <h2 className="text-sm font-bold mb-1">II. Employment Terms & Responsibilities</h2>
          <ul className="list-disc list-outside space-y-1 pl-4">
            <li>My employment terms, including working hours, wages, and leaves, will be governed by applicable labour laws.</li>
            <li>I will perform my duties diligently, maintain strict discipline, protect client property, and follow all lawful instructions.</li>
            <li>I will maintain strict confidentiality of all client and company information and will not disclose it to any unauthorized person.</li>
            <li>I will report for duty on time, in uniform, and will not consume intoxicating substances on duty, use unauthorized force, or abandon my post without proper relief.</li>
          </ul>
        </section>
        <section>
          <h2 className="text-sm font-bold mb-1">III. Disciplinary Action</h2>
          <ul className="list-disc list-outside space-y-1 pl-4">
            <li>I understand that any breach of these terms, misconduct, or violation of laws can lead to disciplinary action, up to and including termination of employment.</li>
          </ul>
        </section>
      </div>
      <section className="mt-8 pt-6 border-t-2 border-dashed border-gray-400">
        <h2 className="text-base font-bold text-center mb-4">IV. Declaration</h2>
        <p className="text-sm mb-6 text-justify">
          I, <strong>{toTitleCase(employee.fullName)}</strong>, son/daughter of <strong>{toTitleCase(employee.fatherName)}</strong>, residing at {toTitleCase(employee.fullAddress)}, hereby declare that I have read, understood, and agree to abide by all the terms and conditions stated above for my enrollment as a Security Guard with {companyName}. I confirm that all information provided by me is true and correct to the best of my knowledge.
        </p>
        <div className="grid grid-cols-2 gap-12 mt-12 text-sm">
          <div><div className="border-t border-gray-400 pt-2">Signature of Security Guard</div></div>
          <div><div className="border-t border-gray-400 pt-2">Date</div></div>
          <div className="col-span-2 mt-6">
            <div className="border-t border-gray-400 pt-2">Name of Security Guard (in Block Letters): <span className="font-semibold">{employee.fullName?.toUpperCase()}</span></div>
          </div>
        </div>
      </section>
      <PageFooter pageNumber={pageNumber} />
    </div>
  );
});
TermsPage.displayName = 'TermsPage';


// #endregion

export default function AdminEmployeeProfilePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const employeeIdFromUrl = params.id as string;
  
  const biodataPageRef = useRef<HTMLDivElement>(null);
  const qrPageRef = useRef<HTMLDivElement>(null);
  const termsPageRef = useRef<HTMLDivElement>(null);

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isEditing, setIsEditing] = useState(searchParams.get('edit') === 'true');
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
  const [newIdProofDocumentFront, setNewIdProofDocumentFront] = useState<File | null>(null);
  const [newIdProofDocumentBack, setNewIdProofDocumentBack] = useState<File | null>(null);
  const [newBankPassbookStatement, setNewBankPassbookStatement] = useState<File | null>(null);
  const [newPoliceClearanceCertificate, setNewPoliceClearanceCertificate] = useState<File | null>(null);

  // State for file previews
  const [profilePicPreview, setProfilePicPreview] = useState<string | null>(null);
  const [idProofPreviewFront, setIdProofPreviewFront] = useState<string | null>(null);
  const [idProofPreviewBack, setIdProofPreviewBack] = useState<string | null>(null);
  const [bankPassbookPreview, setBankPassbookPreview] = useState<string | null>(null);
  const [policeCertificatePreview, setPoliceCertificatePreview] = useState<string | null>(null);
  
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
        
        // Defensive coding: Ensure fullName exists, which can be missing in older records.
        if (!data.fullName && data.firstName && data.lastName) {
          data.fullName = `${data.firstName} ${data.lastName}`;
        } else if (!data.fullName) {
          data.fullName = 'Unnamed Employee'; // Fallback if even names are missing
        }

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
    if (employee) {
      form.reset({
        ...employee,
        joiningDate: employee.joiningDate?.toDate ? employee.joiningDate.toDate() : new Date(employee.joiningDate),
        dateOfBirth: employee.dateOfBirth?.toDate ? employee.dateOfBirth.toDate() : new Date(employee.dateOfBirth),
        exitDate: employee.exitDate?.toDate ? employee.exitDate.toDate() : (employee.exitDate ? new Date(employee.exitDate) : null),
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

      const previewUrl = URL.createObjectURL(file);

      switch (activeCameraField) {
        case 'profilePicture':
          setNewProfilePicture(file);
          setProfilePicPreview(previewUrl);
          break;
        case 'idProofDocumentFront':
          setNewIdProofDocumentFront(file);
          setIdProofPreviewFront(previewUrl);
          break;
        case 'idProofDocumentBack':
          setNewIdProofDocumentBack(file);
          setIdProofPreviewBack(previewUrl);
          break;
        case 'bankPassbookStatement':
          setNewBankPassbookStatement(file);
          setBankPassbookPreview(previewUrl);
          break;
        case 'policeClearanceCertificate':
            setNewPoliceClearanceCertificate(file);
            setPoliceCertificatePreview(previewUrl);
            break;
      }
      closeCameraDialog();
    }
  };


  async function handleSaveChanges(data: EmployeeUpdateValues) {
    if (!employee) return;
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
            { file: newIdProofDocumentFront, oldUrl: employee.idProofDocumentUrlFront || employee.idProofDocumentUrl, path: `employees/${employee.phoneNumber}/idProofs/${Date.now()}_id_front.${newIdProofDocumentFront?.name.split('.').pop()}`, key: 'idProofDocumentUrlFront', isImage: newIdProofDocumentFront?.type.startsWith("image/") ?? false },
            { file: newIdProofDocumentBack, oldUrl: employee.idProofDocumentUrlBack, path: `employees/${employee.phoneNumber}/idProofs/${Date.now()}_id_back.${newIdProofDocumentBack?.name.split('.').pop()}`, key: 'idProofDocumentUrlBack', isImage: newIdProofDocumentBack?.type.startsWith("image/") ?? false },
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
                if (formDate?.getTime() !== originalDate?.getTime()) {
                    formPayload[key] = formValue ? Timestamp.fromDate(formValue) : (key === 'exitDate' ? deleteField() : originalValue);
                }
            } else if (formValue !== originalValue) {
                formPayload[key] = formValue;
            }
        });

        if (data.status !== 'Exited' && employee.exitDate) formPayload.exitDate = deleteField();
        if (data.maritalStatus !== 'Married' && employee.spouseName) formPayload.spouseName = "";
        
        const fullName = `${data.firstName} ${data.lastName}`;
        formPayload.fullName = fullName;

        const finalPayload = { ...formPayload, ...updatedUrls };
        
        // Update searchableFields if relevant info changed
        if (finalPayload.fullName || finalPayload.phoneNumber || finalPayload.employeeId) {
             finalPayload.searchableFields = Array.from(new Set([
                (finalPayload.fullName || employee.fullName).toUpperCase(),
                (finalPayload.fullName?.split(' ')[0] || employee.fullName.split(' ')[0]).toUpperCase(),
                (finalPayload.fullName?.split(' ').slice(1).join(' ') || employee.fullName.split(' ').slice(1).join(' ')).toUpperCase(),
                (finalPayload.employeeId || employee.employeeId).toUpperCase(),
                finalPayload.phoneNumber || employee.phoneNumber
             ].filter(Boolean)));
        }

        if (updatedUrls.idProofDocumentUrlFront && employee.idProofDocumentUrl) {
            finalPayload.idProofDocumentUrl = deleteField();
        }

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

    const handleDownloadProfile = async () => {
        if (!employee) return;
        setIsDownloadingPdf(true);
        toast({ title: "Generating PDF...", description: "Please wait, creating profile kit." });

        const pdf = new jsPDF('p', 'mm', 'a4');
        let pageCount = 0;

        const addPageToPdf = async (element: HTMLElement | null) => {
            if (!element) return;
            pageCount++;
            const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
            });
            const imgData = canvas.toDataURL('image/jpeg', 0.85);
            
            if (pageCount > 1) {
                pdf.addPage();
            }
            
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();
            const canvasAspectRatio = canvas.width / canvas.height;
            const pageAspectRatio = pdfWidth / pdfHeight;
            let finalWidth, finalHeight;
            
            if (canvasAspectRatio > pageAspectRatio) {
                finalWidth = pdfWidth;
                finalHeight = pdfWidth / canvasAspectRatio;
            } else {
                finalHeight = pdfHeight;
                finalWidth = pdfHeight * canvasAspectRatio;
            }

            const xOffset = (pdfWidth - finalWidth) / 2;
            const yOffset = (pdfHeight - finalHeight) / 2;
            
            pdf.addImage(imgData, 'JPEG', xOffset, yOffset, finalWidth, finalHeight);
        };

        try {
            const pagesToRender = [];
            pagesToRender.push(biodataPageRef.current);
            if (employee.qrCodeUrl) pagesToRender.push(qrPageRef.current);
            pagesToRender.push(termsPageRef.current);

            for (const pageElement of pagesToRender.filter(Boolean)) {
                await addPageToPdf(pageElement);
            }

            pdf.save(`${employee.fullName}_Profile_Kit.pdf`);
            toast({ title: "Download Started", description: "Your PDF profile kit is being downloaded." });
        } catch (error: any) {
            console.error("Error generating PDF:", error);
            toast({ variant: "destructive", title: "PDF Generation Failed", description: `Could not generate the profile document. ${error.message}` });
        } finally {
            setIsDownloadingPdf(false);
        }
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

  const handleRegenerateEmployeeId = async () => {
    if (!employee) return;
    setIsRegeneratingId(true);
    try {
      const newEmployeeId = generateEmployeeId(employee.clientName);
      const dataString = `Employee ID: ${newEmployeeId}\nName: ${employee.fullName}\nPhone: ${employee.phoneNumber}`;
      const newQrDataUrl = await QRCode.toDataURL(dataString, {
        errorCorrectionLevel: 'H', type: 'image/png', quality: 0.92, margin: 1, width: 256,
      });
      
      const newSearchableFields = Array.from(new Set([
          employee.fullName.toUpperCase(),
          employee.fullName.toUpperCase().split(' ')[0],
          employee.fullName.toUpperCase().split(' ').slice(1).join(' '),
          newEmployeeId.toUpperCase(),
          employee.phoneNumber
      ].filter(Boolean)));

      const employeeDocRef = doc(db, "employees", employee.id);
      await updateDoc(employeeDocRef, {
        employeeId: newEmployeeId,
        qrCodeUrl: newQrDataUrl,
        searchableFields: newSearchableFields,
        updatedAt: serverTimestamp(),
      });

      setEmployee(prev => prev ? { ...prev, employeeId: newEmployeeId, qrCodeUrl: newQrDataUrl, searchableFields: newSearchableFields } : null);
      toast({ title: "Employee ID Regenerated", description: `New ID is ${newEmployeeId}. QR code and search fields also updated.` });
    } catch (err) {
      console.error("Error regenerating Employee ID:", err);
      toast({ variant: "destructive", title: "ID Regeneration Failed", description: "Could not regenerate the Employee ID." });
    } finally {
      setIsRegeneratingId(false);
    }
  };
  
  const resetFileStates = () => {
      setNewProfilePicture(null);
      setNewIdProofDocumentFront(null);
      setNewIdProofDocumentBack(null);
      setNewBankPassbookStatement(null);
      setNewPoliceClearanceCertificate(null);
      setProfilePicPreview(null);
      setIdProofPreviewFront(null);
      setIdProofPreviewBack(null);
      setBankPassbookPreview(null);
      setPoliceCertificatePreview(null);
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
  
  const renderOffscreenPages = () => {
    if (!employee) return null;

    const pages = [];
    let pageNumber = 1;

    pages.push(<BiodataPage key={`page-${pageNumber}`} ref={biodataPageRef} employee={employee} pageNumber={pageNumber++} />);
    
    if (employee.qrCodeUrl) {
      pages.push(<QrPage key={`page-${pageNumber}`} ref={qrPageRef} employee={employee} pageNumber={pageNumber++} />);
    }

    pages.push(<TermsPage key={`page-${pageNumber}`} ref={termsPageRef} employee={employee} pageNumber={pageNumber++} />);

    return pages;
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
            <Button onClick={() => router.push('/employees')} className="mt-4">
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
                <Button onClick={() => router.push('/employees')} className="mt-4">
                   <ArrowLeft className="mr-2 h-4 w-4" />Back to Directory
                </Button>
            </AlertDescription>
        </Alert>
    );
  }

  return (
    <>
      <div style={{ position: 'absolute', left: '-9999px', top: 0, zIndex: -1, fontFamily: 'sans-serif' }}>
        {renderOffscreenPages()}
      </div>
      <div className="flex flex-col gap-6">
        <div className="mb-4">
          <Button variant="outline" size="sm" onClick={() => router.push('/employees')}>
              <ArrowLeft className="mr-2 h-4 w-4" />Back to Employee Directory
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
              <h1 className="text-3xl font-bold tracking-tight">{toTitleCase(employee.fullName)}</h1>
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
          <Tabs defaultValue="personal">
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
                    <DetailItem label="District" value={employee.district} isName />
                  </div>
                  <Separator className="my-6" />
                  <CardTitle className="text-lg mb-2">Contact Details</CardTitle>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    <DetailItem label="Phone Number" value={employee.phoneNumber} />
                    <DetailItem label="Email Address" value={employee.emailAddress} />
                     <div className="md:col-span-2">
                        <DetailItem label="Full Address" value={employee.fullAddress} isAddress />
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
                            <DocumentItem name="ID Proof (Front)" url={employee.idProofDocumentUrlFront || employee.idProofDocumentUrl} type={employee.idProofType || "ID Document"} />
                            <DocumentItem name="ID Proof (Back)" url={employee.idProofDocumentUrlBack} type={employee.idProofType || "ID Document"} />
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
                      <FormItem><FormLabel>Employee ID</FormLabel><FormControl><Input value={employee.employeeId} disabled /></FormControl><FormDescription>Employee ID cannot be changed here. Regenerate it from the view mode.</FormDescription></FormItem>
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
                      <div className="grid grid-cols-1 gap-6">
                          {/* Profile Picture */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-md">
                              <Label className="md:col-span-1 text-base self-center">Profile Picture</Label>
                              <Image src={profilePicPreview || employee.profilePictureUrl || "https://placehold.co/128x128.png"} alt="Profile" width={128} height={128} className="rounded-full object-cover h-32 w-32 justify-self-center" data-ai-hint="profile picture" />
                              <div className="flex flex-col justify-center gap-2">
                                  <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById('profilePictureInput')?.click()}><Upload className="mr-2 h-4 w-4" /> Upload New</Button>
                                  <Button type="button" size="sm" variant="outline" onClick={() => openCamera('profilePicture')}><Camera className="mr-2 h-4 w-4" /> Use Camera</Button>
                                  <Input id="profilePictureInput" type="file" className="hidden" accept="image/*" onChange={(e) => handleFileChange(e, setNewProfilePicture, setProfilePicPreview)} />
                              </div>
                          </div>

                          {/* ID Proof Front */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-md">
                              <Label className="md:col-span-1 text-base self-center">ID Proof (Front)</Label>
                              <Image src={idProofPreviewFront || ((employee.idProofDocumentUrlFront || employee.idProofDocumentUrl)?.includes('.pdf') ? '/pdf-icon.png' : (employee.idProofDocumentUrlFront || employee.idProofDocumentUrl)) || "https://placehold.co/200x120.png"} alt="ID Proof Front" width={200} height={120} className="object-contain h-32 w-full justify-self-center" data-ai-hint="id card" />
                              <div className="flex flex-col justify-center gap-2">
                                  <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById('idProofFrontInput')?.click()}><Upload className="mr-2 h-4 w-4" /> Upload New</Button>
                                  <Button type="button" size="sm" variant="outline" onClick={() => openCamera('idProofDocumentFront')}><Camera className="mr-2 h-4 w-4" /> Use Camera</Button>
                                  <Input id="idProofFrontInput" type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => handleFileChange(e, setNewIdProofDocumentFront, setIdProofPreviewFront)} />
                              </div>
                          </div>

                          {/* ID Proof Back */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-md">
                              <Label className="md:col-span-1 text-base self-center">ID Proof (Back)</Label>
                              <Image src={idProofPreviewBack || (employee.idProofDocumentUrlBack?.includes('.pdf') ? '/pdf-icon.png' : employee.idProofDocumentUrlBack) || "https://placehold.co/200x120.png"} alt="ID Proof Back" width={200} height={120} className="object-contain h-32 w-full justify-self-center" data-ai-hint="id card" />
                              <div className="flex flex-col justify-center gap-2">
                                  <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById('idProofBackInput')?.click()}><Upload className="mr-2 h-4 w-4" /> Upload New</Button>
                                  <Button type="button" size="sm" variant="outline" onClick={() => openCamera('idProofDocumentBack')}><Camera className="mr-2 h-4 w-4" /> Use Camera</Button>
                                  <Input id="idProofBackInput" type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => handleFileChange(e, setNewIdProofDocumentBack, setIdProofPreviewBack)} />
                              </div>
                          </div>

                          {/* Bank Passbook */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-md">
                              <Label className="md:col-span-1 text-base self-center">Bank Document</Label>
                              <Image src={bankPassbookPreview || (employee.bankPassbookStatementUrl?.includes('.pdf') ? '/pdf-icon.png' : employee.bankPassbookStatementUrl) || "https://placehold.co/200x120.png"} alt="Bank Document" width={200} height={120} className="object-contain h-32 w-full justify-self-center" data-ai-hint="bank document" />
                               <div className="flex flex-col justify-center gap-2">
                                  <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById('bankPassbookInput')?.click()}><Upload className="mr-2 h-4 w-4" /> Upload New</Button>
                                  <Button type="button" size="sm" variant="outline" onClick={() => openCamera('bankPassbookStatement')}><Camera className="mr-2 h-4 w-4" /> Use Camera</Button>
                              </div>
                              <Input id="bankPassbookInput" type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => handleFileChange(e, setNewBankPassbookStatement, setBankPassbookPreview)} />
                          </div>
                          
                           {/* Police Clearance Certificate */}
                           <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-md">
                              <Label className="md:col-span-1 text-base self-center">Police Clearance Certificate</Label>
                              <Image src={policeCertificatePreview || (employee.policeClearanceCertificateUrl?.includes('.pdf') ? '/pdf-icon.png' : employee.policeClearanceCertificateUrl) || "https://placehold.co/200x120.png"} alt="Police Clearance Certificate" width={200} height={120} className="object-contain h-32 w-full justify-self-center" data-ai-hint="police certificate document" />
                               <div className="flex flex-col justify-center gap-2">
                                  <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById('policeCertInput')?.click()}><Upload className="mr-2 h-4 w-4" /> Upload New</Button>
                                  <Button type="button" size="sm" variant="outline" onClick={() => openCamera('policeClearanceCertificate')}><Camera className="mr-2 h-4 w-4" /> Use Camera</Button>
                                  <FormDescription>Optional document</FormDescription>
                              </div>
                              <Input id="policeCertInput" type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => handleFileChange(e, setNewPoliceClearanceCertificate, setPoliceCertificatePreview)} />
                          </div>

                      </div>
                  </section>
                </CardContent>
                <CardFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
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

      <Dialog open={isCameraDialogOpen} onOpenChange={(isOpen) => { if (!isOpen) closeCameraDialog(); }}>
          <DialogContent className="sm:max-w-[calc(100vw-2rem)] md:max-w-[600px]">
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
    </>
  );
}
