

"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { type Employee } from '@/types/employee';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from '@/components/ui/separator';
import { Edit3, User, Briefcase, Banknote, ShieldCheck, QrCode, FileUp, Download, Loader2, AlertCircle, RefreshCw, ArrowLeft, Home, CalendarIcon, Upload, Camera, Edit, KeyRound, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { db, auth, storage } from '@/lib/firebase';
import { doc, getDoc, Timestamp, updateDoc, serverTimestamp, collection, query, orderBy, getDocs, deleteField } from 'firebase/firestore';
import { format, subYears, addYears } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import QRCode from 'qrcode';
import { RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, type User as FirebaseUser, type ConfirmationResult } from 'firebase/auth';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription as ShadDialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { compressImage, uploadFileToStorage, dataURLtoFile, deleteFileFromStorage } from "@/lib/storageUtils";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Add RecaptchaVerifier to window interface
declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier;
    confirmationResult?: ConfirmationResult;
  }
}

// Dropdown options
const keralaDistricts = ["Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod"];
const idProofOptions = ["PAN Card", "Voter ID", "Driving License", "Passport", "Birth Certificate", "School Certificate", "Aadhar Card"];
const maritalStatuses = ["Married", "Unmarried"];
const genderOptions = ["Male", "Female", "Other"];
const educationOptions = ["Primary School", "High School", "Diploma", "Graduation", "Post Graduation", "Doctorate", "Any Other Qualification"];
type CameraField = "profilePicture" | "identityProofUrlFront" | "identityProofUrlBack" | "addressProofUrlFront" | "addressProofUrlBack" | "signatureUrl" | "bankPassbookStatement" | "policeClearanceCertificate";


const proofTypes = z.enum(["PAN Card", "Voter ID", "Driving License", "Passport", "Birth Certificate", "School Certificate", "Aadhar Card"]);
const qualificationTypes = z.enum(["Primary School", "High School", "Diploma", "Graduation", "Post Graduation", "Doctorate", "Any Other Qualification"]);


