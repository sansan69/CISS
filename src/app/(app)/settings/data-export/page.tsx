
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadCloud, AlertTriangle, Loader2, CheckCircle, FileSpreadsheet } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from '@/hooks/use-toast';
import { auth, db } from '@/lib/firebase';
import { collection, addDoc, onSnapshot, doc, serverTimestamp } from 'firebase/firestore';

// Represents the state of an export job stored in Firestore
interface ExportJob {
  status: 'pending' | 'processing' | 'complete' | 'error';
  downloadUrl?: string;
  error?: string;
  createdAt: any;
  userId: string;
  employeeCount?: number;
}

export default function DataExportPage() {
    const [isRequesting, setIsRequesting] = useState(false);
    const [activeJob, setActiveJob] = useState<{ id: string; data: ExportJob } | null>(null);
    const { toast } = useToast();

    // Subscribe to real-time updates for the active export job
    useEffect(() => {
        if (!activeJob?.id) return;

        const unsub = onSnapshot(doc(db, "exportJobs", activeJob.id), (doc) => {
            if (doc.exists()) {
                const jobData = doc.data() as ExportJob;
                setActiveJob({ id: doc.id, data: jobData });

                if(jobData.status === 'complete' || jobData.status === 'error') {
                    setIsRequesting(false); // Stop the main loading spinner
                }

                if (jobData.status === 'error') {
                     toast({
                        variant: "destructive",
                        title: "Export Failed",
                        description: jobData.error || "An unknown error occurred in the background.",
                    });
                }
            }
        });

        // Cleanup subscription on component unmount or when job changes
        return () => unsub();

    }, [activeJob?.id, toast]);


    const handleStartExport = async () => {
        setIsRequesting(true);
        setActiveJob(null);

        const user = auth.currentUser;
        if (!user) {
            toast({ variant: "destructive", title: "Authentication Error", description: "You must be logged in to perform this action."});
            setIsRequesting(false);
            return;
        }

        try {
            // Create a new job document in Firestore to trigger the background function
            const jobsCollection = collection(db, "exportJobs");
            const newJobDoc = await addDoc(jobsCollection, {
                userId: user.uid,
                status: 'pending',
                createdAt: serverTimestamp(),
            });

            // Set the active job to start listening for updates
            setActiveJob({
                id: newJobDoc.id,
                data: {
                    userId: user.uid,
                    status: 'pending',
                    createdAt: new Date(),
                }
            });

            toast({
                title: "Export Requested",
                description: "Your data export is being processed in the background. You'll be notified when it's ready.",
            });
        } catch (err: any) {
            console.error("Error requesting export job:", err);
            const errorMessage = err.message || "Could not start the export job.";
            toast({
                variant: "destructive",
                title: "Request Failed",
                description: errorMessage,
            });
            setIsRequesting(false);
        }
    };

    const getStatusContent = () => {
        if (!activeJob) return null;

        switch (activeJob.data.status) {
            case 'pending':
            case 'processing':
                return (
                     <Alert variant="default">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <AlertTitle>Processing...</AlertTitle>
                        <AlertDescription>
                            Your export is being generated in the background. This may take a few minutes. The download link will appear here automatically when ready.
                        </AlertDescription>
                    </Alert>
                );
            case 'complete':
                return (
                    <Alert variant="default" className="bg-green-50 border-green-200">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <AlertTitle className="text-green-800">Export Complete!</AlertTitle>
                        <AlertDescription className="text-green-700">
                            <p>Successfully processed {activeJob.data.employeeCount || 'all'} employees.</p>
                            <Button asChild className="mt-4">
                                <a href={activeJob.data.downloadUrl} target="_blank" rel="noopener noreferrer">
                                    <DownloadCloud className="mr-2 h-4 w-4" />
                                    Download Excel File
                                </a>
                            </Button>
                        </AlertDescription>
                    </Alert>
                );
            case 'error':
                 return (
                     <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Export Error</AlertTitle>
                        <AlertDescription>{activeJob.data.error || 'An unexpected error occurred.'}</AlertDescription>
                    </Alert>
                );
            default:
                return null;
        }
    }


    return (
        <div className="flex flex-col gap-6">
            <h1 className="text-3xl font-bold tracking-tight">Export All Employee Data</h1>

            <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Warning: Security and Data Privacy</AlertTitle>
                <AlertDescription>
                    You are about to generate an Excel file containing all employee data, including links to personal documents.
                    This data is highly sensitive. Ensure you handle the downloaded file securely.
                </AlertDescription>
            </Alert>

            <Card>
                <CardHeader>
                    <CardTitle>Start Data Export</CardTitle>
                    <CardDescription>
                        Click the button below to generate an Excel file of the entire employee database. The process runs in the background.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button onClick={handleStartExport} disabled={isRequesting}>
                        {isRequesting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Requesting Export...
                            </>
                        ) : (
                            <>
                                <DownloadCloud className="mr-2 h-4 w-4" />
                                Generate Full Data Export (.xlsx)
                            </>
                        )}
                    </Button>
                </CardContent>

                {activeJob && (
                    <CardFooter>
                       {getStatusContent()}
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
