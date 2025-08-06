
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
            const validTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'];
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
        toast({ title: 'Processing File...', description: 'Please wait while we read the work order data.' });
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                if (jsonData.length < 2) throw new Error("File is empty or has only a header.");
                
                const headers = jsonData[0];
                const dateHeaderIndex = headers.findIndex((h: string) => h && h.match(/^\d{2}-[A-Za-z]{3}-\d{2}$/));
                if (dateHeaderIndex === -1) throw new Error("A date column (e.g., 03-Aug-25) was not found in the header.");
                
                const dateString = headers[dateHeaderIndex];
                const workDate = new Date(dateString);
                if (isNaN(workDate.getTime())) throw new Error(`Invalid date in header: ${dateString}`);
                const firestoreTimestamp = Timestamp.fromDate(workDate);

                const columnMapping: {[key: string]: string} = { "CITY": "district", "TC CODE": "siteId", "CENTER": "siteName", "MALE": "maleGuardsRequired", "FEMALE": "femaleGuardsRequired" };
                const mappedHeaders = headers.map((h: string) => columnMapping[h] || h);

                const rows = jsonData.slice(1);
                const sitesSnapshot = await getDocs(collection(db, "sites"));
                const sitesMap = new Map(sitesSnapshot.docs.map(doc => [String(doc.data().siteId), {id: doc.id, ...doc.data()}]));

                const batch = writeBatch(db);
                let operationsCount = 0;

                for (const row of rows) {
                    const rowData: {[key: string]: any} = {};
                    mappedHeaders.forEach((key: string, index: number) => { rowData[key] = row[index]; });

                    const { siteId, maleGuardsRequired, femaleGuardsRequired } = rowData;
                    if (!siteId || maleGuardsRequired === undefined || femaleGuardsRequired === undefined) continue;
                    
                    const site = sitesMap.get(String(siteId));
                    if (!site) {
                        console.warn(`Site not found for TC CODE "${siteId}". Skipping.`);
                        continue;
                    }

                    const maleCount = Number(maleGuardsRequired) || 0;
                    const femaleCount = Number(femaleGuardsRequired) || 0;
                    const totalManpower = maleCount + femaleCount;
                    if (totalManpower === 0) continue;

                    const workOrderId = `${site.id}_${dateString.replace(/-/g, "")}`;
                    const workOrderRef = doc(db, "workOrders", workOrderId);
                    
                    batch.set(workOrderRef, {
                        siteId: site.id,
                        siteName: site.siteName,
                        clientName: site.clientName,
                        district: site.district,
                        date: firestoreTimestamp,
                        maleGuardsRequired: maleCount,
                        femaleGuardsRequired: femaleCount,
                        totalManpower: totalManpower,
                        assignedGuards: {},
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    });
                    operationsCount++;
                }

                if (operationsCount > 0) {
                    await batch.commit();
                    toast({ title: 'Success', description: `Processed and committed ${operationsCount} work order entries for ${dateString}.` });
                } else {
                    toast({ variant: 'default', title: 'No New Data', description: 'No new work order entries were found to import.' });
                }

            } catch (error: any) {
                console.error("Error processing file:", error);
                toast({ variant: 'destructive', title: 'Processing Failed', description: error.message || 'Could not process the file.' });
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
                        <CardDescription>Upload the work order file received from the client. The system will process it directly.</CardDescription>
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
                                                <div key={order.id} className="p-2 border rounded-md text-center bg-muted/50 w-32">
                                                    <p className="text-xs font-semibold">{order.date.toDate().toLocaleDateString('en-GB')}</p>
                                                    <div className="flex justify-around items-center mt-1">
                                                        <div className="text-center">
                                                            <p className="text-lg font-bold">{order.maleGuardsRequired}</p>
                                                            <p className="text-xs text-muted-foreground">Male</p>
                                                        </div>
                                                         <div className="text-center">
                                                            <p className="text-lg font-bold">{order.femaleGuardsRequired}</p>
                                                            <p className="text-xs text-muted-foreground">Female</p>
                                                        </div>
                                                        <div className="text-center">
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
