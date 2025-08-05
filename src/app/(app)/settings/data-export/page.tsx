
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadCloud, AlertTriangle, Loader2, CheckCircle, FileSpreadsheet } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from '@/hooks/use-toast';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from '@/lib/firebase'; // Import auth

export default function DataExportPage() {
    const [isExporting, setIsExporting] = useState(false);
    const [exportResult, setExportResult] = useState<{ url: string; employeeCount: number; } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { toast } = useToast();

    const handleStartExport = async () => {
        setIsExporting(true);
        setError(null);
        setExportResult(null);

        if (!auth.currentUser) {
            toast({ variant: "destructive", title: "Authentication Error", description: "You must be logged in to perform this action."});
            setIsExporting(false);
            return;
        }

        toast({
            title: "Starting Export Process...",
            description: "Generating your Excel file. Please wait.",
        });

        try {
            const functions = getFunctions();
            // Note: We are now using an onRequest function, but the callable interface provides a convenient way to call it.
            // It will handle passing the auth token automatically.
            const exportAllData = httpsCallable(functions, 'exportAllData');
            const result = await exportAllData();
            
            const data = result.data as { downloadUrl: string; employeeCount: number; };

            setExportResult({
                url: data.downloadUrl,
                employeeCount: data.employeeCount,
            });

            toast({
                title: "Export Ready!",
                description: "Your Excel file is ready for download.",
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
                    You are about to download an Excel file containing all employee data, including links to personal documents.
                    This data is highly sensitive. Ensure you handle the downloaded file securely.
                    The generated download link will be valid for 15 minutes.
                </AlertDescription>
            </Alert>

            <Card>
                <CardHeader>
                    <CardTitle>Start Data Export</CardTitle>
                    <CardDescription>
                        Click the button below to generate an Excel file of the entire employee database.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button onClick={handleStartExport} disabled={isExporting}>
                        {isExporting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Exporting...
                            </>
                        ) : (
                            <>
                                <DownloadCloud className="mr-2 h-4 w-4" />
                                Generate Full Data Export (.xlsx)
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
                                <p>Successfully processed {exportResult.employeeCount} employees.</p>
                                <Button asChild className="mt-4">
                                    <a href={exportResult.url} target="_blank" rel="noopener noreferrer">
                                        <DownloadCloud className="mr-2 h-4 w-4" />
                                        Download Excel File
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
                        <li><span className="font-semibold text-foreground">A single Excel file (.xlsx):</span> This file contains all data from the Firestore `employees` collection.</li>
                        <li><span className="font-semibold text-foreground">Clickable Links:</span> Columns containing document URLs will be active hyperlinks, allowing you to open the documents directly in your browser from Excel.</li>
                   </ul>
                </CardContent>
            </Card>
        </div>
    );
}