// Zod schema for validation
const employeeUpdateSchema = z.object({
  educationalQualification: qualificationTypes,
  otherQualification: z.string().optional(),
  identityProofType: proofTypes,
  identityProofNumber: z.string().min(5, "ID Proof number is required."),
  addressProofType: proofTypes,
  addressProofNumber: z.string().min(5, { message: "Address proof number is required." }),
}).superRefine((data, ctx) => {
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
    Page {pageNumber} | CISS Services Ltd. | Generated on: {format(new Date(), "dd-MM-yyyy")}
  </footer>
);


const DetailGridItem = ({ label, value }: { label: string; value?: string | number | null }) => (
  <div>
    <p className="text-xs text-gray-500">{label}</p>
    <p className="font-medium text-gray-800">{value || 'N/A'}</p>
  </div>
);

const formatDateForPdf = (date: any) => {
  if (!date) return 'N/A';
  const dateObj = date.toDate ? date.toDate() : new Date(date);
  if (isNaN(dateObj.getTime())) return 'N/A';
  return format(dateObj, "dd-MM-yyyy");
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
          <DetailGridItem label="Date of Birth" value={formatDateForPdf(employee.dateOfBirth)} />
          <DetailGridItem label="Gender" value={employee.gender} />
          <DetailGridItem label="Marital Status" value={employee.maritalStatus} />
          <DetailGridItem label="Father's Name" value={toTitleCase(employee.fatherName)} />
          <DetailGridItem label="Mother's Name" value={toTitleCase(employee.motherName)} />
          {employee.maritalStatus === 'Married' && <DetailGridItem label="Spouse's Name" value={toTitleCase(employee.spouseName)} />}
          <DetailGridItem label="Educational Qualification" value={employee.educationalQualification === 'Any Other Qualification' ? employee.otherQualification : employee.educationalQualification} />
          <DetailGridItem label="Phone Number" value={employee.phoneNumber} />
          <DetailGridItem label="Email Address" value={employee.emailAddress?.toLowerCase()} />
          <DetailGridItem label="District" value={toTitleCase(employee.district)} />
          <div className="col-span-3">
            <DetailGridItem label="Full Address" value={toTitleCase(employee.fullAddress)} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-blue-700 border-b pb-2 mb-4">Employment & Statutory Details</h2>
        <div className="grid grid-cols-3 gap-x-6 gap-y-4">
          <DetailGridItem label="Joining Date" value={formatDateForPdf(employee.joiningDate)} />
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
          <DetailGridItem label="Identity Proof" value={`${employee.identityProofType || (employee as any).idProofType || 'N/A'} - ${employee.identityProofNumber || (employee as any).idProofNumber || 'N/A'}`} />
          <DetailGridItem label="Address Proof" value={`${employee.addressProofType || 'N/A'} - ${employee.addressProofNumber || 'N/A'}`} />
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
        <div className="flex justify-between items-end mt-12 pt-12 text-sm">
            <div className="flex-1 space-y-2">
                {employee.signatureUrl ? (
                    <Image src={employee.signatureUrl} alt="Employee Signature" width={150} height={75} unoptimized={true} crossOrigin='anonymous' data-ai-hint="signature" style={{ objectFit: 'contain' }} />
                ): (
                    <div className="h-[75px] w-[150px] border-b border-gray-400"></div>
                )}
                <div className="border-t border-gray-400 pt-2 font-semibold">Signature of Security Guard</div>
            </div>
            <div className="w-1/4 text-center">
                <p className="border-b border-gray-400 pb-1">{formatDateForPdf(employee.joiningDate)}</p>
                <div className="border-t border-gray-400 mt-2 pt-2 font-semibold">Date of Registration</div>
            </div>
        </div>
        <div className="mt-8 pt-6 border-t border-gray-300">
            <p className="text-sm">Name of Security Guard (in Block Letters): <span className="font-semibold">{employee.fullName?.toUpperCase()}</span></p>
        </div>
      </section>
      <PageFooter pageNumber={pageNumber} />
    </div>
  );
});
TermsPage.displayName = 'TermsPage';


// #endregion

