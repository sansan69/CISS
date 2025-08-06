
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadCloud, AlertTriangle, Loader2, CheckCircle, FileSpreadsheet, CalendarIcon, Filter } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from '@/hooks/use-toast';
import { auth, db } from '@/lib/firebase';
import { collection, addDoc, onSnapshot, doc, serverTimestamp, getDocs, query, orderBy } from 'firebase/firestore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { Label } from '@/components/ui/label';


// Represents the state of an export job stored in Firestore
interface ExportJob {
  status: 'pending' | 'processing' | 'complete' | 'error';
  downloadUrl?: string;
  error?: string;
  createdAt: any;
  userId: string;
  employeeCount?: number;
  filters?: {
    clientName?: string;
    startDate?: string;
    endDate?: string;
    district?: string;
  }
}

interface ClientOption { id: string; name: string; }
const keralaDistricts = [ "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod" ];


export default function DataExportPage() {
    const [isRequesting, setIsRequesting] = useState(false);
    const [activeJob, setActiveJob] = useState<{ id: string; data: ExportJob } | null>(null);
    const { toast } = useToast();

    // Filters State
    const [clients, setClients] = useState<ClientOption[]>([]);
    const [selectedClient, setSelectedClient] = useState<string>('all');
    const [selectedDistrict, setSelectedDistrict] = useState<string>('all');
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

    // Fetch clients for the filter dropdown
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
            // Create the job payload
            const jobPayload: any = {
                userId: user.uid,
                status: 'pending',
                createdAt: serverTimestamp(),
                filters: {}
            };

            if (selectedClient !== 'all') {
                jobPayload.filters.clientName = selectedClient;
            }
            if (selectedDistrict !== 'all') {
                jobPayload.filters.district = selectedDistrict;
            }
            if (dateRange?.from) {
                jobPayload.filters.startDate = dateRange.from.toISOString();
            }
            if (dateRange?.to) {
                jobPayload.filters.endDate = dateRange.to.toISOString();
            }

            // Create a new job document in Firestore to trigger the background function
            const jobsCollection = collection(db, "exportJobs");
            const newJobDoc = await addDoc(jobsCollection, jobPayload);

            // Set the active job to start listening for updates
            setActiveJob({
                id: newJobDoc.id,
                data: {
                    userId: user.uid,
                    status: 'pending',
                    createdAt: new Date(),
                    filters: jobPayload.filters,
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
                    You are about to generate an Excel file containing employee data. This data is sensitive. Ensure you handle the downloaded file securely.
                </AlertDescription>
            </Alert>

            <Card>
                <CardHeader>
                    <CardTitle>Start Data Export</CardTitle>
                    <CardDescription>
                        Optionally apply filters, then click the button below to generate an Excel file. The process runs in the background.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
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
                                <PopoverTrigger asChild>
                                    <Button id="date-range" variant={"outline"} className="w-full justify-start text-left font-normal">
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {dateRange?.from ? ( dateRange.to ? (<> {format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")} </>) : (format(dateRange.from, "LLL dd, y"))) : (<span>Pick a date range</span>) }
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
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
        </div>
    );
}
