

"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadCloud, AlertTriangle, Loader2, FileSpreadsheet, CalendarIcon, Filter, CheckCircle, ChevronLeft, FileText } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, where, Timestamp } from 'firebase/firestore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { Label } from '@/components/ui/label';
import * as XLSX from 'xlsx';
import type { Employee } from '@/types/employee';
import Link from 'next/link';
import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import { getBytes, ref } from 'firebase/storage';

interface ClientOption { id: string; name: string; }
// Keep this list in sync with the enrollment and edit profile forms.
const keralaDistricts = [
  "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha",
  "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad",
  "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod", "Lakshadweep"
];

async function fetchImageBytes(url: string | undefined): Promise<Uint8Array | null> {
    if (!url) return null;
    try {
        const storageRef = ref(storage, url);
        const bytes = await getBytes(storageRef);
        return new Uint8Array(bytes);
    } catch (error: any) {
        if (error.code === 'storage/object-not-found') {
            console.warn(`Image not found at path: ${url}. Attempting direct fetch.`);
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    console.error(`Direct fetch failed for ${url}: ${response.statusText}`);
                    return null;
                }
                const blob = await response.blob();
                return new Uint8Array(await blob.arrayBuffer());
            } catch (fetchError) {
                console.error(`Direct fetch also failed for ${url}:`, fetchError);
                return null;
            }
        }
        console.warn(`Could not fetch image at path: ${url}`, error);
        return null;
    }
}

const toTitleCase = (str: string | null | undefined): string => {
    if (!str) return '';
    if (str.includes('@')) return str.toLowerCase();
    if (str.toUpperCase() === str) {
        return str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
    }
    return str.replace(/\b\w/g, char => char.toUpperCase());
};

