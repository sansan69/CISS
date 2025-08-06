
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UploadCloud, Download, Loader2, FileCheck2, AlertTriangle, ListChecks, CheckCircle, ChevronLeft, Edit, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, writeBatch, serverTimestamp, GeoPoint, doc, query, where, getDocs, onSnapshot, orderBy, updateDoc, deleteDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';


interface Site {
    id: string;
    clientName: string;
    siteName: string;
    siteId?: string;
    siteAddress: string;
    district: string;
    geolocation: GeoPoint;
}

interface ProcessedRecord {
    data: any;
    status: 'success' | 'error' | 'duplicate';
    message: string;
}

const requiredFields = [
    'Client Name', 'Site Name', 'Site Address', 'Geolocation', 'District'
];

const keralaDistricts = [ "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod" ];


const SiteEditForm: React.FC<{ 
    site: Site; 
    onSave: (siteData: Partial<Site>) => Promise<void>; 
    isSaving: boolean; 
    onClose: () => void;
}> = ({ site, onSave, isSaving, onClose }) => {
    const [formData, setFormData] = useState<Partial<Site>>(site);

    const handleSave = () => {
        const changes: Partial<Site> = {};
        (Object.keys(formData) as Array<keyof Site>).forEach(key => {
            // Check if there is a change
            if (key === 'geolocation') {
                if (formData.geolocation?.latitude !== site.geolocation?.latitude || formData.geolocation?.longitude !== site.geolocation?.longitude) {
                    changes[key] = formData[key];
                }
            } else if (formData[key] !== site[key]) {
                changes[key] = formData[key];
            }
        });
        
        if (Object.keys(changes).length > 0) {
            onSave(changes);
        } else {
            onClose(); // No changes to save
        }
    };

    return (
        <div className="grid gap-4 py-4">
            <div className="grid gap-2">
                <Label htmlFor="clientName">Client Name</Label>
                <Input id="clientName" value={formData.clientName || ''} onChange={(e) => setFormData({...formData, clientName: e.target.value})} />
            </div>
             <div className="grid gap-2">
                <Label htmlFor="siteName">Site Name</Label>
                <Input id="siteName" value={formData.siteName || ''} onChange={(e) => setFormData({...formData, siteName: e.target.value})} />
            </div>
             <div className="grid gap-2">
                <Label htmlFor="siteAddress">Site Address</Label>
                <Input id="siteAddress" value={formData.siteAddress || ''} onChange={(e) => setFormData({...formData, siteAddress: e.target.value})} />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="district">District</Label>
                 <Select value={formData.district} onValueChange={(value) => setFormData({...formData, district: value})}>
                    <SelectTrigger><SelectValue placeholder="Select a district" /></SelectTrigger>
                    <SelectContent>
                        {keralaDistricts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <DialogFooter>
                <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                </Button>
            </DialogFooter>
        </div>
    );
};


export default function SiteManagementPage() {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processedRecords, setProcessedRecords] = useState<ProcessedRecord[]>([]);
    const { toast } = useToast();
    
    // State for CRUD
    const [sites, setSites] = useState<Site[]>([]);
    const [isLoadingSites, setIsLoadingSites] = useState(true);
    const [editingSite, setEditingSite] = useState<Site | null>(null);
    const [deletingSite, setDeletingSite] = useState<Site | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        setIsLoadingSites(true);
        const sitesQuery = query(collection(db, 'sites'), orderBy('clientName', 'asc'), orderBy('siteName', 'asc'));
        const unsubscribe = onSnapshot(sitesQuery, (snapshot) => {
          const fetchedSites = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site));
          setSites(fetchedSites);
          setIsLoadingSites(false);
        }, (error) => {
          console.error("Error fetching sites: ", error);
          toast({ variant: "destructive", title: "Error", description: "Could not load site data." });
          setIsLoadingSites(false);
        });
        return () => unsubscribe();
    }, [toast]);


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
        const templateHeaders = ['Client Name', 'Site Name', 'Site ID', 'Site Address', 'Geolocation', 'District'];
        const templateExampleRow = ['Example Client Inc.', 'Main Branch', 'SITE-001', '123 Example St, Example City, EX 12345', '10.1234,76.5432', 'Ernakulam'];
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

                toast({ title: "Checking for duplicates...", description: "Comparing with existing site data." });
                const existingSitesSnapshot = await getDocs(collection(db, 'sites'));
                const existingSites = new Set(existingSitesSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return `${data.clientName?.toLowerCase()}_${data.siteName?.toLowerCase()}`;
                }));

                let validRecords: any[] = [];
                let localProcessedRecords: ProcessedRecord[] = [];

                jsonData.forEach((row: any, index) => {
                    let missingFields = requiredFields.filter(field => !row[field]);
                    if (missingFields.length > 0) {
                        localProcessedRecords.push({ data: row, status: 'error', message: `Row ${index + 2}: Missing required fields: ${missingFields.join(', ')}` });
                        return;
                    }

                    const clientName = row['Client Name'];
                    const siteName = row['Site Name'];
                    
                    const uniqueKey = `${clientName?.toLowerCase()}_${siteName?.toLowerCase()}`;
                    if (existingSites.has(uniqueKey)) {
                        localProcessedRecords.push({ data: row, status: 'duplicate', message: `Row ${index + 2}: This site already exists and was skipped.` });
                        return;
                    }
                    
                    if (!keralaDistricts.includes(row['District'])) {
                        localProcessedRecords.push({ data: row, status: 'error', message: `Row ${index + 2}: Invalid District "${row['District']}". Please use a valid Kerala district.` });
                        return;
                    }

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
                      clientName: clientName,
                      siteName: siteName,
                      siteId: row['Site ID'] || null,
                      siteAddress: row['Site Address'],
                      district: row['District'],
                      geolocation: new GeoPoint(latitude, longitude),
                      createdAt: serverTimestamp(),
                      updatedAt: serverTimestamp(),
                    };
                    
                    validRecords.push(siteData);
                });
                
                setProcessedRecords(localProcessedRecords);

                if (validRecords.length === 0) {
                    if (localProcessedRecords.length > 0) {
                        throw new Error("No new sites to import. All records were either duplicates or contained errors.");
                    } else {
                        throw new Error("No valid records found to import.");
                    }
                }

                toast({ title: "Uploading...", description: `Importing ${validRecords.length} new site records.` });

                const batch = writeBatch(db);
                const sitesRef = collection(db, "sites");

                validRecords.forEach(record => {
                    const siteDocRef = doc(sitesRef);
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

    const handleUpdateSite = async (updatedData: Partial<Site>) => {
        if (!editingSite) return;
        setIsSubmitting(true);
        try {
            const siteDocRef = doc(db, 'sites', editingSite.id);
            await updateDoc(siteDocRef, {
                ...updatedData,
                updatedAt: serverTimestamp(),
            });
            toast({ title: "Site Updated", description: "The site details have been saved." });
        } catch (error) {
            toast({ variant: "destructive", title: "Update Failed", description: "Could not update the site." });
        } finally {
            setIsSubmitting(false);
            setEditingSite(null);
        }
    };

    const handleDeleteSite = async () => {
        if (!deletingSite) return;
        setIsSubmitting(true);
        try {
            await deleteDoc(doc(db, 'sites', deletingSite.id));
            toast({ title: "Site Deleted", description: "The site has been removed." });
        } catch (error) {
            toast({ variant: "destructive", title: "Delete Failed", description: "Could not delete the site." });
        } finally {
            setIsSubmitting(false);
            setDeletingSite(null);
        }
    };

    const successCount = processedRecords.filter(r => r.status === 'success').length;
    const errorCount = processedRecords.filter(r => r.status === 'error').length;
    const duplicateCount = processedRecords.filter(r => r.status === 'duplicate').length;


    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" asChild>
                    <Link href="/settings">
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">Back to Settings</span>
                    </Link>
                </Button>
                <h1 className="text-3xl font-bold tracking-tight">Site Management</h1>
            </div>

            <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Instructions & Important Notes</AlertTitle>
                <AlertDescription>
                    <ul className="list-disc list-inside space-y-1">
                        <li>Use the forms below to import sites in bulk or manage existing sites individually.</li>
                        <li>**Bulk Import**: Download the template, fill it, and upload. This tool will not overwrite existing sites based on Client and Site Name.</li>
                        <li>**Geolocation** format must be: <code>latitude,longitude</code> (e.g., <code>10.1234,76.5432</code>).</li>
                    </ul>
                </AlertDescription>
            </Alert>

            <Card>
                <CardHeader>
                    <CardTitle>Bulk Site Import</CardTitle>
                    <CardDescription>Upload an Excel file to add multiple new sites at once.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-4">
                        <Button onClick={handleDownloadTemplate} variant="outline">
                            <Download className="mr-2 h-4 w-4" /> Download Template (.xlsx)
                        </Button>
                    </div>
                     <div className="flex flex-col sm:flex-row gap-4 items-center">
                        <div className="grid w-full max-w-sm items-center gap-1.5">
                            <Label htmlFor="site-file">Upload Completed File</Label>
                            <Input id="site-file" type="file" accept=".csv, .xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" onChange={handleFileChange} />
                        </div>
                        {file && (
                            <div className="flex items-center gap-2 p-2 border rounded-md bg-muted text-sm">
                                <FileCheck2 className="h-5 w-5 text-green-500" />
                                <span>{file.name}</span>
                            </div>
                        )}
                    </div>
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
                        <CardDescription className="flex flex-col sm:flex-row flex-wrap gap-x-4 gap-y-2">
                            <span className="flex items-center gap-1 text-green-600"><CheckCircle className="h-4 w-4"/>Successful: {successCount}</span>
                            <span className="flex items-center gap-1 text-yellow-600"><AlertTriangle className="h-4 w-4"/>Duplicates (Skipped): {duplicateCount}</span>
                            <span className="flex items-center gap-1 text-red-600"><AlertTriangle className="h-4 w-4"/>Failed: {errorCount}</span>
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="max-h-96 overflow-y-auto">
                       <div className="space-y-2">
                            {processedRecords.map((record, index) => (
                                <div key={index} className={`p-3 border rounded-md ${record.status === 'success' ? 'bg-green-50 border-green-200' : record.status === 'duplicate' ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
                                    <p className="font-semibold text-sm">
                                        {record.data['Site Name']} ({record.data['Client Name']})
                                    </p>
                                    <p className={`text-xs ${record.status === 'success' ? 'text-green-700' : record.status === 'duplicate' ? 'text-yellow-700' : 'text-red-700'}`}>
                                        {record.message}
                                    </p>
                                </div>
                            ))}
                       </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Existing Sites</CardTitle>
                    <CardDescription>A list of all currently managed sites in the system.</CardDescription>
                </CardHeader>
                <CardContent>
                     {isLoadingSites ? (
                        <div className="flex justify-center items-center h-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                    ) : sites.length === 0 ? (
                        <p className="text-center text-muted-foreground py-4">No sites found. Use the bulk import feature to add sites.</p>
                    ) : (
                        <div className="space-y-3">
                            {sites.map(site => (
                                <div key={site.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 border rounded-lg shadow-sm">
                                    <div className="flex-1 mb-2 sm:mb-0">
                                        <h3 className="font-semibold">{site.siteName}</h3>
                                        <p className="text-sm text-muted-foreground">{site.clientName}</p>
                                        <p className="text-xs text-muted-foreground mt-1">{site.siteAddress}</p>
                                        <Badge variant="outline" className="mt-2">{site.district}</Badge>
                                    </div>
                                    <div className="flex gap-2 self-start sm:self-center">
                                        <Button variant="outline" size="sm" onClick={() => setEditingSite(site)}><Edit className="mr-2 h-4 w-4"/>Edit</Button>
                                        <Button variant="destructive" size="sm" onClick={() => setDeletingSite(site)}><Trash2 className="mr-2 h-4 w-4"/>Delete</Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
                <CardFooter>
                    <p className="text-xs text-muted-foreground">Total sites: {sites.length}</p>
                </CardFooter>
            </Card>

            {/* Edit Dialog */}
            <Dialog open={!!editingSite} onOpenChange={(isOpen) => !isOpen && setEditingSite(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Site</DialogTitle>
                        <DialogDescription>Update the details for "{editingSite?.siteName}".</DialogDescription>
                    </DialogHeader>
                    {editingSite && <SiteEditForm site={editingSite} onSave={handleUpdateSite} isSaving={isSubmitting} onClose={() => setEditingSite(null)} />}
                </DialogContent>
            </Dialog>

            {/* Delete Dialog */}
            <AlertDialog open={!!deletingSite} onOpenChange={(isOpen) => !isOpen && setDeletingSite(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the site "{deletingSite?.siteName}". This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteSite} disabled={isSubmitting} className="bg-destructive hover:bg-destructive/90">
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
