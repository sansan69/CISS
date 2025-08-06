
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UploadCloud, Download, Loader2, FileCheck2, AlertTriangle, ListChecks, CheckCircle, ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, writeBatch, serverTimestamp, GeoPoint, doc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';

interface ProcessedRecord {
    data: any;
    status: 'success' | 'error';
    message: string;
}

const requiredFields = [
    'Client Name', 'Site Name', 'Site Address', 'Geolocation'
];

export default function SiteManagementPage() {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processedRecords, setProcessedRecords] = useState<ProcessedRecord[]>([]);
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
        const templateHeaders = ['Client Name', 'Site Name', 'Site ID', 'Site Address', 'Geolocation'];
        const templateExampleRow = ['Example Client Inc.', 'Main Branch', 'SITE-001', '123 Example St, Example City, EX 12345', '10.1234,76.5432'];
        const templateData = [templateHeaders, templateExampleRow];
        const ws = XLSX.utils.aoa_to_sheet(templateData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Site Import Template");
        XLSX.writeFile(wb, "CISS_Site_Import_Template.xlsx");
        toast({
            title: "Template Downloading",
            description: "The Excel template file has started downloading."
        });
    };

    const processAndUpload = async () => {
        if (!file) {
            toast({ variant: 'destructive', title: 'No File Selected', description: 'Please select a file to upload.' });
            return;
        }

        setIsProcessing(true);
        setProcessedRecords([]);

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                
                if (jsonData.length === 0) {
                    throw new Error("The file is empty or does not contain data rows.");
                }

                let validRecords: any[] = [];
                let localProcessedRecords: ProcessedRecord[] = [];

                jsonData.forEach((row: any, index) => {
                    let missingFields = requiredFields.filter(field => !row[field]);
                    if (missingFields.length > 0) {
                        localProcessedRecords.push({ data: row, status: 'error', message: `Row ${index + 2}: Missing required fields: ${missingFields.join(', ')}` });
                        return;
                    }

                    // Geolocation validation and conversion
                    const geoString = String(row.Geolocation).trim();
                    const geoParts = geoString.split(',').map(part => parseFloat(part.trim()));
                    if (geoParts.length !== 2 || isNaN(geoParts[0]) || isNaN(geoParts[1])) {
                        localProcessedRecords.push({ data: row, status: 'error', message: `Row ${index + 2}: Invalid Geolocation format. Expected "latitude,longitude".` });
                        return;
                    }
                    const [latitude, longitude] = geoParts;
                    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
                         localProcessedRecords.push({ data: row, status: 'error', message: `Row ${index + 2}: Invalid Geolocation values.` });
                        return;
                    }
                    
                    const siteData = {
                      clientName: row['Client Name'],
                      siteName: row['Site Name'],
                      siteId: row['Site ID'] || null,
                      siteAddress: row['Site Address'],
                      geolocation: new GeoPoint(latitude, longitude),
                      createdAt: serverTimestamp(),
                      updatedAt: serverTimestamp(),
                    };
                    
                    validRecords.push(siteData);
                });
                
                setProcessedRecords(localProcessedRecords);

                if (validRecords.length === 0) {
                    if (localProcessedRecords.length > 0) {
                        throw new Error("All records contained errors. Please check the results below and try again.");
                    } else {
                        throw new Error("No valid records found to import.");
                    }
                }

                toast({ title: "Uploading...", description: `Importing ${validRecords.length} valid site records.` });

                const batch = writeBatch(db);
                const sitesRef = collection(db, "sites");

                validRecords.forEach(record => {
                    const siteDocRef = doc(sitesRef); // Create new doc ref
                    batch.set(siteDocRef, record);
                });

                await batch.commit();

                toast({
                    title: 'Import Successful',
                    description: `Successfully imported ${validRecords.length} new sites.`,
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
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" asChild>
                    <Link href="/settings">
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">Back to Settings</span>
                    </Link>
                </Button>
                <h1 className="text-3xl font-bold tracking-tight">Bulk Site Import</h1>
            </div>

            <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Instructions & Important Notes</AlertTitle>
                <AlertDescription>
                    <ul className="list-disc list-inside space-y-1">
                        <li>Download the template Excel file to ensure your data is correctly formatted.</li>
                        <li>Do not change the column headers in the template file. Column headers are: <strong>Client Name, Site Name, Site ID, Site Address, Geolocation</strong>.</li>
                        <li><strong>Geolocation</strong> format must be: <code>latitude,longitude</code> (e.g., <code>10.1234,76.5432</code>).</li>
                        <li>This tool is for adding new sites only. It does not update existing records.</li>
                    </ul>
                </AlertDescription>
            </Alert>

            <Card>
                <CardHeader>
                    <CardTitle>Step 1: Download Template</CardTitle>
                    <CardDescription>Get the Excel template file to fill in your site data.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button onClick={handleDownloadTemplate} variant="outline">
                        <Download className="mr-2 h-4 w-4" /> Download Template (.xlsx)
                    </Button>
                </CardContent>
            </Card>
            
            <Card>
                <CardHeader>
                    <CardTitle>Step 2: Upload File</CardTitle>
                    <CardDescription>Upload the completed Excel file to begin the import process.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col sm:flex-row gap-4 items-center">
                    <div className="grid w-full max-w-sm items-center gap-1.5">
                        <Label htmlFor="site-file">Site Data File</Label>
                        <Input id="site-file" type="file" accept=".csv, .xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" onChange={handleFileChange} />
                    </div>
                    {file && (
                        <div className="flex items-center gap-2 p-2 border rounded-md bg-muted text-sm">
                            <FileCheck2 className="h-5 w-5 text-green-500" />
                            <span>{file.name}</span>
                        </div>
                    )}
                </CardContent>
                <CardFooter>
                    <Button onClick={processAndUpload} disabled={isProcessing || !file}>
                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                        {isProcessing ? 'Processing...' : 'Process & Upload File'}
                    </Button>
                </CardFooter>
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
                                        {record.status === 'success' ? `${record.data.siteName} (${record.data.clientName})` : `Row ${index + 2}`}
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