export default function PublicEmployeeProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const employeeIdFromUrl = params.id as string;
  
  const biodataPageRef = useRef<HTMLDivElement>(null);
  const qrPageRef = useRef<HTMLDivElement>(null);
  const termsPageRef = useRef<HTMLDivElement>(null);

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isUploadMode, setIsUploadMode] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // OTP Flow State
  const [showOtpDialog, setShowOtpDialog] = useState(false);
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

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

  const form = useForm<EmployeeUpdateValues>({
    resolver: zodResolver(employeeUpdateSchema),
    defaultValues: {
      educationalQualification: undefined,
      otherQualification: "",
      identityProofType: undefined,
      identityProofNumber: "",
      addressProofType: undefined,
      addressProofNumber: "",
    },
  });
  
  const watchEducationalQualification = form.watch("educationalQualification");

  useEffect(() => {
    const fetchEmployee = async () => {
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
        setError(message);
        toast({ variant: "destructive", title: "Fetch Error", description: message});
      } finally {
        setIsLoading(false);
      }
    };
    if (!employeeIdFromUrl) {
      setError("Employee ID not found in URL.");
      setIsLoading(false);
      return;
    }
    fetchEmployee();
  }, [employeeIdFromUrl, toast]);

  useEffect(() => {
    if (employee) {
      const legacy = employee as any;
      const getInitialValue = (key: keyof Employee, fallback = "") => employee[key] || fallback;
      form.reset({
        educationalQualification: getInitialValue('educationalQualification') as any,
        otherQualification: getInitialValue('otherQualification'),
        identityProofType: (employee.identityProofType || legacy.idProofType) as any,
        identityProofNumber: (employee.identityProofNumber || legacy.idProofNumber),
        addressProofType: employee.addressProofType as any,
        addressProofNumber: getInitialValue('addressProofNumber'),
      });
    }
  }, [employee, form]);

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
    
    setIsSubmitting(true);
    toast({ title: "Saving...", description: "Updating your profile." });

    try {
        const updatedUrls: { [key: string]: string | null } = {};

        const uploadAndSetUrl = async (
            newFile: File | null,
            oldUrl: string | undefined,
            filePath: string,
            urlKey: keyof typeof updatedUrls,
            isImage: boolean
        ) => {
            if (!newFile) return;
            // Public users cannot delete, so we just upload the new file.
            // The storage rules prevent them from deleting.
            
            const fileToUpload = isImage
                ? await compressImage(newFile, { maxWidth: 1024, maxHeight: 1024, quality: 0.7 })
                : file;
                
            updatedUrls[urlKey] = await uploadFileToStorage(fileToUpload, filePath);
        };

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

        const formPayload: Record<string, any> = { ...data };

        if (data.educationalQualification !== "Any Other Qualification") {
            formPayload.otherQualification = "";
        }

        const finalPayload = { ...formPayload, ...updatedUrls };
        
        // Update publicProfile if relevant fields change
        if (finalPayload.profilePictureUrl) {
            finalPayload['publicProfile.profilePictureUrl'] = finalPayload.profilePictureUrl;
        }

        if (Object.keys(finalPayload).length > 0) {
            finalPayload.updatedAt = serverTimestamp();
            const employeeDocRef = doc(db, "employees", employee.id);
            await updateDoc(employeeDocRef, finalPayload);
            toast({ title: "Profile Updated", description: "Your details have been saved." });
            // Manually update local state
            setEmployee(prev => prev ? { ...prev, ...finalPayload, dateOfBirth: finalPayload.dateOfBirth || prev.dateOfBirth, joiningDate: finalPayload.joiningDate || prev.joiningDate } as Employee : null);
            setIsUploadMode(false);
        } else {
            toast({ title: "No Changes", description: "No changes were detected to save." });
            setIsUploadMode(false);
        }
    } catch (err: any) {
        console.error("Error updating profile:", err);
        let description = err.message || "An error occurred while saving.";
        if (err.code === 'permission-denied' || err.code === 'PERMISSION_DENIED') {
            description = "Permission Denied. Your request to update the profile could not be authorized. Please ensure you are correctly verified and try again.";
        }
        toast({ variant: "destructive", title: "Update Failed", description });
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
  
  const setupRecaptcha = () => {
    if (window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
    }
    const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      'size': 'invisible',
      'callback': (response: any) => {},
    });
    return verifier;
  };
  
  const handleSendOtp = async () => {
      if (!employee) return;
      setIsSendingOtp(true);
      try {
          const fullPhoneNumber = `+91${employee.phoneNumber}`;
          const appVerifier = setupRecaptcha();
          const result = await signInWithPhoneNumber(auth, fullPhoneNumber, appVerifier);
          setConfirmationResult(result);
          window.confirmationResult = result;
          toast({ title: "OTP Sent", description: "Please check your phone for the verification code." });
      } catch (error: any) {
          console.error("Error sending OTP:", error);
          let description = "Could not send OTP. Please try again later.";
          if (error.code === 'auth/too-many-requests') description = "Too many requests. Please wait a while before trying again.";
          toast({ variant: "destructive", title: "OTP Send Error", description });
          setShowOtpDialog(false);
      } finally {
          setIsSendingOtp(false);
      }
  };

  const handleVerifyOtp = async () => {
      const resultToConfirm = confirmationResult || window.confirmationResult;
      if (!resultToConfirm) {
          toast({ variant: 'destructive', title: 'Verification Error', description: 'Could not find verification session. Please try again.' });
          return;
      }
      setIsVerifyingOtp(true);
      try {
          await resultToConfirm.confirm(otp);
          toast({ title: "Verification Successful", description: "You can now update your profile." });
          setShowOtpDialog(false);
          setIsUploadMode(true); // Unlock edit mode on success
      } catch (error: any) {
          console.error("Error verifying OTP:", error);
          let description = "Failed to verify OTP.";
          if (error.code === 'auth/invalid-verification-code') description = "The code is invalid. Please check and try again.";
          if (error.code === 'auth/code-expired') description = "The code has expired. Please request a new one.";
          toast({ variant: "destructive", title: "Verification Failed", description });
      } finally {
          setIsVerifyingOtp(false);
      }
  };

  const handleUpdateDetailsClick = () => {
      setShowOtpDialog(true);
      handleSendOtp();
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

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-lg text-muted-foreground">Loading Profile...</p>
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
            <Button onClick={() => router.push('/')} className="mt-4">
              <Home className="mr-2 h-4 w-4" />Back to Home
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
                <Button onClick={() => router.push('/')} className="mt-4">
                   <Home className="mr-2 h-4 w-4" />Back to Home
                </Button>
            </AlertDescription>
        </Alert>
    );
  }

  return (
    <>
      <div id="recaptcha-container" />
      <div style={{ position: 'absolute', left: '-9999px', top: 0, zIndex: -1, fontFamily: 'sans-serif' }}>
        {renderOffscreenPages()}
      </div>
      <div className="flex flex-col gap-6 max-w-5xl mx-auto p-4 sm:p-6 md:p-8">
        <div className="flex justify-between items-center mb-4">
          <Button variant="outline" size="sm" onClick={() => router.push('/')}>
              <ArrowLeft className="mr-2 h-4 w-4" />Back to Home
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
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{toTitleCase(employee.fullName)}</h1>
              <p className="text-muted-foreground">{employee.employeeId} - {employee.clientName || "N/A"}</p>
              <Badge variant={getStatusBadgeVariant(employee.status)} className="mt-1">{employee.status}</Badge>
            </div>
          </div>
            <div className="flex w-full sm:w-auto gap-2">
              <Button onClick={handleDownloadProfile} variant="outline" className="flex-1 sm:flex-none" disabled={isDownloadingPdf}>
                  {isDownloadingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Download Kit
              </Button>
              <Button onClick={handleUpdateDetailsClick} className="flex-1 sm:flex-none">
                  <Edit3 className="mr-2 h-4 w-4" /> Update Details
              </Button>
            </div>
        </div>

        {!isUploadMode && (
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

        {isUploadMode && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSaveChanges)}>
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Update Profile Information</CardTitle>
                  <CardDescription>Update your details below. Upload any missing documents. Click "Save Changes" when done.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                  <section>
                    <h3 className="text-lg font-semibold mb-4 border-b pb-2">Personal Details</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                              <FormControl><Input placeholder="e.g., B.Tech in Computer Science" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
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
                           <ImageInputWithPreview label="Front Page" currentUrl={employee.identityProofUrlFront || (employee as any).idProofDocumentUrlFront || (employee as any).idProofDocumentUrl} preview={identityProofUrlFrontPreview} setFile={setNewIdentityProofUrlFront} setPreview={setIdentityProofUrlFrontPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('identityProofUrlFront')} />
                           <ImageInputWithPreview label="Back Page" currentUrl={employee.identityProofUrlBack || (employee as any).idProofDocumentUrlBack} preview={identityProofUrlBackPreview} setFile={setNewIdentityProofUrlBack} setPreview={setIdentityProofUrlBackPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('identityProofUrlBack')} />
                        </div>
                    </div>

                    <div className="p-4 border rounded-lg mt-6 space-y-4">
                        <h4 className="font-medium text-md">Address Proof</h4>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <FormField control={form.control} name="addressProofType" render={({ field }) => ( <FormItem><FormLabel>Document Type</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{idProofOptions.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                            <FormField control={form.control} name="addressProofNumber" render={({ field }) => (<FormItem><FormLabel>Document Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                           <ImageInputWithPreview label="Front Page" currentUrl={employee.addressProofUrlFront} preview={addressProofUrlFrontPreview} setFile={setNewAddressProofUrlFront} setPreview={setAddressProofUrlFrontPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('addressProofUrlFront')} />
                           <ImageInputWithPreview label="Back Page" currentUrl={employee.addressProofUrlBack} preview={addressProofUrlBackPreview} setFile={setNewAddressProofUrlBack} setPreview={setAddressProofUrlBackPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('addressProofUrlBack')} />
                        </div>
                    </div>
                  </section>

                  {/* Other Documents Section */}
                  <section>
                      <h3 className="text-lg font-semibold mb-4 border-b pb-2">Other Documents & Signature</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <ImageInputWithPreview label="Profile Picture" currentUrl={employee.profilePictureUrl} preview={profilePicPreview} setFile={setNewProfilePicture} setPreview={setProfilePicPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('profilePicture')} isProfilePic={true} />
                          <ImageInputWithPreview label="Signature" currentUrl={employee.signatureUrl} preview={signatureUrlPreview} setFile={setNewSignatureUrl} setPreview={setSignatureUrlPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('signatureUrl')} isSignature={true} />
                          <ImageInputWithPreview label="Bank Document" currentUrl={employee.bankPassbookStatementUrl} preview={bankPassbookPreview} setFile={setNewBankPassbookStatement} setPreview={setBankPassbookPreview} handleFileChange={handleFileChange} openCamera={() => openCamera('bankPassbookStatement')} />
                          <ImageInputWithPreview label="Police Clearance Certificate" currentUrl={employee.policeClearanceCertificateUrl} preview={policeCertificatePreview} setFile={setNewPoliceClearanceCertificate} setPreview={setPoliceCertificatePreview} handleFileChange={handleFileChange} openCamera={() => openCamera('policeClearanceCertificate')} />
                      </div>
                  </section>
                </CardContent>
                <CardFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsUploadMode(false)} disabled={isSubmitting}>Cancel</Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </Form>
        )}

      <Dialog open={showOtpDialog} onOpenChange={setShowOtpDialog}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Verify Your Identity</DialogTitle>
                <ShadDialogDescription>
                    To protect your account, we've sent a one-time password (OTP) to your registered mobile number: ****{employee.phoneNumber.slice(-4)}.
                </ShadDialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
                <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                        id="otp"
                        type="tel"
                        placeholder="Enter 6-digit OTP"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        maxLength={6}
                        disabled={isVerifyingOtp}
                        className="pl-10 text-lg tracking-widest text-center"
                    />
                </div>
                 <Button onClick={handleVerifyOtp} className="w-full" disabled={otp.length < 6 || isVerifyingOtp}>
                    {isVerifyingOtp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Verify and Proceed
                </Button>
            </div>
            <DialogFooter className="text-xs text-muted-foreground justify-center">
                Didn't receive the code? 
                <Button variant="link" size="sm" className="p-0 h-auto" onClick={handleSendOtp} disabled={isSendingOtp}>
                   {isSendingOtp ? 'Resending...' : 'Resend OTP'}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>


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

const ImageInputWithPreview: React.FC<{
    label: string;
    currentUrl?: string;
    preview: string | null;
    setFile: (file: File | null) => void;
    setPreview: (preview: string | null) => void;
    handleFileChange: (event: React.ChangeEvent<HTMLInputElement>, setFile: any, setPreview: any) => void;
    openCamera: () => void;
    isProfilePic?: boolean;
    isSignature?: boolean;
    canRemove?: boolean;
}> = ({ label, currentUrl, preview, setFile, setPreview, handleFileChange, openCamera, isProfilePic, isSignature, canRemove = false }) => {
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
                                    <AlertDialogAction onClick={() => {
                                        // This button's functionality is handled outside for public/admin distinction
                                        // This is a placeholder for triggering the parent's onRemove
                                    }}>Confirm & Remove</AlertDialogAction>
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
