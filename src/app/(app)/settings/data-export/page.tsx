
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadCloud, AlertTriangle, Loader2, FileSpreadsheet, CalendarIcon, Filter, CheckCircle, ChevronLeft, FileText } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
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
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import Image from 'next/image';

interface ClientOption { id: string; name: string; }
const keralaDistricts = [ "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod" ];

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

const toTitleCase = (str: string | null | undefined): string => {
    if (!str) return '';
    if (str.includes('@')) return str.toLowerCase();
    if (str.toUpperCase() === str) {
        return str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
    }
    return str.replace(/\b\w/g, char => char.toUpperCase());
};

const BiodataPage = React.forwardRef<HTMLDivElement, { employee: Employee; pageNumber: number }>(({ employee, pageNumber }, ref) => (
  <div ref={ref} style={pageStyle}>
     <header className="flex justify-between items-start pb-4 border-b border-gray-300">
      <div className="flex items-center gap-4">
        <Image src="/ciss-logo.png" alt="CISS Logo" width={60} height={60} unoptimized={true} crossOrigin="anonymous" data-ai-hint="company logo"/>
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
      <section><h2 className="text-lg font-semibold text-blue-700 border-b pb-2 mb-4">Personal & Contact Information</h2><div className="grid grid-cols-3 gap-x-6 gap-y-4"><DetailGridItem label="Date of Birth" value={formatDateForPdf(employee.dateOfBirth)} /><DetailGridItem label="Gender" value={employee.gender} /><DetailGridItem label="Marital Status" value={employee.maritalStatus} /><DetailGridItem label="Father's Name" value={toTitleCase(employee.fatherName)} /><DetailGridItem label="Mother's Name" value={toTitleCase(employee.motherName)} />{employee.maritalStatus === 'Married' && <DetailGridItem label="Spouse's Name" value={toTitleCase(employee.spouseName)} />}<DetailGridItem label="Educational Qualification" value={employee.educationalQualification === 'Any Other Qualification' ? employee.otherQualification : employee.educationalQualification} /><DetailGridItem label="Phone Number" value={employee.phoneNumber} /><DetailGridItem label="Email Address" value={employee.emailAddress?.toLowerCase()} /><DetailGridItem label="District" value={toTitleCase(employee.district)} /><div className="col-span-3"><DetailGridItem label="Full Address" value={toTitleCase(employee.fullAddress)} /></div></div></section>
      <section><h2 className="text-lg font-semibold text-blue-700 border-b pb-2 mb-4">Employment & Statutory Details</h2><div className="grid grid-cols-3 gap-x-6 gap-y-4"><DetailGridItem label="Joining Date" value={formatDateForPdf(employee.joiningDate)} /><DetailGridItem label="Status" value={employee.status} />{employee.resourceIdNumber && <DetailGridItem label="Resource ID" value={employee.resourceIdNumber} />}<DetailGridItem label="PAN Number" value={employee.panNumber} /><DetailGridItem label="EPF/UAN Number" value={employee.epfUanNumber} /><DetailGridItem label="ESIC Number" value={employee.esicNumber} /></div></section>
      <section><h2 className="text-lg font-semibold text-blue-700 border-b pb-2 mb-4">Bank & Identification Details</h2><div className="grid grid-cols-3 gap-x-6 gap-y-4"><DetailGridItem label="Bank Name" value={toTitleCase(employee.bankName)} /><DetailGridItem label="Account Number" value={employee.bankAccountNumber} /><DetailGridItem label="IFSC Code" value={employee.ifscCode} /><DetailGridItem label="Identity Proof" value={`${employee.identityProofType || (employee as any).idProofType || 'N/A'} - ${employee.identityProofNumber || (employee as any).idProofNumber || 'N/A'}`} /><DetailGridItem label="Address Proof" value={`${employee.addressProofType || 'N/A'} - ${employee.addressProofNumber || 'N/A'}`} /></div></section>
    </main>
    <PageFooter pageNumber={pageNumber} />
  </div>
));
BiodataPage.displayName = 'BiodataPage';

const QrPage = React.forwardRef<HTMLDivElement, { employee: Employee; pageNumber: number }>(({ employee, pageNumber }, ref) => (
  <div ref={ref} style={{...pageStyle, justifyContent: 'center', alignItems: 'center', textAlign: 'center'}}>
    <h1 className="text-2xl font-bold mb-4">Employee QR Code</h1><p className="mb-2 text-lg">{toTitleCase(employee.fullName)}</p><p className="mb-8 text-gray-600">{employee.employeeId}</p>
    <div className="p-4 bg-white border-4 border-gray-200 rounded-lg"><Image src={employee.qrCodeUrl!} alt="Employee QR Code" width={300} height={300} unoptimized={true} crossOrigin="anonymous" data-ai-hint="qr code" /></div>
    <div className="mt-8 text-gray-600 max-w-md"><p className="font-semibold mb-2">Instructions:</p><p>This QR code is for marking your attendance. Please present this code for scanning when marking IN and OUT. Keep this document safe.</p></div>
    <PageFooter pageNumber={pageNumber} />
  </div>
));
QrPage.displayName = 'QrPage';

const DocumentPage = React.forwardRef<HTMLDivElement, { title: string; imageUrl: string; pageNumber: number }>(({ title, imageUrl, pageNumber }, ref) => (
  <div ref={ref} style={{...pageStyle, justifyContent: 'center', alignItems: 'center'}}>
      <h1 className="text-2xl font-bold mb-4 absolute top-[15mm]">{title}</h1>
      <Image 
          src={imageUrl} 
          alt={title} 
          layout="fill"
          objectFit="contain"
          className="p-[30mm]"
          unoptimized={true} 
          crossOrigin='anonymous'
          data-ai-hint="identity proof document"
      />
      <PageFooter pageNumber={pageNumber} />
  </div>
));
DocumentPage.displayName = 'DocumentPage';
// #endregion

