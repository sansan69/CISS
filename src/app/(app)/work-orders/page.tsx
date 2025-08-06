
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UploadCloud, Download, Loader2, FileCheck2, UserPlus, ClipboardList, User, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db, storage, auth } from '@/lib/firebase';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { ref, uploadBytes } from "firebase/storage";
import * as XLSX from 'xlsx';
import { Badge } from '@/components/ui/badge';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';

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
    const [isUploading, setIsUploading] = useState(false);
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
            const validTypes = ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'];
            if (validTypes.includes(selectedFile.type)) {
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
    
    // The template download is no longer necessary as we upload the client's file directly.
    // I am keeping the function here in case it's needed for reference, but removing the button.
    const handleDownloadTemplate = () => {
        const templateData = [
            ['Client Name', 'Site Name', 'Date', 'Manpower Required']
        ];
        const ws = XLSX.utils.aoa_to_sheet(templateData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Work Order Template");
        XLSX.writeFile(wb, "CISS_WorkOrder_Template.xlsx");
    };

    const handleUpload = async () => {
        if (!file) {
            toast({ variant: 'destructive', title: 'No File Selected' });
            return;
        }
        setIsUploading(true);
        toast({ title: 'Uploading File...', description: 'Your file is being uploaded and will be processed in the background.' });
        
        try {
            const storageRef = ref(storage, `work-order-uploads/${Date.now()}_${file.name}`);
            await uploadBytes(storageRef, file);

            toast({
                title: 'Upload Complete',
                description: 'The file has been uploaded successfully. Processing will begin shortly.',
            });
            setFile(null);
        } catch (error: any) {
            console.error("Error uploading file: ", error);
            toast({ variant: 'destructive', title: 'Upload Failed', description: 'Could not upload the file. Please try again.' });
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <h1 className="text-3xl font-bold tracking-tight">Work Order Management</h1>

            {userRole === 'admin' && (
                <Card>
                    <CardHeader>
                        <CardTitle>Upload Work Order</CardTitle>
                        <CardDescription>Upload the work order file received from the client. The system will process it in the background.</CardDescription>
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
                         <Button onClick={handleUpload} disabled={isUploading || !file}>
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                            {isUploading ? 'Uploading...' : 'Upload & Process File'}
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

    