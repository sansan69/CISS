
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UploadCloud, Loader2, FileCheck2, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, onSnapshot, orderBy, getDocs, writeBatch, serverTimestamp, doc, Timestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Badge } from '@/components/ui/badge';
import { onAuthStateChanged } from 'firebase/auth';

interface WorkOrder {
    id: string;
    siteId: string;
    siteName: string;
    clientName: string;
    district: string;
    date: any; 
    maleGuardsRequired: number;
    femaleGuardsRequired: number;
    totalManpower: number;
    assignedGuards: any;
}

export default function WorkOrderPage() {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const { toast } = useToast();
    
    const [workOrdersBySite, setWorkOrdersBySite] = useState<{[key: string]: WorkOrder[]}>({});
    const [isLoading, setIsLoading] = useState(true);
    const [userRole, setUserRole] = useState<string | null>(null);
    const [assignedDistricts, setAssignedDistricts] = useState<string[]>([]);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    const tokenResult = await user.getIdTokenResult();
                    const claims = tokenResult.claims;
                    if (user.email === 'admin@cisskerala.app') {
                        setUserRole('admin');
                        setAssignedDistricts([]);
                    } else {
                        setUserRole(claims.role as string || 'user'); 
                        setAssignedDistricts(claims.districts as string[] || []);
                    }
                } catch (e) {
                    setUserRole('user');
                    setAssignedDistricts([]);
                }
            } else {
                setUserRole(null);
                setAssignedDistricts([]);
            }
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (userRole === null) return;
        
        setIsLoading(true);
        let q = query(collection(db, "workOrders"), orderBy("date", "asc"));

        if (userRole === 'fieldOfficer' && assignedDistricts.length > 0) {
            q = query(q, where("district", "in", assignedDistricts));
        } else if (userRole === 'fieldOfficer' && assignedDistricts.length === 0) {
            setIsLoading(false);
            setWorkOrdersBySite({});
            return;
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WorkOrder));
            const groupedBySite = orders.reduce((acc, order) => {
                const key = order.siteId;
                if (!acc[key]) {
                    acc[key] = [];
                }
                acc[key].push(order);
                return acc;
            }, {} as {[key: string]: WorkOrder[]});
            setWorkOrdersBySite(groupedBySite);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching work orders:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch work orders.' });
            setIsLoading(false);
        });

        return () => unsubscribe();

    }, [userRole, assignedDistricts, toast]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            const selectedFile = event.target.files[0];
            const validTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/vnd.ms-excel'];
            if (validTypes.some(type => selectedFile.type.includes(type))) {
                setFile(selectedFile);
            } else {
                toast({
                    variant: 'destructive',
                    title: 'Invalid File Type',
                    description: 'Please upload a CSV or XLSX file.',
                });
            }
        }
    };

    const handleUploadAndProcess = async () => {
        if (!file) {
            toast({ variant: 'destructive', title: 'No File Selected' });
            return;
        }
        setIsProcessing(true);
        toast({ title: 'Processing File...', description: 'Reading work order data. This may take a moment.' });
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

                if (jsonData.length < 3) throw new Error("File must have at least 3 rows (2 header rows and 1 data row).");
                
                const dateHeader = jsonData[0];
                const genderHeader = jsonData[1];
                const siteDataRows = jsonData.slice(2);

                const columnMapping: {[key: string]: string} = { "S.No": "sNo", "ZONE": "zone", "STATE": "state", "CITY": "city", "TC CODE": "siteId", "CENTER": "siteName" };
                
                // Map static columns
                const staticHeaders: string[] = jsonData[1].slice(0, 6).map((h:any, i: number) => columnMapping[jsonData[0][i]] || jsonData[0][i]);

                // Parse date columns
                const dateColumns: { date: Date, maleIndex: number, femaleIndex: number }[] = [];
                for (let i = 6; i < dateHeader.length; i++) {
                    const dateValue = dateHeader[i];
                    if (dateValue instanceof Date && genderHeader[i] === 'MALE') {
                        dateColumns.push({
                            date: dateValue,
                            maleIndex: i,
                            femaleIndex: i + 1,
                        });
                    }
                }
                
                if (dateColumns.length === 0) throw new Error("No valid date columns found in the file's header.");

                toast({ title: 'Matching Sites...', description: 'Comparing with database...' });
                const sitesSnapshot = await getDocs(collection(db, "sites"));
                const sitesMap = new Map(sitesSnapshot.docs.map(doc => [String(doc.data().siteId).trim(), {id: doc.id, ...doc.data()}]));

                const batch = writeBatch(db);
                let operationsCount = 0;
                let skippedSites = new Set<string>();

                for (const row of siteDataRows) {
                    const rowData: {[key: string]: any} = {};
                    staticHeaders.forEach((key, index) => { rowData[key] = row[index]; });
                    
                    const siteId = String(rowData.siteId).trim();
                    if (!siteId) continue;

                    const site = sitesMap.get(siteId);
                    if (!site) {
                        skippedSites.add(siteId);
                        continue;
                    }

                    for (const { date, maleIndex, femaleIndex } of dateColumns) {
                        const maleGuardsRequired = Number(row[maleIndex]) || 0;
                        const femaleGuardsRequired = Number(row[femaleIndex]) || 0;
                        const totalManpower = maleGuardsRequired + femaleGuardsRequired;
                        
                        if (totalManpower > 0) {
                            const dateString = date.toISOString().split('T')[0]; // YYYY-MM-DD format for ID
                            const workOrderId = `${site.id}_${dateString}`;
                            const workOrderRef = doc(db, "workOrders", workOrderId);
                            
                            batch.set(workOrderRef, {
                                siteId: site.id,
                                siteName: site.siteName,
                                clientName: site.clientName,
                                district: site.district,
                                date: Timestamp.fromDate(date),
                                maleGuardsRequired: maleGuardsRequired,
                                femaleGuardsRequired: femaleGuardsRequired,
                                totalManpower: totalManpower,
                                assignedGuards: {},
                                createdAt: serverTimestamp(),
                                updatedAt: serverTimestamp(),
                            });
                            operationsCount++;
                        }
                    }
                }

                if (operationsCount > 0) {
                    await batch.commit();
                    toast({ title: 'Success', description: `Processed and committed ${operationsCount} daily work orders.` });
                } else {
                    toast({ variant: 'default', title: 'No New Data', description: 'No new work order entries were found to import.' });
                }
                
                if (skippedSites.size > 0) {
                    toast({ variant: 'destructive', title: 'Skipped Sites', description: `Skipped ${skippedSites.size} sites not found in the database. TC Codes: ${Array.from(skippedSites).join(', ')}`, duration: 10000 });
                }

            } catch (error: any) {
                console.error("Error processing file:", error);
                toast({ variant: 'destructive', title: 'Processing Failed', description: error.message || 'Could not process the file.', duration: 8000 });
            } finally {
                setIsProcessing(false);
                setFile(null);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    return (
        <div className="flex flex-col gap-6">
            <h1 className="text-3xl font-bold tracking-tight">Work Order Management</h1>

            {userRole === 'admin' && (
                <Card>
                    <CardHeader>
                        <CardTitle>Upload Work Order</CardTitle>
                        <CardDescription>Upload the work order Excel file from the client. The system will process multiple dates from one file.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid w-full max-w-sm items-center gap-1.5">
                            <Label htmlFor="work-order-file">Work Order File (Excel/CSV)</Label>
                            <Input id="work-order-file" type="file" accept=".csv, .xlsx, .xls" onChange={handleFileChange} />
                        </div>
                         {file && (
                            <div className="flex items-center gap-2 p-2 border rounded-md bg-muted text-sm">
                                <FileCheck2 className="h-5 w-5 text-green-500" />
                                <span>{file.name}</span>
                            </div>
                        )}
                    </CardContent>
                    <CardFooter>
                         <Button onClick={handleUploadAndProcess} disabled={isProcessing || !file}>
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                            {isProcessing ? 'Processing...' : 'Upload & Process File'}
                        </Button>
                    </CardFooter>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Active Work Orders</CardTitle>
                    <CardDescription>
                        {userRole === 'admin' ? 'List of all sites with active work orders.' : 'List of sites in your assigned districts with active work orders.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                         <div className="flex justify-center items-center h-20">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : Object.keys(workOrdersBySite).length === 0 ? (
                        <p className="text-center text-muted-foreground py-10">No active work orders found.</p>
                    ) : (
                        <div className="space-y-4">
                            {Object.entries(workOrdersBySite).map(([siteId, orders]) => {
                                const siteInfo = orders[0];
                                return (
                                <div key={siteId} className="p-4 border rounded-lg">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="font-semibold text-lg">{siteInfo.siteName}</h3>
                                            <p className="text-sm text-muted-foreground">{siteInfo.clientName} - <Badge variant="secondary">{siteInfo.district}</Badge></p>
                                        </div>
                                         <Button size="sm" variant="outline">
                                            <UserPlus className="mr-2 h-4 w-4" />
                                            Assign Guards
                                        </Button>
                                    </div>
                                    <div className="mt-4">
                                        <h4 className="text-sm font-medium mb-2">Required Manpower:</h4>
                                        <div className="flex flex-wrap gap-2">
                                            {orders.map(order => (
                                                <div key={order.id} className="p-2 border rounded-md text-center bg-muted/50 min-w-[120px]">
                                                    <p className="text-xs font-semibold">{order.date.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                                    <div className="flex justify-around items-center mt-1 pt-1 border-t">
                                                        <div className="text-center px-1">
                                                            <p className="text-lg font-bold">{order.maleGuardsRequired}</p>
                                                            <p className="text-xs text-muted-foreground">Male</p>
                                                        </div>
                                                         <div className="text-center px-1">
                                                            <p className="text-lg font-bold">{order.femaleGuardsRequired}</p>
                                                            <p className="text-xs text-muted-foreground">Female</p>
                                                        </div>
                                                        <div className="text-center px-1">
                                                            <p className="text-lg font-bold">{order.totalManpower}</p>
                                                            <p className="text-xs text-muted-foreground">Total</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )})}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

    