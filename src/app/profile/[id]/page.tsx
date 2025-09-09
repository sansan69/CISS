

"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { type Employee } from '@/types/employee';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from '@/components/ui/separator';
import { User, Briefcase, Banknote, ShieldCheck, QrCode, FileUp, Download, Loader2, AlertCircle, ArrowLeft, Home } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { db, storage } from '@/lib/firebase';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getBytes, ref } from 'firebase/storage';
import QRCode from 'qrcode';


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

async function fetchImageBytes(url: string | undefined): Promise<Uint8Array | null> {
    if (!url) return null;
    try {
        const storageRef = ref(storage, url);
        return await getBytes(storageRef);
    } catch (error) {
        console.warn(`Could not fetch image at path: ${url}`, error);
        return null; // Gracefully fail if an image is missing
    }
}


export default function PublicEmployeeProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const employeeIdFromUrl = params.id as string;
  
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

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
    toast({ title: "Generating PDF...", description: "Please wait, this may take a moment." });

    try {
        const pdfDoc = await PDFDocument.create();
        const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
        const timesRomanBoldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

        // --- Page 1: Biodata ---
        let page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        const margin = 50;
        let y = height - margin;

        const profilePicBytes = await fetchImageBytes(employee.profilePictureUrl);
        if (profilePicBytes) {
            let image;
            try {
                if (profilePicBytes[0] === 0x89 && profilePicBytes[1] === 0x50 && profilePicBytes[2] === 0x4E && profilePicBytes[3] === 0x47) {
                    image = await pdfDoc.embedPng(profilePicBytes);
                } else {
                    image = await pdfDoc.embedJpg(profilePicBytes);
                }
                 page.drawImage(image, { x: width - margin - 100, y: height - margin - 120, width: 100, height: 120 });
            } catch (e) {
                console.warn("Could not embed profile picture:", e);
            }
        }
        
        page.drawText(employee.fullName, { x: margin, y: y, font: timesRomanBoldFont, size: 22 });
        y -= 40;
        page.drawText(`Employee ID: ${employee.employeeId}`, { x: margin, y, font: timesRomanFont, size: 12 });
        y -= 15;
        page.drawText(`Client: ${employee.clientName}`, { x: margin, y, font: timesRomanFont, size: 12 });
        y -= 30;

        page.drawText('Personal Details', { x: margin, y, font: timesRomanBoldFont, size: 14 });
        y -= 20;
        page.drawText(`Date of Birth: ${format(employee.dateOfBirth.toDate(), 'dd-MM-yyyy')}`, { x: margin, y, font: timesRomanFont, size: 11 });
        y -= 15;
        page.drawText(`Phone: ${employee.phoneNumber}`, { x: margin, y, font: timesRomanFont, size: 11 });
        y -= 15;
        page.drawText(`Address: ${employee.fullAddress}`, { x: margin, y, font: timesRomanFont, size: 11, maxWidth: width - margin * 2 - 130 });
        y -= 30;

        const qrDataURL = await QRCode.toDataURL(`${window.location.origin}/profile/${employee.id}`);
        const qrBytes = Buffer.from(qrDataURL.split(',')[1], 'base64');
        const qrImage = await pdfDoc.embedPng(qrBytes); // QR is always PNG
        page.drawImage(qrImage, { x: width - margin - 120, y: margin, width: 120, height: 120 });

        // --- Subsequent Pages: Documents ---
        const documents = [
            { url: employee.identityProofUrlFront || (employee as any).idProofDocumentUrlFront || (employee as any).idProofDocumentUrl },
            { url: employee.identityProofUrlBack || (employee as any).idProofDocumentUrlBack },
            { url: employee.addressProofUrlFront },
            { url: employee.addressProofUrlBack },
            { url: employee.signatureUrl },
            { url: employee.bankPassbookStatementUrl },
        ];

        for (const doc of documents) {
            if (!doc.url) continue;
            const imageBytes = await fetchImageBytes(doc.url);
            if (imageBytes) {
                page = pdfDoc.addPage();
                let image;
                 try {
                    if (imageBytes[0] === 0x89 && imageBytes[1] === 0x50 && imageBytes[2] === 0x4E && imageBytes[3] === 0x47) {
                        image = await pdfDoc.embedPng(imageBytes);
                    } else {
                        image = await pdfDoc.embedJpg(imageBytes);
                    }
                } catch (e) {
                     console.warn(`Could not embed image for ${doc.url}:`, e); continue;
                }
                const scale = 0.85;
                const imgWidth = page.getWidth() * scale;
                const imgHeight = page.getHeight() * scale;
                const aspectRatio = image.width / image.height;
                let finalWidth = imgWidth;
                let finalHeight = finalWidth / aspectRatio;
                if (finalHeight > imgHeight) { finalHeight = imgHeight; finalWidth = finalHeight * aspectRatio; }
                page.drawImage(image, { x: (page.getWidth() - finalWidth) / 2, y: (page.getHeight() - finalHeight) / 2, width: finalWidth, height: finalHeight });
            }
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CISS_ProfileKit_${employee.employeeId}.pdf`;
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
            description: error.message || "Could not generate the profile kit.",
            duration: 7000
        });
    } finally {
        setIsDownloadingPdf(false);
    }
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
              unoptimized={true}
              crossOrigin="anonymous"
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
            </div>
        </div>

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
      </div>
    </>
  );
}
