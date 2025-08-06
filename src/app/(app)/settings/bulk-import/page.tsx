
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UploadCloud, Download, Loader2, FileCheck2, AlertTriangle, ListChecks, CheckCircle, ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';

// #region Helper functions for ID and QR code generation
const abbreviateClientName = (clientName: string): string => {
  if (!clientName) return "CLIENT";
  const upperCaseName = clientName.trim().toUpperCase();

  const abbreviations: { [key: string]: string } = {
    "TATA CONSULTANCY SERVICES": "TCS",
    "WIPRO": "WIPRO",
  };
  if (abbreviations[upperCaseName]) {
    return abbreviations[upperCaseName];
  }

  const words = upperCaseName.split(/[\s-]+/).filter((w) => w.length > 0);
  if (words.length > 1) {
    return words.map((word) => word[0]).join("");
  }

  if (upperCaseName.length <= 4) {
    return upperCaseName;
  }
  return upperCaseName.substring(0, 4);
};

const getCurrentFinancialYear = (): string => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentYear = now.getFullYear();
  if (currentMonth >= 4) { // April or later
    return `${currentYear}-${(currentYear + 1).toString().slice(-2)}`;
  } else { // Jan, Feb, March
    return `${currentYear - 1}-${currentYear.toString().slice(-2)}`;
  }
};

const generateEmployeeId = (clientName: string, index: number): string => {
  const shortClientName = abbreviateClientName(clientName);
  const financialYear = getCurrentFinancialYear();
  const randomNumber = Math.floor(Math.random() * 900) + 100 + index; // Add index to reduce collisions
  return `CISS/${shortClientName}/${financialYear}/${randomNumber.toString().padStart(3, "0")}`;
};

const generateQrCodeDataUrl = async (employeeId: string, fullName: string, phoneNumber: string): Promise<string> => {
    const dataString = `Employee ID: ${employeeId}\nName: ${fullName}\nPhone: ${phoneNumber}`;
    try {
        return await QRCode.toDataURL(dataString, {
            errorCorrectionLevel: 'H', type: 'image/png', quality: 0.92, margin: 1, width: 256,
        });
    } catch (err) {
        console.error('QR code generation failed:', err);
        throw new Error('Failed to generate QR code.');
    }
};
// #endregion

interface ProcessedRecord {
    data: any;
    status: 'success' | 'error';
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

                const batch = writeBatch(db);
                const employeesRef = collection(db, "employees");

                for (let i = 0; i < validRecords.length; i++) {
                    const record = validRecords[i];
                    const employeeDocRef = collection(db, "employees").doc(); // Create new doc ref

                    const employeeId = generateEmployeeId(record.clientName, i);
                    const qrCodeUrl = await generateQrCodeDataUrl(employeeId, record.fullName, record.phoneNumber);
                    
                    const finalRecord = {
                        ...record,
                        employeeId,
                        qrCodeUrl,
                        joiningDate: Timestamp.fromDate(record.joiningDate),
                        dateOfBirth: Timestamp.fromDate(record.dateOfBirth),
                    };

                    batch.set(employeeDocRef, finalRecord);
                }

                await batch.commit();

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
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" asChild>
                    <Link href="/settings">
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">Back to Settings</span>
                    </Link>
                </Button>
                <h1 className="text-3xl font-bold tracking-tight">Bulk Employee Import</h1>
            </div>

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

            <Card>
                <CardHeader>
                    <CardTitle>Step 1: Download Template</CardTitle>
                    <CardDescription>Get the CSV template file to fill in your employee data.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button onClick={handleDownloadTemplate} variant="outline">
                        <Download className="mr-2 h-4 w-4" /> Download Template (.csv)
                    </Button>
                </CardContent>
            </Card>
            
            <Card>
                <CardHeader>
                    <CardTitle>Step 2: Upload File</CardTitle>
                    <CardDescription>Upload the completed CSV or XLSX file to begin the import process.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col sm:flex-row gap-4 items-center">
                    <div className="grid w-full max-w-sm items-center gap-1.5">
                        <Label htmlFor="employee-file">Employee Data File</Label>
                        <Input id="employee-file" type="file" accept=".csv, .xlsx" onChange={handleFileChange} />
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
