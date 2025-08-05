
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadCloud, AlertTriangle, Loader2, CheckCircle, ListOrdered } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from '@/hooks/use-toast';
import { getFunctions, httpsCallable } from 'firebase/functions';

export default function DataExportPage() {
    const [isExporting, setIsExporting] = useState(false);
    const [exportResult, setExportResult] = useState<{ url: string; fileCount: number; employeeCount: number; } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { toast } = useToast();

    const handleStartExport = async () => {
        setIsExporting(true);
        setError(null);
        setExportResult(null);

        toast({
            title: "Starting Export Process...",
            description: "This may take several minutes depending on the amount of data. Please do not close this page.",
        });

        try {
            // In a real app, you would use your actual Firebase project ID.
            // This is a placeholder for the region where you deploy your functions.
            const functions = getFunctions(); 
            const exportAllData = httpsCallable(functions, 'exportAllData');
            const result = await exportAllData();
            
            const data = result.data as { downloadUrl: string; fileCount: number; employeeCount: number; };

            setExportResult({
                url: data.downloadUrl,
                fileCount: data.fileCount,
                employeeCount: data.employeeCount,
            });

            toast({
                title: "Export Ready!",
                description: "Your data archive is ready for download.",
                variant: 'default',
            });
        } catch (err: any) {
            console.error("Error calling export function:", err);
            const errorMessage = err.message || "An unknown error occurred during the export.";
            setError(errorMessage);
            toast({
                variant: "destructive",
                title: "Export Failed",
                description: errorMessage,
            });
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <h1 className="text-3xl font-bold tracking-tight">Export All Employee Data</h1>

            <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Warning: Security and Data Privacy</AlertTitle>
                <AlertDescription>
                    You are about to download a complete archive of all employee data, including personal information and uploaded documents.
                    This data is highly sensitive. Ensure you handle the downloaded file securely and in accordance with your company's data privacy policies.
                    The generated download link will be valid for a short period.
                </AlertDescription>
            </Alert>

            <Card>
                <CardHeader>
                    <CardTitle>Start Data Export</CardTitle>
                    <CardDescription>
                        Click the button below to begin generating a full export of the employee database and all associated documents.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button onClick={handleStartExport} disabled={isExporting}>
                        {isExporting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Exporting... (This may take several minutes)
                            </>
                        ) : (
                            <>
                                <DownloadCloud className="mr-2 h-4 w-4" />
                                Generate Full Data Archive (.zip)
                            </>
                        )}
                    </Button>
                </CardContent>

                {error && (
                    <CardFooter>
                         <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Export Error</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    </CardFooter>
                )}
                
                {exportResult && (
                    <CardFooter>
                        <Alert variant="default" className="bg-green-50 border-green-200">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <AlertTitle className="text-green-800">Export Complete!</AlertTitle>
                            <AlertDescription className="text-green-700">
                                <p>Successfully processed {exportResult.employeeCount} employees and {exportResult.fileCount} documents.</p>
                                <Button asChild className="mt-4">
                                    <a href={exportResult.url} target="_blank" rel="noopener noreferrer">
                                        <DownloadCloud className="mr-2 h-4 w-4" />
                                        Download ZIP Archive
                                    </a>
                                </Button>
                            </AlertDescription>
                        </Alert>
                    </CardFooter>
                )}
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle>What's Included in the Export?</CardTitle>
                </CardHeader>
                <CardContent>
                   <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                        <li><span className="font-semibold text-foreground">employees.xlsx:</span> An Excel file containing all data from the Firestore `employees` collection.</li>
                        <li><span className="font-semibold text-foreground">Employee Document Folders:</span> A separate folder for each employee (named by their phone number), containing all of their uploaded documents like profile pictures, ID proofs, etc.</li>
                   </ul>
                </CardContent>
            </Card>
        </div>
    );
}
