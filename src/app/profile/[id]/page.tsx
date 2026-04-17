

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
import { storage } from '@/lib/firebase';
import { Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import { getBytes, ref } from 'firebase/storage';
import QRCode from 'qrcode';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

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
      // The Firebase Storage SDK is the most reliable way to fetch storage objects
      // as it handles authentication and permissions gracefully.
      const storageRef = ref(storage, url);
      const bytes = await getBytes(storageRef);
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
        const res = await fetch(`/api/employees/public-profile/${employeeIdFromUrl}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Employee not found.");
          toast({ variant: "destructive", title: "Not Found", description: data.error || "No employee record found for this ID."});
          return;
        }
        const data = await res.json();
        const formattedData: Employee = {
          ...data,
          id: employeeIdFromUrl,
        } as Employee;
        setEmployee(formattedData);
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
        drawMultilineText({ page, text: toTitleCase(employee.fullAddress), x: margin, y: addressY - 15, maxWidth: width - margin * 2, font: helveticaFont, fontSize: 11 });
        // Estimate height, this is not perfect but better than nothing
        const addressLines = wrapTextToWidth(toTitleCase(employee.fullAddress), helveticaFont, 11, width-margin*2).length;
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
        
        const formattedJoiningDate = format(employee.joiningDate.toDate(), 'yyyy-MM-dd');
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

  if (isLoading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-lg">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col items-start gap-4 mt-1">
              <span>{error}</span>
              <Button onClick={() => router.push('/')}>
                <Home className="mr-2 h-4 w-4" />Back to Home
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Alert variant="default" className="max-w-lg">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Employee Not Found</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col items-start gap-4 mt-1">
              <span>The requested employee profile could not be found.</span>
              <Button onClick={() => router.push('/')}>
                <Home className="mr-2 h-4 w-4" />Back to Home
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
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

    
