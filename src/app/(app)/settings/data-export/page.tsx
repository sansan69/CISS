

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
        const storageRef = ref(storage, url);
        return await getBytes(storageRef);
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
                    page.drawText(text, { x, y, font, size, color });
                };
                
                // Header
                logoImage.scaleToFit(50, 50);
                page.drawImage(logoImage, { x: margin, y: height - margin - 50, width: 50, height: 50 });
                
                drawText(toTitleCase(employee.fullName), margin + 65, height - margin - 25, helveticaBoldFont, 22, rgb(0.05, 0.2, 0.45));
                drawText(`Employee ID: ${employee.employeeId}`, margin + 65, height - margin - 45, helveticaFont, 10, rgb(0.3, 0.3, 0.3));
                drawText(`Client: ${employee.clientName}`, margin + 65, height - margin - 60, helveticaFont, 10, rgb(0.3, 0.3, 0.3));
                
                const profilePicBytes = await fetchImageBytes(employee.profilePictureUrl);
                if (profilePicBytes) {
                    let image;
                     if (profilePicBytes[0] === 0x89 && profilePicBytes[1] === 0x50 && profilePicBytes[2] === 0x4E && profilePicBytes[3] === 0x47) {
                         image = await pdfDoc.embedPng(profilePicBytes);
                    } else {
                         image = await pdfDoc.embedJpg(profilePicBytes);
                    }
                    const imgDims = image.scaleToFit(80, 100);
                    page.drawImage(image, { x: width - margin - imgDims.width, y: height - margin - 100, width: imgDims.width, height: imgDims.height });
                    page.drawRectangle({x: width - margin - imgDims.width - 2, y: height - margin - 100 - 2, width: imgDims.width+4, height: imgDims.height+4, borderColor: rgb(0.9, 0.9, 0.9), borderWidth: 1});
                }
                
                let y = height - margin - 110;
                page.drawLine({ start: { x: margin, y: y }, end: { x: width - margin, y: y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
                y -= 30;

                drawText('Personal & Contact Information', margin, y, helveticaBoldFont, 14, rgb(0.05, 0.2, 0.45));
                y -= 25;

                const col1X = margin;
                const col2X = margin + 170;
                const col3X = margin + 340;
                
                const drawGridItem = (label: string, value: string, x: number, yPos: number) => {
                    drawText(label, x, yPos, helveticaFont, 9, rgb(0.4, 0.4, 0.4));
                    drawText(toTitleCase(value) || 'N/A', x, yPos - 15, helveticaFont, 11);
                };
                
                drawGridItem('Date of Birth', format(employee.dateOfBirth.toDate(), 'dd-MM-yyyy'), col1X, y);
                drawGridItem('Gender', employee.gender, col2X, y);
                drawGridItem('Marital Status', employee.maritalStatus, col3X, y);
                y -= 45;

                drawGridItem("Father's Name", employee.fatherName, col1X, y);
                drawGridItem("Mother's Name", employee.motherName, col2X, y);
                drawGridItem("Educational Qualification", employee.educationalQualification === 'Any Other Qualification' ? (employee.otherQualification || 'N/A') : (employee.educationalQualification || 'N/A'), col3X, y);
                y -= 45;
                
                drawGridItem("Phone Number", employee.phoneNumber, col1X, y);
                drawGridItem("Email Address", employee.emailAddress, col2X, y);
                drawGridItem("District", employee.district, col3X, y);
                y -= 45;
                
                drawGridItem("Full Address", employee.fullAddress, col1X, y);

                // --- Documents ---
                 const documents = [
                    { url: employee.identityProofUrlFront || legacy.idProofDocumentUrlFront || legacy.idProofDocumentUrl, title: "Identity Proof (Front)"},
                    { url: employee.identityProofUrlBack || legacy.idProofDocumentUrlBack, title: "Identity Proof (Back)"},
                    { url: employee.addressProofUrlFront, title: "Address Proof (Front)" },
                    { url: employee.addressProofUrlBack, title: "Address Proof (Back)"},
                    { url: employee.signatureUrl, title: "Signature" },
                    { url: employee.bankPassbookStatementUrl, title: "Bank Document" },
                ];

                for (const doc of documents) {
                    if (!doc.url) continue;
                    const imageBytes = await fetchImageBytes(doc.url);
                    if (imageBytes) {
                        const docPage = pdfDoc.addPage();
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
                           {generationSessionId" value={employee.dateOfBirth} isDate />
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
