

"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { type Employee } from '@/types/employee';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from '@/components/ui/separator';
import { User, Briefcase, Banknote, ShieldCheck, QrCode, FileUp, Download, Loader2, AlertCircle, Home, Upload, Camera, Edit } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { db, storage } from '@/lib/firebase';
import { doc, getDoc, Timestamp, updateDoc, serverTimestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { compressImage, dataURLtoFile, uploadFileToStorage, deleteFileFromStorage } from "@/lib/storageUtils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';


// #region PDF Generation Components

const toTitleCase = (str: string | null | undefined): string => {
    if (!str) return '';
    if (str.includes('@')) return str.toLowerCase(); // Keep emails lowercase
    if (str.toUpperCase() === str) { // Likely an all-caps address
        return str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
    }
    return str.replace(/\b\w/g, char => char.toUpperCase());
};

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
  if (isNaN(dateObj.getTime())) return 'N/A';
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
                <p className="border-b border-gray-400 pb-1">{formatDate(employee.joiningDate)}</p>
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


const DetailItem: React.FC<{ label: string; value?: string | number | null | Date; isDate?: boolean; isName?: boolean; isAddress?: boolean; }> = ({ label, value, isDate, isName, isAddress }) => {
  let displayValue: string | number = 'N/A';
  if (value !== null && value !== undefined) {
    if (isDate && value instanceof Date) {
      displayValue = format(value, "PPP");
    } else if (isDate && typeof value === 'string') {
      try {
        displayValue = format(new Date(value), "PPP");
      } catch (e) {
        displayValue = String(value);
      }
    } else if (value instanceof Timestamp) {
      displayValue = format(value.toDate(), "PPP");
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

type CameraField = "profilePicture" | "identityProofUrlFront" | "identityProofUrlBack" | "addressProofUrlFront" | "addressProofUrlBack" | "signatureUrl" | "bankPassbookStatement" | "policeClearanceCertificate";

const ImageInputWithPreview: React.FC<{
    label: string;
    currentUrl?: string;
    preview: string | null;
    onFileSelect: (file: File) => void;
    onCameraClick: () => void;
    isProfilePic?: boolean;
    isSignature?: boolean;
}> = ({ label, currentUrl, preview, onFileSelect, onCameraClick, isProfilePic, isSignature }) => {
    const uniqueId = React.useId();
    const finalPreview = preview || (currentUrl?.includes('.pdf') ? '/pdf-icon.png' : currentUrl) || "https://placehold.co/200x120.png";

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            onFileSelect(file);
        }
    };

    return (
        <div className="space-y-2">
            <Label className="text-base">{label}</Label>
            <div className="p-4 border rounded-md text-center space-y-2">
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
                <div className="flex justify-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById(uniqueId)?.click()}><Upload className="mr-2 h-4 w-4" /> Upload</Button>
                    <Button type="button" size="sm" variant="outline" onClick={onCameraClick}><Camera className="mr-2 h-4 w-4" /> Camera</Button>
                    <Input id={uniqueId} type="file" className="hidden" accept="image/*,.pdf" onChange={handleFileChange} />
                </div>
            </div>
        </div>
    );
};

export default function PublicEmployeeProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const employeeIdFromUrl = params.id as string;

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const [isUploadMode, setIsUploadMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<Record<string, File | null>>({});
  const [filePreviews, setFilePreviews] = useState<Record<string, string | null>>({});

  // Camera state
  const [activeCameraField, setActiveCameraField] = useState<CameraField | null>(null);
  const [isCameraDialogOpen, setIsCameraDialogOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const biodataPageRef = useRef<HTMLDivElement>(null);
  const qrPageRef = useRef<HTMLDivElement>(null);
  const termsPageRef = useRef<HTMLDivElement>(null);

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
      setError(err.message || "Failed to fetch employee data.");
      toast({ variant: "destructive", title: "Fetch Error", description: "Could not retrieve employee details."});
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!employeeIdFromUrl) {
      setError("Employee ID not found in URL.");
      setIsLoading(false);
      return;
    }
    fetchEmployee();
  }, [employeeIdFromUrl]);

  const getStatusBadgeVariant = (status?: Employee['status']) => {
    switch (status) {
      case 'Active': return 'default';
      case 'Inactive': return 'secondary';
      case 'OnLeave': return 'outline';
      case 'Exited': return 'destructive';
      default: return 'outline';
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
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: activeCameraField === 'profilePicture' ? 'user' : 'environment' } });
            setCameraStream(stream);
            if (videoRef.current) videoRef.current.srcObject = stream;
        } catch (err) {
            setCameraError("Could not access camera. Please ensure permission is granted.");
            setIsCameraDialogOpen(false);
        }
    }
    getCameraStream();
  }, [isCameraDialogOpen, activeCameraField]);
  
  const closeCameraDialog = () => {
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
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
      
      handleFileSelect(activeCameraField, file);
      closeCameraDialog();
    }
  };

  const handleFileSelect = (fieldName: string, file: File) => {
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({ variant: "destructive", title: "File too large", description: "Please select a file smaller than 5MB." });
        return;
    }
    setFilesToUpload(prev => ({ ...prev, [fieldName]: file }));
    if (file.type.startsWith("image/")) {
        setFilePreviews(prev => ({ ...prev, [fieldName]: URL.createObjectURL(file) }));
    } else if (file.type === "application/pdf") {
        setFilePreviews(prev => ({ ...prev, [fieldName]: "/pdf-icon.png" }));
    }
  };
  
  const handleSaveChanges = async () => {
    if (!employee || Object.keys(filesToUpload).length === 0) {
      toast({ title: "No files selected", description: "Please select at least one file to upload." });
      return;
    }
    
    setIsSubmitting(true);
    toast({ title: "Uploading...", description: "Please wait while your documents are uploaded." });
    
    const updatedUrls: { [key: string]: string } = {};
    const phoneNumber = employee.phoneNumber;
    
    const fileMap: Record<string, string> = {
        identityProofUrlFront: `employees/${phoneNumber}/idProofs/${Date.now()}_id_front`,
        identityProofUrlBack: `employees/${phoneNumber}/idProofs/${Date.now()}_id_back`,
        addressProofUrlFront: `employees/${phoneNumber}/addressProofs/${Date.now()}_addr_front`,
        addressProofUrlBack: `employees/${phoneNumber}/addressProofs/${Date.now()}_addr_back`,
        signatureUrl: `employees/${phoneNumber}/signatures/${Date.now()}_sig`,
        bankPassbookStatementUrl: `employees/${phoneNumber}/bankDocuments/${Date.now()}_bank`,
        policeClearanceCertificateUrl: `employees/${phoneNumber}/policeCertificates/${Date.now()}_pcc`,
    };

    try {
      for (const [fieldName, file] of Object.entries(filesToUpload)) {
        if (file) {
          const isImage = file.type.startsWith("image/");
          const fileExtension = file.name.split('.').pop() || (isImage ? 'jpg' : 'bin');
          const storagePath = `${fileMap[fieldName]}.${fileExtension}`;
          
          const fileToUpload = isImage ? await compressImage(file, { maxWidth: 1024, maxHeight: 1024, quality: 0.7 }) : file;
          updatedUrls[fieldName] = await uploadFileToStorage(fileToUpload, storagePath);
        }
      }

      const employeeDocRef = doc(db, "employees", employee.id);
      await updateDoc(employeeDocRef, {
        ...updatedUrls,
        updatedAt: serverTimestamp(),
      });
      
      toast({ title: "Upload Successful", description: "Your documents have been saved." });
      setIsUploadMode(false);
      setFilesToUpload({});
      setFilePreviews({});
      await fetchEmployee(); // Re-fetch data to show the updated profile
      
    } catch (error: any) {
      console.error("Error updating documents:", error);
      toast({ variant: "destructive", title: "Upload Failed", description: error.message || "An error occurred while saving." });
    } finally {
      setIsSubmitting(false);
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
      <div className="flex justify-center items-center h-[calc(100vh-100px)]">
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
            <Button onClick={() => router.push('/')} className="mt-4">
              <Home className="mr-2 h-4 w-4" /> Back to Home
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
                  <Home className="mr-2 h-4 w-4" /> Back to Home
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
        <div className="flex flex-col gap-6 max-w-5xl mx-auto p-4 md:p-0">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <Button variant="outline" size="sm" onClick={() => router.push('/')}>
            <Home className="mr-2 h-4 w-4" /> Back to Home
            </Button>
            <div className="flex gap-2 w-full sm:w-auto">
                <Button onClick={handleDownloadProfile} variant="outline" className="flex-1" disabled={isDownloadingPdf}>
                    {isDownloadingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                    Download Kit
                </Button>
                 <Button onClick={() => setIsUploadMode(!isUploadMode)} className="flex-1">
                    <Edit className="mr-2 h-4 w-4" /> {isUploadMode ? "Cancel Upload" : "Upload Documents"}
                </Button>
            </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
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
        </div>
        
        {isUploadMode && (
          <Card>
              <CardHeader>
                  <CardTitle>Upload Missing Documents</CardTitle>
                  <CardDescription>Upload any missing documents below. Click "Save Changes" when you are done.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {!employee.identityProofUrlFront && <ImageInputWithPreview label="Identity Proof (Front)" onFileSelect={(file) => handleFileSelect('identityProofUrlFront', file)} onCameraClick={() => openCamera('identityProofUrlFront')} preview={filePreviews.identityProofUrlFront} />}
                    {!employee.identityProofUrlBack && <ImageInputWithPreview label="Identity Proof (Back)" onFileSelect={(file) => handleFileSelect('identityProofUrlBack', file)} onCameraClick={() => openCamera('identityProofUrlBack')} preview={filePreviews.identityProofUrlBack} />}
                    {!employee.addressProofUrlFront && <ImageInputWithPreview label="Address Proof (Front)" onFileSelect={(file) => handleFileSelect('addressProofUrlFront', file)} onCameraClick={() => openCamera('addressProofUrlFront')} preview={filePreviews.addressProofUrlFront} />}
                    {!employee.addressProofUrlBack && <ImageInputWithPreview label="Address Proof (Back)" onFileSelect={(file) => handleFileSelect('addressProofUrlBack', file)} onCameraClick={() => openCamera('addressProofUrlBack')} preview={filePreviews.addressProofUrlBack} />}
                    {!employee.signatureUrl && <ImageInputWithPreview label="Signature" onFileSelect={(file) => handleFileSelect('signatureUrl', file)} onCameraClick={() => openCamera('signatureUrl')} isSignature={true} preview={filePreviews.signatureUrl} />}
                    {!employee.bankPassbookStatementUrl && <ImageInputWithPreview label="Bank Document" onFileSelect={(file) => handleFileSelect('bankPassbookStatementUrl', file)} onCameraClick={() => openCamera('bankPassbookStatement')} preview={filePreviews.bankPassbookStatementUrl} />}
                    {!employee.policeClearanceCertificateUrl && <ImageInputWithPreview label="Police Clearance Certificate" onFileSelect={(file) => handleFileSelect('policeClearanceCertificateUrl', file)} onCameraClick={() => openCamera('policeClearanceCertificate')} preview={filePreviews.policeClearanceCertificateUrl} />}
                </div>
                 {Object.values(employee).every(v => v) && <p className="text-muted-foreground text-center">All documents have been uploaded.</p>}
              </CardContent>
              <CardFooter className="flex justify-end">
                <Button onClick={handleSaveChanges} disabled={isSubmitting || Object.keys(filesToUpload).length === 0}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                </Button>
              </CardFooter>
          </Card>
        )}

        <Tabs defaultValue="personal">
            <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="personal"><User className="mr-2 h-4 w-4 hidden md:inline-block" />Personal</TabsTrigger>
            <TabsTrigger value="employment"><Briefcase className="mr-2 h-4 w-4 hidden md:inline-block" />Employment</TabsTrigger>
            <TabsTrigger value="bank"><Banknote className="mr-2 h-4 w-4 hidden md:inline-block" />Bank</TabsTrigger>
            <TabsTrigger value="identification"><ShieldCheck className="mr-2 h-4 w-4 hidden md:inline-block" />Identification</TabsTrigger>
            <TabsTrigger value="qr"><QrCode className="mr-2 h-4 w-4 hidden md:inline-block" />QR & Docs</TabsTrigger>
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
                    <DetailItem label="Employee ID" value={employee.employeeId} />
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
        </div>
        
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
    </>
  );
}
