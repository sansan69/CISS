
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UploadCloud, Download, Loader2, FileCheck2, AlertTriangle, ListChecks, CheckCircle, ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, doc, writeBatch, serverTimestamp, Timestamp, query, where, getDocs } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';
import { generateEmployeeId } from '@/lib/employee-id';
import { generateQrCodeDataUrl } from '@/lib/qr';
import { PageHeader } from '@/components/layout/page-header';
import { siteBelongsToClient } from '@/lib/sites/site-directory';

interface ProcessedRecord {
    data: any;
    status: 'success' | 'error' | 'duplicate';
    message: string;
}

const requiredFields = [
    'clientName', 'joiningDate', 'firstName', 'lastName', 'fatherName', 'motherName', 'dateOfBirth', 'gender',
    'maritalStatus', 'district', 'idProofType', 'idProofNumber', 'bankAccountNumber', 'ifscCode', 'bankName',
    'fullAddress', 'emailAddress', 'phoneNumber'
];

export default function BulkImportPage() {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processedRecords, setProcessedRecords] = useState<ProcessedRecord[]>([]);
    const [importType, setImportType] = useState<'employees' | 'clients_sites'>('employees');
    const { toast } = useToast();

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            const selectedFile = event.target.files[0];
            if (selectedFile.type === 'text/csv' || selectedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
                setFile(selectedFile);
                setProcessedRecords([]);
            } else {
                toast({
                    variant: 'destructive',
                    title: 'Invalid File Type',
                    description: 'Please upload a CSV or XLSX file.',
                });
            }
        }
    };

    const handleDownloadTemplate = () => {
        const templateData = [requiredFields.concat(['spouseName', 'panNumber', 'epfUanNumber', 'esicNumber', 'resourceIdNumber'])];
        const ws = XLSX.utils.aoa_to_sheet(templateData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Employee Import Template");
        XLSX.writeFile(wb, "CISS_Employee_Import_Template.csv");
        toast({
            title: "Template Downloading",
            description: "The CSV template file has started downloading."
        });
    };

    const handleDownloadClientsSitesTemplate = () => {
        const templateHeaders = ['Client Name', 'Site Name', 'Site Address', 'District', 'Geolocation', 'Shift Pattern'];
        const templateExampleRow = ['TCS', 'TCS Kochi Main', '123 Tech Park, Kochi, Kerala', 'Ernakulam', '10.0234,76.3123', '2x12'];
        const templateData = [templateHeaders, templateExampleRow];
        const ws = XLSX.utils.aoa_to_sheet(templateData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Clients & Sites Import");
        XLSX.writeFile(wb, "CISS_Clients_Sites_Import_Template.xlsx");
        toast({
            title: "Template Downloading",
            description: "The Clients & Sites template file has started downloading."
        });
    };

    const excelSerialToDate = (serial: number) => {
        const utc_days = Math.floor(serial - 25569);
        const utc_value = utc_days * 86400;
        const date_info = new Date(utc_value * 1000);

        const fractional_day = serial - Math.floor(serial) + 0.0000001;
        
        let total_seconds = Math.floor(86400 * fractional_day);
        
        const seconds = total_seconds % 60;
        total_seconds -= seconds;
        
        const hours = Math.floor(total_seconds / (60 * 60));
        const minutes = Math.floor(total_seconds / 60) % 60;
        
        return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate(), hours, minutes, seconds);
    }

    const processClientsSitesImport = async (rows: any[], file: File) => {
        const BATCH_SIZE = 500;
        const results: ProcessedRecord[] = [];
        const headers = Object.keys(rows[0] || {});
    
        const processedRows = rows.map((rowArray: any) => {
            const row: any = {};
            headers.forEach((header: string, i: number) => {
                row[header] = rowArray[header];
            });
            return row;
        });

        const batchOps: { ref: any; data: any }[] = [];
    
        for (const row of processedRows) {
            const clientName = row['Client Name'];
            const siteName = row['Site Name'];
            
            if (!clientName || !siteName) {
                results.push({ data: row, status: 'error', message: 'Missing client name or site name' });
                continue;
            }
    
            const clientQuery = query(collection(db, 'clients'), where('name', '==', clientName));
            const clientDocs = await getDocs(clientQuery);
            let clientId: string;
            
            if (clientDocs.empty) {
                const newClientRef = doc(collection(db, 'clients'));
                batchOps.push({ ref: newClientRef, data: { name: clientName, createdAt: serverTimestamp() } });
                clientId = newClientRef.id;
            } else {
                clientId = clientDocs.docs[0].id;
            }
    
            const existingSitesSnapshot = await getDocs(collection(db, 'sites'));
            const matchingSite = existingSitesSnapshot.docs.find((docSnap) => {
                const data = docSnap.data() as { clientId?: string; clientName?: string; siteName?: string };
                return siteBelongsToClient(data as any, clientId, clientName)
                    && String(data.siteName || '').trim().toLowerCase() === String(siteName).trim().toLowerCase();
            });

            if (matchingSite) {
                results.push({ data: row, status: 'error', message: 'Site already exists' });
                continue;
            }
    
            const siteData: any = {
                clientId,
                clientName,
                siteName,
                siteAddress: row['Site Address'] || '',
                district: row['District'] || '',
                coordinateStatus: 'missing',
                createdAt: serverTimestamp(),
            };
            
            if (row['Geolocation']) {
                const coords = String(row['Geolocation']).split(',').map(Number);
                if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
                    siteData.geolocation = { latitude: coords[0], longitude: coords[1] };
                    siteData.coordinateStatus = 'geocoded';
                }
            }

            batchOps.push({ ref: doc(collection(db, 'sites')), data: siteData });
            results.push({ data: row, status: 'success', message: 'Created successfully' });
        }

        for (let i = 0; i < batchOps.length; i += BATCH_SIZE) {
            const chunk = batchOps.slice(i, i + BATCH_SIZE);
            const batch = writeBatch(db);
            for (const op of chunk) {
                batch.set(op.ref, op.data);
            }
            await batch.commit();
        }
    
        return results;
    };

    const processAndUpload = async () => {
        if (!file) {
            toast({ variant: 'destructive', title: 'No File Selected', description: 'Please select a file to upload.' });
            return;
        }

        setIsProcessing(true);
        setProcessedRecords([]);

        if (importType === 'clients_sites') {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = new Uint8Array(e.target?.result as ArrayBuffer);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet);
                    
                    if (jsonData.length < 1) {
                        throw new Error("The file is empty or contains only a header row.");
                    }

                    toast({ title: "Uploading...", description: `Importing ${jsonData.length} client/site records.` });
                    const results = await processClientsSitesImport(jsonData, file);
                    setProcessedRecords(results);
                    
                    toast({
                        title: 'Import Successful',
                        description: `Successfully processed ${results.filter(r => r.status === 'success').length} records.`,
                        duration: 5000
                    });
                } catch (error: any) {
                    console.error("Error processing file:", error);
                    toast({ variant: 'destructive', title: 'Import Failed', description: error.message || 'An unexpected error occurred during import.' });
                } finally {
                    setIsProcessing(false);
                }
            };
            reader.readAsArrayBuffer(file);
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                if (jsonData.length < 2) {
                    throw new Error("The file is empty or contains only a header row.");
                }

                const headers = jsonData[0] as string[];
                const rows = jsonData.slice(1);
                
                let validRecords: any[] = [];
                let localProcessedRecords: ProcessedRecord[] = [];

                rows.forEach((rowArray: any, index) => {
                    const row: any = {};
                    headers.forEach((header, i) => {
                      row[header] = rowArray[i];
                    });

                    let missingFields = requiredFields.filter(field => !row[field]);
                    if (missingFields.length > 0) {
                        localProcessedRecords.push({ data: row, status: 'error', message: `Row ${index + 2}: Missing required fields: ${missingFields.join(', ')}` });
                        return;
                    }
                    
                    const fullName = `${row.firstName} ${row.lastName}`;
                    row.fullName = fullName;
                    row.status = 'Active';
                    row.createdAt = serverTimestamp();
                    row.updatedAt = serverTimestamp();
                    
                    try {
                        row.joiningDate = typeof row.joiningDate === 'number' ? excelSerialToDate(row.joiningDate) : new Date(row.joiningDate);
                        row.dateOfBirth = typeof row.dateOfBirth === 'number' ? excelSerialToDate(row.dateOfBirth) : new Date(row.dateOfBirth);
                        if (isNaN(row.joiningDate.getTime()) || isNaN(row.dateOfBirth.getTime())) {
                            throw new Error("Invalid date format. Use YYYY-MM-DD or a valid Excel date.");
                        }
                    } catch(dateError: any) {
                        localProcessedRecords.push({ data: row, status: 'error', message: `Row ${index + 2}: ${dateError.message}` });
                        return;
                    }
                    
                    validRecords.push(row);
                });
                
                setProcessedRecords(localProcessedRecords);

                if (validRecords.length === 0) {
                    throw new Error("No valid records found to import.");
                }

                toast({ title: "Uploading...", description: `Importing ${validRecords.length} valid employee records.` });

                const BATCH_SIZE = 500;
                const employeesRef = collection(db, "employees");

                const batchSeed = Math.floor(Date.now() / 1000) % 9000 + 1000;

                const batchOps: { ref: any; data: any }[] = [];

                for (let i = 0; i < validRecords.length; i++) {
                    const record = validRecords[i];
                    const employeeDocRef = doc(employeesRef);

                    const employeeId = generateEmployeeId(record.clientName, batchSeed + i);

                    let qrCodeUrl = "";
                    try {
                        qrCodeUrl = await generateQrCodeDataUrl(employeeId, record.fullName, record.phoneNumber);
                    } catch (qrErr) {
                        console.warn(`QR generation failed for ${record.fullName} — continuing without QR.`, qrErr);
                    }

                    const finalRecord = {
                        ...record,
                        employeeId,
                        qrCodeUrl,
                        joiningDate: Timestamp.fromDate(record.joiningDate),
                        dateOfBirth: Timestamp.fromDate(record.dateOfBirth),
                    };

                    batchOps.push({ ref: employeeDocRef, data: finalRecord });
                }

                for (let i = 0; i < batchOps.length; i += BATCH_SIZE) {
                    const chunk = batchOps.slice(i, i + BATCH_SIZE);
                    const batch = writeBatch(db);
                    for (const op of chunk) {
                        batch.set(op.ref, op.data);
                    }
                    await batch.commit();
                }

                toast({
                    title: 'Import Successful',
                    description: `Successfully imported ${validRecords.length} new employees.`,
                    duration: 5000
                });
                const successRecords = validRecords.map(data => ({ data, status: 'success', message: 'Successfully imported.'} as ProcessedRecord));
                setProcessedRecords(prev => [...prev, ...successRecords]);

            } catch (error: any) {
                console.error("Error processing file:", error);
                toast({ variant: 'destructive', title: 'Import Failed', description: error.message || 'An unexpected error occurred during import.' });
            } finally {
                setIsProcessing(false);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const successCount = processedRecords.filter(r => r.status === 'success').length;
    const errorCount = processedRecords.filter(r => r.status === 'error').length;


    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                eyebrow="Admin"
                title={importType === 'employees' ? "Bulk Employee Import" : "Bulk Clients & Sites Import"}
                description={importType === 'employees' ? "Import new employees in batches using the approved template and validation flow." : "Import multiple clients and their sites together."}
                breadcrumbs={[
                    { label: "Dashboard", href: "/dashboard" },
                    { label: "Settings", href: "/settings" },
                    { label: importType === 'employees' ? "Bulk Employee Import" : "Bulk Clients & Sites Import" },
                ]}
                actions={
                    <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
                        <Link href="/settings">
                            <ChevronLeft className="mr-2 h-4 w-4" />
                            <span>Back to Settings</span>
                        </Link>
                    </Button>
                }
/>
 
            <div className="flex gap-2 mb-4">
                <Button 
                    variant={importType === 'employees' ? 'default' : 'outline'}
                    onClick={() => { setImportType('employees'); setFile(null); setProcessedRecords([]); }}
                >
                    Employees
                </Button>
                <Button 
                    variant={importType === 'clients_sites' ? 'default' : 'outline'}
                    onClick={() => { setImportType('clients_sites'); setFile(null); setProcessedRecords([]); }}
                >
                    Clients & Sites
                </Button>
            </div>
 
            {importType === 'employees' && (
                <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Instructions & Important Notes</AlertTitle>
                    <AlertDescription>
                        <ul className="list-disc list-inside space-y-1">
                            <li>Download the template CSV file to ensure your data is correctly formatted.</li>
                            <li>Do not change the column headers in the template file.</li>
                            <li>All required fields must be filled. Required fields are: {requiredFields.slice(0, 5).join(', ')}, etc.</li>
                            <li>Dates (joiningDate, dateOfBirth) should be in YYYY-MM-DD format.</li>
                            <li>This tool is for adding **new** employees only. It does not update existing records.</li>
                            <li>All documents (profile picture, ID proofs, etc.) must be uploaded manually via the employee's profile page after import.</li>
                        </ul>
                    </AlertDescription>
                </Alert>
            )}

            {importType === 'clients_sites' && (
                <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Instructions & Important Notes</AlertTitle>
                    <AlertDescription>
                        <ul className="list-disc list-inside space-y-1">
                            <li>Download the template file to ensure your data is correctly formatted.</li>
                            <li>Do not change the column headers in the template file.</li>
                            <li>If a client already exists, it will be reused. If not, a new client will be created.</li>
                            <li>New sites will be created under existing clients or newly created ones.</li>
                            <li>If a site with the same name already exists under a client, it will be skipped.</li>
                            <li>Geolocation should be in format "latitude,longitude" (e.g., "10.0234,76.3123").</li>
                        </ul>
                    </AlertDescription>
                </Alert>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Step 1: Download Template</CardTitle>
                    <CardDescription>{importType === 'employees' ? 'Get the CSV template file to fill in your employee data.' : 'Get the template file to fill in your client and site data.'}</CardDescription>
                </CardHeader>
                <CardContent>
                    {importType === 'employees' ? (
                        <Button onClick={handleDownloadTemplate} variant="outline">
                            <Download className="mr-2 h-4 w-4" /> Download Template (.csv)
                        </Button>
                    ) : (
                        <Button onClick={handleDownloadClientsSitesTemplate} variant="outline">
                            <Download className="mr-2 h-4 w-4" /> Download Template (.xlsx)
                        </Button>
                    )}
                </CardContent>
            </Card>
            
            <Card>
                <CardHeader>
                    <CardTitle>Step 2: Upload File</CardTitle>
                    <CardDescription>Upload the completed {importType === 'employees' ? 'CSV or XLSX' : 'XLSX'} file to begin the import process.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col sm:flex-row gap-4 items-center">
                    <div className="grid w-full max-w-sm items-center gap-1.5">
                        <Label htmlFor="employee-file">{importType === 'employees' ? 'Employee Data File' : 'Clients & Sites Data File'}</Label>
                        <Input id="employee-file" type="file" accept={importType === 'employees' ? ".csv, .xlsx" : ".xlsx"} onChange={handleFileChange} />
                    </div>
                    {file && (
                        <div className="flex items-center gap-2 p-2 border rounded-md bg-muted text-sm">
                            <FileCheck2 className="h-5 w-5 text-green-500" />
                            <span>{file.name}</span>
                        </div>
                    )}
                </CardContent>
                <CardContent>
                    <Button onClick={processAndUpload} disabled={isProcessing || !file}>
                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                        {isProcessing ? 'Processing...' : 'Process & Upload File'}
                    </Button>
                </CardContent>
            </Card>

            {processedRecords.length > 0 && (
                 <Card>
                    <CardHeader>
                        <CardTitle>Import Results</CardTitle>
                        <CardDescription className="flex flex-col sm:flex-row gap-4">
                            <span className="flex items-center gap-1 text-green-600"><CheckCircle className="h-4 w-4"/>Successful: {successCount}</span>
                            <span className="flex items-center gap-1 text-red-600"><AlertTriangle className="h-4 w-4"/>Failed: {errorCount}</span>
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="max-h-96 overflow-y-auto">
                       <div className="space-y-2">
                            {processedRecords.map((record, index) => (
                                <div key={index} className={`p-3 border rounded-md ${record.status === 'success' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                    <p className="font-semibold text-sm">
                                        Row {index + 2}: {record.data.firstName} {record.data.lastName || ''} ({record.data.phoneNumber || 'No Phone'})
                                    </p>
                                    <p className={`text-xs ${record.status === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                                        {record.message}
                                    </p>
                                </div>
                            ))}
                       </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
