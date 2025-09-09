

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
const keralaDistricts = [ "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod" ];

async function fetchImageBytes(url: string | undefined): Promise<Uint8Array | null> {
    if (!url) return null;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`Could not fetch image at path: ${url}, status: ${response.status}`);
            return null;
        }
        return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
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
                const margin = 50;

                const drawText = (text: string, x: number, y: number, font: PDFFont, size: number, color = rgb(0, 0, 0)) => {
                    page.drawText(text || 'N/A', { x, y, font, size, color, maxWidth: 160, wordBreaks: [' '] });
                };
                
                // Header
                logoImage.scaleToFit(50, 50);
                page.drawImage(logoImage, { x: margin, y: height - margin - 50, width: 50, height: 50 });
                
                page.drawText(toTitleCase(employee.fullName), { x: margin + 65, y: height - margin - 25, font: helveticaBoldFont, size: 22, color: rgb(0.05, 0.2, 0.45) });
                page.drawText(`Employee ID: ${employee.employeeId}`, { x: margin + 65, y: height - margin - 45, font: helveticaFont, size: 10, color: rgb(0.3, 0.3, 0.3) });
                page.drawText(`Client: ${employee.clientName}`, { x: margin + 65, y: height - margin - 60, font: helveticaFont, size: 10, color: rgb(0.3, 0.3, 0.3) });
                
                const profilePicBytes = await fetchImageBytes(employee.profilePictureUrl);
                if (profilePicBytes) {
                    let image;
                    if (employee.profilePictureUrl?.toLowerCase().includes('.png')) {
                        image = await pdfDoc.embedPng(profilePicBytes);
                    } else {
                        image = await pdfDoc.embedJpg(profilePicBytes);
                    }
                    const imgDims = image.scaleToFit(80, 100);
                    page.drawImage(image, { x: width - margin - imgDims.width, y: height - margin - 100, width: imgDims.width, height: imgDims.height });
                    page.drawRectangle({x: width - margin - imgDims.width - 2, y: height - margin - 100 - 2, width: imgDims.width+4, height: imgDims.height+4, borderColor: rgb(0.9, 0.9, 0.9), borderWidth: 1});
                }
                
                let y = height - margin - 120;
                page.drawLine({ start: { x: margin, y: y }, end: { x: width - margin, y: y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
                y -= 25;

                // Helper to draw a section with a title and grid items
                const drawSection = (title: string, items: {label: string, value: any}[], startY: number): number => {
                    page.drawText(title, { x: margin, y: startY, font: helveticaBoldFont, size: 14, color: rgb(0.05, 0.2, 0.45) });
                    startY -= 25;

                    const col1X = margin;
                    const col2X = margin + 180;
                    const col3X = margin + 360;
                    
                    for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        const col = i % 3;
                        const x = col === 0 ? col1X : col === 1 ? col2X : col3X;
                        
                        drawText(item.label, x, startY, helveticaFont, 9, rgb(0.4, 0.4, 0.4));
                        drawText(toTitleCase(item.value) || 'N/A', x, startY - 15, helveticaFont, 11);

                        if ((i + 1) % 3 === 0) {
                            startY -= 45;
                        }
                    }
                    if (items.length % 3 !== 0) {
                        startY -= 45;
                    }
                    
                    startY -= 10;
                    page.drawLine({ start: { x: margin, y: startY + 5 }, end: { x: width - margin, y: startY + 5 }, thickness: 0.2, color: rgb(0.85, 0.85, 0.85) });
                    startY -= 5;
                    
                    return startY;
                };

                const personalItems = [
                    { label: 'Date of Birth', value: format(employee.dateOfBirth.toDate(), 'dd-MM-yyyy') },
                    { label: 'Gender', value: employee.gender },
                    { label: 'Marital Status', value: employee.maritalStatus },
                    { label: "Father's Name", value: employee.fatherName },
                    { label: "Mother's Name", value: employee.motherName },
                    ...(employee.maritalStatus === 'Married' ? [{ label: "Spouse's Name", value: employee.spouseName }] : []),
                    { label: "Educational Qualification", value: employee.educationalQualification === 'Any Other Qualification' ? employee.otherQualification : employee.educationalQualification },
                    { label: "Phone Number", value: employee.phoneNumber },
                    { label: "Email Address", value: employee.emailAddress },
                    { label: "District", value: employee.district },
                    { label: "Full Address", value: employee.fullAddress },
                ];
                y = drawSection("Personal & Contact Information", personalItems, y);

                const employmentItems = [
                    { label: "Joining Date", value: format(employee.joiningDate.toDate(), 'dd-MM-yyyy') },
                    { label: "Status", value: employee.status },
                    ...(employee.status === 'Exited' && employee.exitDate ? [{ label: "Exit Date", value: format(employee.exitDate.toDate(), 'dd-MM-yyyy') }] : []),
                    { label: "Resource ID (if any)", value: employee.resourceIdNumber },
                ];
                y = drawSection("Employment & Status", employmentItems, y);
                
                const statutoryItems = [
                    { label: "PAN Number", value: employee.panNumber },
                    { label: "EPF / UAN", value: employee.epfUanNumber },
                    { label: "ESIC Number", value: employee.esicNumber },
                    { label: "Bank Name", value: employee.bankName },
                    { label: "Bank Account No.", value: employee.bankAccountNumber },
                    { label: "Bank IFSC Code", value: employee.ifscCode },
                    { label: "Identity Proof", value: `${employee.identityProofType || legacy.idProofType} - ${employee.identityProofNumber || legacy.idProofNumber}`},
                    { label: "Address Proof", value: `${employee.addressProofType} - ${employee.addressProofNumber}`},
                ];
                y = drawSection("Bank & Statutory Details", statutoryItems, y);

                // --- Page 2: QR Code ---
                if (employee.qrCodeUrl) {
                    try {
                        const qrPage = pdfDoc.addPage();
                        const qrImageBytes = await fetchImageBytes(employee.qrCodeUrl);
                        if (qrImageBytes) {
                            const qrImage = await pdfDoc.embedPng(qrImageBytes);
                            const qrDims = qrImage.scaleToFit(qrPage.getWidth() - margin * 4, qrPage.getHeight() - margin * 4);
                            qrPage.drawText("Employee QR Code", { x: margin, y: qrPage.getHeight() - margin, font: helveticaBoldFont, size: 14 });
                            qrPage.drawImage(qrImage, {
                                x: (qrPage.getWidth() - qrDims.width) / 2,
                                y: (qrPage.getHeight() - qrDims.height) / 2,
                                width: qrDims.width,
                                height: qrDims.height,
                            });
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
                let tcY = tcPage.getHeight() - margin;

                const drawTcTitle = (text: string) => {
                    tcPage.drawText(text, { x: margin, y: tcY, font: helveticaBoldFont, size: 12 });
                    tcY -= 20;
                };
                const drawTcText = (text: string) => {
                    tcPage.drawText(text, { x: margin + 15, y: tcY, font: helveticaFont, size: 10, lineHeight: 14, maxWidth: width - (margin * 2) - 15});
                    const textHeight = helveticaFont.heightAtSize(10, {lineHeight: 14}) * text.split('\n').length;
                    tcY -= textHeight + 5;
                };

                tcPage.drawText("Terms & Conditions of Enrollment for Security Personnel", { x: margin, y: tcY, font: helveticaBoldFont, size: 16, color: rgb(0.05, 0.2, 0.45) });
                tcY -= 30;

                drawTcTitle("I. General Eligibility and Compliance");
                drawTcText("• I confirm I meet the eligibility criteria under the PSARA Act, 2005 and Kerala state rules, including age (18-65), physical fitness, and Indian citizenship.\n• I understand my enrollment is provisional and subject to a successful background and character verification by the relevant authorities.\n• I agree to complete all mandatory training and refresher courses as required by the company and regulatory bodies.");
                tcY -= 15;
                
                drawTcTitle("II. Employment Terms & Responsibilities");
                drawTcText("• My employment terms, including working hours, wages, and leaves, will be governed by applicable labour laws.\n• I will perform my duties diligently, maintain strict discipline, protect client property, and follow all lawful instructions.\n• I will maintain strict confidentiality of all client and company information and will not disclose it to any unauthorized person.\n• I will report for duty on time, in uniform, and will not consume intoxicating substances on duty, use unauthorized force, or abandon my post without proper relief.");
                tcY -= 15;

                drawTcTitle("III. Disciplinary Action");
                drawTcText("• I understand that any breach of these terms, misconduct, or violation of laws can lead to disciplinary action, up to and including termination of employment.");
                tcY -= 15;
                
                drawTcTitle("IV. Declaration");
                drawTcText("I hereby declare that I have read, understood, and agree to abide by all the terms and conditions stated above for my enrollment. I confirm that all information and documents provided by me are true and correct to the best of my knowledge.");
                tcY -= 40;

                // Add Signature
                const signatureBytes = await fetchImageBytes(employee.signatureUrl);
                if (signatureBytes) {
                    let signatureImage;
                    try {
                        if (employee.signatureUrl?.toLowerCase().includes('.png') || (signatureBytes[0] === 0x89 && signatureBytes[1] === 0x50 && signatureBytes[2] === 0x4E && signatureBytes[3] === 0x47)) {
                            signatureImage = await pdfDoc.embedPng(signatureBytes);
                        } else {
                            signatureImage = await pdfDoc.embedJpg(signatureBytes);
                        }
                        const sigDims = signatureImage.scaleToFit(120, 60);
                        tcPage.drawImage(signatureImage, {
                            x: width - margin - sigDims.width,
                            y: tcY,
                            width: sigDims.width,
                            height: sigDims.height,
                        });
                        tcY -= (sigDims.height + 5);
                         tcPage.drawLine({ start: { x: width - margin - 120, y: tcY }, end: { x: width - margin, y: tcY }, thickness: 0.5 });
                         tcY -= 15;
                         tcPage.drawText("Signature of Applicant", { x: width - margin - 120, y: tcY, font: helveticaFont, size: 8, color: rgb(0.4, 0.4, 0.4) });

                    } catch (sigError) {
                         console.error("Could not embed signature", sigError);
                    }
                }

                const pdfBytes = await pdfDoc.save();
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const blobUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = `CISS_ProfileKit_${employee.employeeId}.pdf`;
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
