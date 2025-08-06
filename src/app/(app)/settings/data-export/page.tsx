
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadCloud, AlertTriangle, Loader2, FileSpreadsheet, CalendarIcon, Filter, CheckCircle } from 'lucide-react';
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

interface ClientOption { id: string; name: string; }
const keralaDistricts = [ "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod" ];

export default function DataExportPage() {
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationStatus, setGenerationStatus] = useState<'idle' | 'generating' | 'complete' | 'error'>('idle');
    const [processedCount, setProcessedCount] = useState(0);

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

    const handleClientSideExport = async () => {
        setIsGenerating(true);
        setGenerationStatus('generating');
        setProcessedCount(0);
        toast({ title: "Generating Export...", description: "Fetching employee data from the database." });

        try {
            let employeesQuery = query(collection(db, "employees"));

            // Apply filters
            if (selectedClient !== 'all') {
                employeesQuery = query(employeesQuery, where('clientName', '==', selectedClient));
            }
            if (selectedDistrict !== 'all') {
                employeesQuery = query(employeesQuery, where('district', '==', selectedDistrict));
            }
            if (dateRange?.from) {
                employeesQuery = query(employeesQuery, where('joiningDate', '>=', Timestamp.fromDate(dateRange.from)));
            }
            if (dateRange?.to) {
                const toDate = new Date(dateRange.to);
                toDate.setHours(23, 59, 59, 999); // Include the whole day
                employeesQuery = query(employeesQuery, where('joiningDate', '<=', Timestamp.fromDate(toDate)));
            }
            
            const querySnapshot = await getDocs(employeesQuery);

            if (querySnapshot.empty) {
                toast({ variant: 'default', title: "No Data", description: "No employees found for the selected filters." });
                setGenerationStatus('error');
                setIsGenerating(false);
                return;
            }

            toast({ title: "Processing Data...", description: `Found ${querySnapshot.size} records to export.` });

            const employeesData: any[] = [];
            const desiredOrder = [
                'fullName', 'dateOfBirth', 'fatherName', 'motherName', 'phoneNumber', 'resourceIdNumber', 
                'identityProofType', 'identityProofNumber', 'addressProofType', 'addressProofNumber'
            ];

            querySnapshot.forEach((doc) => {
                const docData = doc.data() as Employee;
                const processedRecord: {[key: string]: any} = {};

                // Add fields in desired order
                desiredOrder.forEach(key => {
                    if (docData[key as keyof Employee] !== undefined) {
                        processedRecord[key] = docData[key as keyof Employee];
                    }
                });

                // Add remaining fields, excluding those already added and internal ones
                Object.keys(docData).forEach((key) => {
                    if (!desiredOrder.includes(key) && key !== 'searchableFields' && key !== 'publicProfile') {
                        processedRecord[key] = docData[key as keyof Employee];
                    }
                });

                // Convert Timestamps to readable dates
                Object.keys(processedRecord).forEach(key => {
                    if (processedRecord[key] instanceof Timestamp) {
                        processedRecord[key] = processedRecord[key].toDate().toISOString().split("T")[0]; // Format as YYYY-MM-DD
                    }
                });
                
                employeesData.push({id: doc.id, ...processedRecord});
            });
            
            setProcessedCount(employeesData.length);

            // Create Excel file
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.json_to_sheet(employeesData);
            XLSX.utils.book_append_sheet(workbook, worksheet, "Employees");
            
            // Trigger download
            XLSX.writeFile(workbook, `CISS_Export_${new Date().toISOString().split('T')[0]}.xlsx`);

            setGenerationStatus('complete');
            toast({ variant: 'default', title: "Export Ready!", description: `Successfully exported ${employeesData.length} records.` });

        } catch (error: any) {
            console.error("Error during client-side export:", error);
            let message = "An error occurred during export.";
            if (error.code === 'permission-denied') {
                message = "Permission Denied. You do not have access to read this data."
            }
            toast({ variant: "destructive", title: "Export Failed", description: message });
            setGenerationStatus('error');
        } finally {
            setIsGenerating(false);
        }
    };
    
    const getStatusContent = () => {
        switch (generationStatus) {
            case 'generating':
                return (
                     <Alert variant="default">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <AlertTitle>Processing...</AlertTitle>
                        <AlertDescription>
                            Your export is being generated. This may take a few moments.
                        </AlertDescription>
                    </Alert>
                );
            case 'complete':
                return (
                    <Alert variant="default" className="bg-green-50 border-green-200">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <AlertTitle className="text-green-800">Export Complete!</AlertTitle>
                        <AlertDescription className="text-green-700">
                           Successfully processed {processedCount} employees. Your download should begin shortly.
                        </AlertDescription>
                    </Alert>
                );
            case 'error':
                 return (
                     <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Export Error or No Data</AlertTitle>
                        <AlertDescription>The export could not be completed. Please check the filters and try again.</AlertDescription>
                    </Alert>
                );
            default:
                return null;
        }
    }


    return (
        <div className="flex flex-col gap-6">
            <h1 className="text-3xl font-bold tracking-tight">Export Employee Data</h1>

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
                        Optionally apply filters, then click the button below to generate an Excel file directly in your browser.
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
                     <Button onClick={handleClientSideExport} disabled={isGenerating}>
                        {isGenerating ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Generating Export...
                            </>
                        ) : (
                            <>
                                <DownloadCloud className="mr-2 h-4 w-4" />
                                Generate and Download Export (.xlsx)
                            </>
                        )}
                    </Button>
                </CardContent>

                {generationStatus !== 'idle' && (
                    <CardFooter>
                       {getStatusContent()}
                    </CardFooter>
                )}
            </Card>
        </div>
    );
}