export default function DataExportPage() {
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationStatus, setGenerationStatus] = useState<'idle' | 'generating' | 'complete' | 'error'>('idle');
    const [processedCount, setProcessedCount] = useState(0);
    const [totalCount, setTotalCount] = useState(0);

    const { toast } = useToast();

    // Filters State
    const [exportType, setExportType] = useState<'xlsx' | 'pdf'>('xlsx');
    const [clients, setClients] = useState<ClientOption[]>([]);
    const [selectedClient, setSelectedClient] = useState<string>('all');
    const [selectedDistrict, setSelectedDistrict] = useState<string>('all');
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

    useEffect(() => {
        const fetchClients = async () => {
            try {
                const clientsSnapshot = await getDocs(query(collection(db, 'clients'), orderBy('name')));
                setClients(clientsSnapshot.docs.map(docSnap => ({ id: docSnap.id, name: docSnap.data().name as string })));
            } catch (err) {
                toast({ variant: "destructive", title: "Error", description: "Could not fetch client list for filters." });
            }
        };
        fetchClients();
    }, [toast]);

    const handleExport = async () => {
        setIsGenerating(true);
        setGenerationStatus('generating');
        setProcessedCount(0);
        setTotalCount(0);
        
        if (exportType === 'xlsx') {
            await handleXlsxExport();
        } else {
            await handlePdfExport();
        }

        setIsGenerating(false);
    };

    const handleXlsxExport = async () => {
        toast({ title: "Generating XLSX Export...", description: "Fetching employee data from the database." });
        try {
            let employeesQuery = query(collection(db, "employees"));
            if (selectedClient !== 'all') employeesQuery = query(employeesQuery, where('clientName', '==', selectedClient));
            if (selectedDistrict !== 'all') employeesQuery = query(employeesQuery, where('district', '==', selectedDistrict));
            if (dateRange?.from) employeesQuery = query(employeesQuery, where('joiningDate', '>=', Timestamp.fromDate(dateRange.from)));
            if (dateRange?.to) {
                const toDate = new Date(dateRange.to);
                toDate.setHours(23, 59, 59, 999);
                employeesQuery = query(employeesQuery, where('joiningDate', '<=', Timestamp.fromDate(toDate)));
            }
            
            const querySnapshot = await getDocs(employeesQuery);
            setTotalCount(querySnapshot.size);

            if (querySnapshot.empty) {
                toast({ variant: 'default', title: "No Data", description: "No employees found for the selected filters." });
                setGenerationStatus('error');
                return;
            }

            toast({ title: "Processing Data...", description: `Found ${querySnapshot.size} records to export.` });

            const employeesData: any[] = querySnapshot.docs.map(doc => {
                const docData = doc.data();
                const processedRecord: {[key: string]: any} = {};
                Object.keys(docData).forEach(key => {
                    if (docData[key] instanceof Timestamp) {
                        processedRecord[key] = docData[key].toDate().toISOString().split("T")[0];
                    } else if (key !== 'searchableFields' && key !== 'publicProfile') {
                        processedRecord[key] = docData[key];
                    }
                });
                setProcessedCount(prev => prev + 1);
                return { id: doc.id, ...processedRecord };
            });
            
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.json_to_sheet(employeesData);
            XLSX.utils.book_append_sheet(workbook, worksheet, "Employees");
            XLSX.writeFile(workbook, `CISS_Export_${new Date().toISOString().split('T')[0]}.xlsx`);

            setGenerationStatus('complete');
            toast({ variant: 'default', title: "Export Ready!", description: `Successfully exported ${employeesData.length} records.` });

        } catch (error: any) {
            console.error("Error during XLSX export:", error);
            toast({ variant: "destructive", title: "Export Failed", description: "An error occurred during export." });
            setGenerationStatus('error');
        }
    };
    
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const handlePdfExport = async () => {
        if (selectedClient === 'all') {
            toast({ variant: 'destructive', title: "Client Not Selected", description: "Please select a specific client to export Profile Kits." });
            setGenerationStatus('idle');
            return;
        }
        
        toast({ title: "Fetching Employees...", description: `Getting all employees for ${selectedClient}.` });
        let employeesQuery = query(collection(db, "employees"), where('clientName', '==', selectedClient));
        if (selectedDistrict !== 'all') {
            employeesQuery = query(employeesQuery, where('district', '==', selectedDistrict));
        }
        const querySnapshot = await getDocs(employeesQuery);
        setTotalCount(querySnapshot.size);

        if (querySnapshot.empty) {
             toast({ variant: 'default', title: "No Data", description: `No employees found for client: ${selectedClient}.` });
             setGenerationStatus('error');
             return;
        }

        const employeesToExport = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
        toast({ title: `Starting PDF Generation for ${employeesToExport.length} Employees`, description: "This may take some time. Please keep this tab open and approve the multiple file downloads." });
        
        // --- Helpers copied from profile kit generators ---
        function normalizePdfText(input: unknown) {
            let s = (input ?? '').toString();
            s = s.replace(/\r\n/g, '\n');
            s = s.replace(/\r/g, '\n');
            s = s.replace(/\u00A0/g, ' ');
            s = s.replace(/\t/g, ' ');
            s = s.replace(/[\u2028\u2029]/g, ' ');
            return s;
        }
        function sanitizePdfString(input: unknown): string {
            const s = normalizePdfText(input);
            return s.replace(/\n/g, ' ');
        }
        function wrapTextToWidth(text: string, font: any, fontSize: number, maxWidth: number) {
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
                lines.push(line || '');
            }
            return lines;
        }
        function drawMultilineText(opts: { page: any; text: string; font: any; fontSize: number; x: number; y: number; maxWidth: number; lineHeight?: number; color?: any; }) {
            const { page, text, font, fontSize, x, y, maxWidth, lineHeight = fontSize * 1.2, color } = opts;
            const lines = wrapTextToWidth(text, font, fontSize, maxWidth);
            let yy = y;
            for (const line of lines) {
                page.drawText(line, { x, y: yy, size: fontSize, font, color });
                yy -= lineHeight;
            }
            return yy;
        }
        function detectFormat(bytes: Uint8Array, url?: string): 'png' | 'jpg' | 'pdf' | 'webp' | 'unknown' {
            const ext = (url || '').toLowerCase();
            if (ext.endsWith('.png')) return 'png';
            if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'jpg';
            if (ext.endsWith('.pdf')) return 'pdf';
            // magic numbers
            if (bytes.length >= 4) {
                if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
                if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
                if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
                if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'webp'; // RIFF (likely WEBP)
            }
            return 'unknown';
        }
        const base64ToUint8Array = (base64: string): Uint8Array => {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return bytes;
        };

        for (let i = 0; i < employeesToExport.length; i++) {
            const employee = employeesToExport[i];
            const legacy = employee as any;
            setProcessedCount(prev => prev + 1);

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
                        const fmt = detectFormat(profilePicBytes, employee.profilePictureUrl);
                        if (fmt === 'png') image = await pdfDoc.embedPng(profilePicBytes);
                        else if (fmt === 'jpg') image = await pdfDoc.embedJpg(profilePicBytes);
                        else throw new Error(`Unsupported image format for profile picture: ${fmt}`);
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
                    { label: 'Gender', value: employee.gender },
                    { label: "Father's Name", value: employee.fatherName },
                    { label: "Mother's Name", value: employee.motherName },
                    { label: 'Marital Status', value: employee.maritalStatus },
                    ...(employee.maritalStatus === 'Married' ? [{ label: "Spouse's Name", value: employee.spouseName }] : [{label: "Spouse's Name", value: 'N/A'}]),
                    { label: "Educational Qualification", value: employee.educationalQualification === 'Any Other Qualification' ? employee.otherQualification : employee.educationalQualification },
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
                const addressTextHeight = drawMultilineText({ page, text: toTitleCase(sanitizePdfString(employee.fullAddress)), x: margin, y: addressY - 15, maxWidth: width - margin * 2, font: helveticaFont, fontSize: 11 });
                y = addressTextHeight - 25;

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
                            const qrPngBytes = base64ToUint8Array(qrPngBase64);
                            const qrImage = await pdfDoc.embedPng(qrPngBytes);
                            const qrDims = qrImage.scaleToFit(300, 300);

                            const title = "Employee QR Code for Attendance";
                            const titleWidth = helveticaBoldFont.widthOfTextAtSize(title, 16);
                            qrPage.drawText(title, {
                                x: (pageW - titleWidth) / 2,
                                y: pageH - margin - 50,
                                font: helveticaBoldFont,
                                size: 16,
                                color: rgb(0.05, 0.2, 0.45)
                            });
                            
                            const qrBoxY = pageH - margin - 80 - qrDims.height - 10;
                            qrPage.drawRectangle({
                                x: (pageW - qrDims.width) / 2 - 10,
                                y: qrBoxY,
                                width: qrDims.width + 20,
                                height: qrDims.height + 20,
                                borderColor: rgb(0.8, 0.8, 0.8),
                                borderWidth: 1,
                            });

                            qrPage.drawImage(qrImage, {
                                x: (pageW - qrDims.width) / 2,
                                y: qrBoxY + 10,
                                width: qrDims.width,
                                height: qrDims.height,
                            });
                            
                            let instructionsY = qrBoxY - 40;
                            
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
                              "4. Follow on-screen instructions to capture your photo and location to complete check-in/out."
                            ];

                            for(const instruction of instructions) {
                                const instructionWidth = helveticaFont.widthOfTextAtSize(instruction, 10);
                                qrPage.drawText(instruction, {
                                    x: (pageW - instructionWidth) / 2,
                                    y: instructionsY,
                                    font: helveticaFont,
                                    size: 10,
                                    lineHeight: 14
                                });
                                instructionsY -= 20;
                            }
                        }
                    } catch (qrError) {
                        console.error("Could not embed QR code:", qrError);
                    }
                }

                // --- Documents ---
                 const documents = [
                    { url: employee.identityProofUrlFront || legacy.idProofDocumentUrlFront || legacy.idProofDocumentUrl, title: "Identity Proof (Front)"},
                    { url: employee.identityProofUrlBack || legacy.idProofDocumentUrlBack, title: "Identity Proof (Back)"},
                    { url: employee.addressProofUrlFront, title: "Address Proof (Front)" },
                    { url: employee.addressProofUrlBack, title: "Address Proof (Back)"},
                    { url: employee.bankPassbookStatementUrl, title: "Bank Document" },
                    { url: employee.policeClearanceCertificateUrl, title: "Police Clearance Certificate" },
                ];

                for (const docItem of documents) {
                    if (!docItem.url) continue;
                    const imageBytes = await fetchImageBytes(docItem.url);
                    if (!imageBytes) continue;

                    const fmt = detectFormat(imageBytes, docItem.url);
                    const docPage = pdfDoc.addPage();
                    if (fmt === 'pdf' || fmt === 'webp' || fmt === 'unknown') {
                        // Unsupported for embedding; add a placeholder note instead of throwing
                        docPage.drawText(docItem.title, { x: margin, y: docPage.getHeight() - margin, font: helveticaBoldFont, size: 14});
                        const notice = fmt === 'pdf' ? 'Attached document is a PDF (preview not supported in kit).' : 'Attached document format not supported for inline preview.';
                        drawMultilineText({ page: docPage, text: notice, font: helveticaFont, fontSize: 11, x: margin, y: docPage.getHeight() - margin - 30, maxWidth: docPage.getWidth() - margin * 2 });
                        continue;
                    }
                    try {
                        let image;
                        if (fmt === 'png') image = await pdfDoc.embedPng(imageBytes);
                        else image = await pdfDoc.embedJpg(imageBytes);
                        docPage.drawText(docItem.title, { x: margin, y: docPage.getHeight() - margin, font: helveticaBoldFont, size: 14});
                        const { width: pageWidth, height: pageHeight } = docPage.getSize();
                        const dims = image.scaleToFit(pageWidth - margin * 2, pageHeight - margin * 2 - 50);
                        docPage.drawImage(image, {
                            x: (pageWidth - dims.width) / 2,
                            y: (pageHeight - dims.height - 50) / 2,
                            width: dims.width,
                            height: dims.height,
                        });
                    } catch (e) {
                        console.error(`Could not embed image for ${docItem.url}:`, e);
                        docPage.drawText(`Error embedding document: ${docItem.title}`, { x: margin, y: docPage.getHeight() - margin, font: helveticaBoldFont, size: 14, color: rgb(1,0,0)});
                    }
                }
                
                // --- Last Page: Terms and Conditions ---
                const tcPage = pdfDoc.addPage();
                const tcWidth = tcPage.getWidth();
                let tcY = tcPage.getHeight() - margin;

                const drawTcTitle = (text: string) => {
                    tcPage.drawText(text, { x: margin, y: tcY, font: helveticaBoldFont, size: 11 });
                    tcY -= 20;
                };
                const drawTcText = (text: string) => {
                    const lines = text.split('\n');
                    for(const line of lines) {
                        tcPage.drawText(line, { x: margin + 15, y: tcY, font: helveticaFont, size: 9.5, lineHeight: 14 });
                        tcY -= 14;
                    }
                };

                const tcTitle = "Terms & Conditions";
                tcPage.drawText(tcTitle, { x: (tcWidth - helveticaBoldFont.widthOfTextAtSize(tcTitle, 16))/2, y: tcY, font: helveticaBoldFont, size: 16, color: rgb(0.05, 0.2, 0.45) });
                tcY -= 40;

                drawTcTitle("I. General Eligibility and Compliance");
                drawTcText("• I confirm I meet the eligibility criteria under the PSARA Act, 2005 and Kerala state rules, including age (18-65),\n  physical fitness, and Indian citizenship.\n• I understand my enrollment is provisional and subject to a successful background and character verification by the\n  relevant authorities.\n• I agree to complete all mandatory training and refresher courses as required by the company and regulatory bodies.");
                tcY -= 15;
                
                drawTcTitle("II. Employment Terms & Responsibilities");
                drawTcText("• My employment terms, including working hours, wages, and leaves, will be governed by applicable labour laws.\n• I will perform my duties diligently, maintain strict discipline, protect client property, and follow all lawful instructions.\n• I will maintain strict confidentiality of all client and company information and will not disclose it to any unauthorized person.\n• I will report for duty on time, in uniform, and will not consume intoxicating substances on duty, use unauthorized force,\n  or abandon my post without proper relief.");
                tcY -= 15;

                drawTcTitle("III. Disciplinary Action");
                drawTcText("• I understand that any breach of these terms, misconduct, or violation of laws can lead to disciplinary action, up to\n  and including termination of employment.");
                tcY -= 15;
                
                drawTcTitle("IV. Declaration");
                drawTcText("I hereby declare that I have read, understood, and agree to abide by all the terms and conditions stated above for my\nenrollment. I confirm that all information and documents provided by me are true and correct to the best of my\nknowledge.");
                tcY -= 70;

                // Add Signature anchored bottom-right
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
                const blobUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                
                const formattedJoiningDate = format(employee.joiningDate.toDate(), 'yyyy-MM-dd');
                const cleanFullName = employee.fullName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
                const cleanClientName = employee.clientName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
                const fileName = `ProfileKit_${cleanFullName}_${cleanClientName}_${formattedJoiningDate}.pdf`;
                a.download = fileName;
        
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(blobUrl);

                toast({ title: `Generated Kit for ${employee.fullName} (${i+1}/${employeesToExport.length})` });
                await sleep(500); // Small delay between downloads

            } catch (err: any) {
                console.error(`Failed to generate PDF for ${employee.fullName}:`, err);
                toast({ variant: 'destructive', title: 'PDF Generation Failed', description: `Could not generate kit for ${employee.fullName}. ${err.message}` });
            }
        }
        
        setGenerationStatus('complete');
        toast({ variant: 'default', title: "Bulk Export Complete!", description: `Finished processing all selected employees.` });
    };

    return (
        <>
            <div className="flex flex-col gap-6">
                <div className="flex items-center gap-4">
                    <Button variant="outline" size="icon" asChild><Link href="/settings"><ChevronLeft className="h-4 w-4" /><span className="sr-only">Back to Settings</span></Link></Button>
                    <h1 className="text-3xl font-bold tracking-tight">Export Employee Data</h1>
                </div>

                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" /><AlertTitle>Warning: Security and Data Privacy</AlertTitle>
                    <AlertDescription>You are about to generate files containing sensitive employee data. Handle downloaded files securely and in accordance with your company's privacy policy.</AlertDescription>
                </Alert>

                <Card>
                    <CardHeader>
                        <CardTitle>Start Data Export</CardTitle>
                        <CardDescription>Select export type and apply filters, then click the button to generate the files.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                               <Label htmlFor="export-type">Export Type</Label>
                               <Select value={exportType} onValueChange={(v) => setExportType(v as 'xlsx' | 'pdf')}>
                                   <SelectTrigger id="export-type"><SelectValue /></SelectTrigger>
                                   <SelectContent>
                                       <SelectItem value="xlsx"><FileSpreadsheet className="inline-block mr-2 h-4 w-4" />Employee Data (XLSX)</SelectItem>
                                       <SelectItem value="pdf"><FileText className="inline-block mr-2 h-4 w-4" />Profile Kits (PDF)</SelectItem>
                                   </SelectContent>
                               </Select>
                            </div>
                        </div>

                        {exportType === 'pdf' &&
                            <Alert>
                                <AlertTriangle className="h-4 w-4" /><AlertTitle>PDF Export Requirement</AlertTitle>
                                <AlertDescription>For bulk PDF generation, you must select a specific client. This prevents browser overload. Your browser will also ask for permission to download multiple files.</AlertDescription>
                            </Alert>
                        }

                        <div className="p-4 border rounded-md space-y-4">
                            <h3 className="font-semibold flex items-center gap-2"><Filter className="h-4 w-4" />Filters (Optional)</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="space-y-2">
                                   <Label htmlFor="client-filter">Filter by Client</Label>
                                   <Select value={selectedClient} onValueChange={setSelectedClient}>
                                       <SelectTrigger id="client-filter"><SelectValue /></SelectTrigger>
                                       <SelectContent>
                                           <SelectItem value="all">All Clients</SelectItem>
                                           {clients.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                                       </SelectContent>
                                   </Select>
                                </div>
                                 <div className="space-y-2">
                                   <Label htmlFor="district-filter">Filter by District</Label>
                                   <Select value={selectedDistrict} onValueChange={setSelectedDistrict}>
                                       <SelectTrigger id="district-filter"><SelectValue /></SelectTrigger>
                                       <SelectContent>
                                           <SelectItem value="all">All Districts</SelectItem>
                                           {keralaDistricts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                       </SelectContent>
                                   </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="date-range">Filter by Joining Date</Label>
                                     <Popover>
                                        <PopoverTrigger asChild><Button id="date-range" variant={"outline"} className="w-full justify-start text-left font-normal"><CalendarIcon className="mr-2 h-4 w-4" />{dateRange?.from ? ( dateRange.to ? (<> {format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")} </>) : (format(dateRange.from, "LLL dd, y"))) : (<span>Pick a date range</span>) }</Button></PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start"><Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} /></PopoverContent>
                                    </Popover>
                                </div>
                            </div>
                        </div>
                         <Button onClick={handleExport} disabled={isGenerating}>
                            {isGenerating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating ({processedCount}/{totalCount})...</>
                            : <><DownloadCloud className="mr-2 h-4 w-4" />Generate and Download</>}
                        </Button>
                    </CardContent>

                    {generationStatus !== 'idle' && (
                        <CardFooter>
                           {generationStatus === 'generating' && <Alert><Loader2 className="h-4 w-4 animate-spin" /><AlertTitle>Processing...</AlertTitle><AlertDescription>Your export is being generated. Processed {processedCount} of {totalCount} records.</AlertDescription></Alert>}
                           {generationStatus === 'complete' && <Alert variant="default" className="bg-green-50 border-green-200"><CheckCircle className="h-4 w-4 text-green-600" /><AlertTitle className="text-green-800">Export Complete</AlertTitle><AlertDescription className="text-green-700">The file(s) should be in your downloads folder.</AlertDescription></Alert>}
                           {generationStatus === 'error' && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Export Error</AlertTitle><AlertDescription>The export could not be completed. Please check the console for details.</AlertDescription></Alert>}
                        </CardFooter>
                    )}
                </Card>
            </div>
        </>
    );
}