export default function DataExportPage() {
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationStatus, setGenerationStatus] = useState<'idle' | 'generating' | 'complete' | 'error'>('idle');
    const [processedCount, setProcessedCount] = useState(0);

    const { toast } = useToast();

    // Refs for offscreen rendering
    const offscreenContainerRef = useRef<HTMLDivElement>(null);
    const [currentEmployeeForPdf, setCurrentEmployeeForPdf] = useState<Employee | null>(null);

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
                return { id: doc.id, ...processedRecord };
            });
            
            setProcessedCount(employeesData.length);
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
        const querySnapshot = await getDocs(employeesQuery);

        if (querySnapshot.empty) {
             toast({ variant: 'default', title: "No Data", description: `No employees found for client: ${selectedClient}.` });
             setGenerationStatus('error');
             return;
        }

        const employeesToExport = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
        setProcessedCount(employeesToExport.length);
        toast({ title: `Starting PDF Generation for ${employeesToExport.length} Employees`, description: "This may take some time. Please keep this tab open and approve the multiple file downloads." });
        
        for (let i = 0; i < employeesToExport.length; i++) {
            const employee = employeesToExport[i];
            setCurrentEmployeeForPdf(employee);
            
            await sleep(500);

            const biodataElement = offscreenContainerRef.current?.querySelector<HTMLDivElement>('#biodata-page');
            const qrElement = offscreenContainerRef.current?.querySelector<HTMLDivElement>('#qr-page');
            const idFrontElement = offscreenContainerRef.current?.querySelector<HTMLDivElement>('#id-front-page');
            const idBackElement = offscreenContainerRef.current?.querySelector<HTMLDivElement>('#id-back-page');

            if (!biodataElement) {
                console.error(`Could not find biodata element for ${employee.fullName}`);
                continue;
            }

            try {
                const pdf = new jsPDF('p', 'mm', 'a4');
                let pageCount = 0;

                const addPageToPdf = async (element: HTMLElement | null) => {
                    if (!element) return;
                    pageCount++;
                    const canvas = await html2canvas(element, { scale: 2, useCORS: true, allowTaint: false });
                    const imgData = canvas.toDataURL('image/jpeg', 0.85);
                    if (pageCount > 1) pdf.addPage();
                    pdf.addImage(imgData, 'JPEG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
                };

                await addPageToPdf(biodataElement);
                if (employee.qrCodeUrl && qrElement) {
                    await addPageToPdf(qrElement);
                }
                if (employee.identityProofUrlFront && idFrontElement) {
                    await addPageToPdf(idFrontElement);
                }
                if (employee.identityProofUrlBack && idBackElement) {
                    await addPageToPdf(idBackElement);
                }
                
                pdf.save(`${employee.fullName}_Profile_Kit.pdf`);
                toast({ title: `Generated Kit for ${employee.fullName} (${i+1}/${employeesToExport.length})` });
                await sleep(1000);

            } catch (err: any) {
                console.error(`Failed to generate PDF for ${employee.fullName}:`, err);
                toast({ variant: 'destructive', title: 'PDF Generation Failed', description: `Could not generate kit for ${employee.fullName}. ${err.message}` });
            }
        }
        
        setCurrentEmployeeForPdf(null);
        setGenerationStatus('complete');
        toast({ variant: 'default', title: "Bulk Export Complete!", description: `Finished processing all selected employees.` });
    };

    return (
        <>
            <div style={{ position: 'absolute', left: '-9999px', top: 0, zIndex: -1 }}>
                {currentEmployeeForPdf && (
                    <div ref={offscreenContainerRef}>
                        <div id="biodata-page"><BiodataPage employee={currentEmployeeForPdf} pageNumber={1} /></div>
                        {currentEmployeeForPdf.qrCodeUrl && <div id="qr-page"><QrPage employee={currentEmployeeForPdf} pageNumber={2} /></div>}
                        {currentEmployeeForPdf.identityProofUrlFront && <div id="id-front-page"><DocumentPage title="Identity Proof (Front)" imageUrl={currentEmployeeForPdf.identityProofUrlFront} pageNumber={3} /></div>}
                        {currentEmployeeForPdf.identityProofUrlBack && <div id="id-back-page"><DocumentPage title="Identity Proof (Back)" imageUrl={currentEmployeeForPdf.identityProofUrlBack} pageNumber={4} /></div>}
                    </div>
                )}
            </div>
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
                            {isGenerating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</>
                            : <><DownloadCloud className="mr-2 h-4 w-4" />Generate and Download</>}
                        </Button>
                    </CardContent>

                    {generationStatus !== 'idle' && (
                        <CardFooter>
                           {generationStatus === 'generating' && <Alert><Loader2 className="h-4 w-4 animate-spin" /><AlertTitle>Processing...</AlertTitle><AlertDescription>Your export is being generated. This may take a few moments.</AlertDescription></Alert>}
                           {generationStatus === 'complete' && <Alert variant="default" className="bg-green-50 border-green-200"><CheckCircle className="h-4 w-4 text-green-600" /><AlertTitle className="text-green-800">Export Complete!</AlertTitle><AlertDescription className="text-green-700">Successfully processed {processedCount} records. Your download should begin shortly.</AlertDescription></Alert>}
                           {generationStatus === 'error' && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Export Error</AlertTitle><AlertDescription>The export could not be completed. Please check the filters and try again.</AlertDescription></Alert>}
                        </CardFooter>
                    )}
                </Card>
            </div>
        </>
    );
}
