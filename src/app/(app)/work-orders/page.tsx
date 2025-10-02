
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UploadCloud, Loader2, FileCheck2, UserPlus, Edit3, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, onSnapshot, orderBy, getDocs, writeBatch, serverTimestamp, doc, Timestamp, deleteDoc, addDoc } from 'firebase/firestore';
import { startOfToday } from 'date-fns';
import * as XLSX from 'xlsx';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { onAuthStateChanged, type User } from 'firebase/auth';
import Link from 'next/link';

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
    assignedGuards: any[];
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
                        // Check if the user is a field officer from our DB
                        const officersRef = collection(db, "fieldOfficers");
                        const q = query(officersRef, where("uid", "==", user.uid));
                        const snapshot = await getDocs(q);
                        if (!snapshot.empty) {
                            const officerData = snapshot.docs[0].data();
                            setUserRole('fieldOfficer');
                            setAssignedDistricts(officerData.assignedDistricts || []);
                        } else {
                            setUserRole('user'); // Or another default role
                            setAssignedDistricts([]);
                        }
                    }
                } catch (e) {
                    console.error("Error getting user role:", e);
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
        // Fetch upcoming work orders starting from today's midnight to include today's duties
        let q = query(collection(db, "workOrders"), where("date", ">=", Timestamp.fromDate(startOfToday())));

        if (userRole === 'fieldOfficer' && assignedDistricts.length > 0) {
            q = query(q, where("district", "in", assignedDistricts));
        } else if (userRole === 'fieldOfficer' && assignedDistricts.length === 0) {
            // Field officer has no assigned districts, so they see nothing.
            setIsLoading(false);
            setWorkOrdersBySite({});
            return;
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const todayMs = startOfToday().getTime();
            const orders = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() } as WorkOrder))
                .filter(o => {
                    try { return o.date.toDate().getTime() >= todayMs; } catch { return true; }
                });
            // Sort by date ascending client-side
            orders.sort((a,b) => a.date.toMillis() - b.date.toMillis());
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

                const headerRow1 = jsonData[0]; // top header row: labels and date columns
                const headerRow2 = jsonData[1]; // second header row: gender under each date
                const dataRows = jsonData.slice(2);

                // Map static columns by name
                const mapping: Record<string, string> = {
                    'S.No': 'sNo',
                    'ZONE': 'zone',
                    'STATE': 'state',
                    'CITY': 'district',
                    'TC CODE': 'siteCode',
                    'CENTER': 'siteName',
                    'TC Address': 'siteAddress',
                };

                // Helper to parse dates flexibly (Date object or strings like 04-Oct-25)
                const parseHeaderDate = (val: any): Date | null => {
                    if (val instanceof Date) {
                        // Normalize to local date (strip time/timezone drift from Excel)
                        return new Date(val.getFullYear(), val.getMonth(), val.getDate());
                    }
                    if (typeof val === 'number') {
                        // Excel serial number
                        // Excel serial number handling using workbook date system not available here reliably,
                        // attempt generic conversion: Excel serial (assuming 1900 system)
                        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                        const ms = Math.round((val - Math.floor(val)) * 24 * 60 * 60 * 1000);
                        const date = new Date(excelEpoch.getTime() + Math.floor(val) * 86400000 + ms);
                        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
                    }
                    if (typeof val === 'string') {
                        const s = val.trim();
                        const parsed = new Date(s);
                        if (!isNaN(parsed.getTime())) return parsed;
                        const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
                        if (m) {
                            const day = parseInt(m[1]);
                            const monStr = m[2].toLowerCase();
                            const yr = parseInt(m[3]);
                            const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
                            const month = months.indexOf(monStr);
                            const year = yr < 100 ? 2000 + yr : yr;
                            if (month >= 0) return new Date(year, month, day);
                        }
                    }
                    return null;
                };

                // Determine where date columns start by finding first Date/string-date in row1
                const staticIndices: Record<string, number> = {};
                let firstDateCol = -1;
                for (let i = 0; i < headerRow1.length; i++) {
                    const label = (headerRow1[i] ?? '').toString().trim();
                    if (parseHeaderDate(headerRow1[i])) {
                        firstDateCol = i;
                        break;
                    }
                    if (mapping[label] !== undefined) {
                        staticIndices[mapping[label]] = i;
                    }
                }
                if (firstDateCol === -1) throw new Error('Could not locate date columns in the header.');

                // Build date columns list by pairing MALE/FEMALE using the formatted header text
                const dateColumns: { date: Date; maleIndex: number; femaleIndex: number }[] = [];
                const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
                for (let c = firstDateCol; c <= range.e.c; c++) {
                    const addr = XLSX.utils.encode_cell({ r: 0, c });
                    const cell = (worksheet as any)[addr];
                    const raw = cell?.w ?? cell?.v;
                    const parsedDate = parseHeaderDate(raw);
                    if (!parsedDate) continue;
                    // genders in next row under date columns
                    const maleIdx = c + headerRow2.slice(c, c + 2).findIndex((x:any) => String(x).toUpperCase().includes('MALE'));
                    const femaleIdx = c + headerRow2.slice(c, c + 2).findIndex((x:any) => String(x).toUpperCase().includes('FEMALE'));
                    if (maleIdx >= c && femaleIdx >= c) {
                        dateColumns.push({ date: parsedDate, maleIndex: maleIdx, femaleIndex: femaleIdx });
                    }
                    c++; // skip paired column
                }
                
                if (dateColumns.length === 0) throw new Error("No valid date columns found in the file's header.");

                toast({ title: 'Matching Sites...', description: 'Comparing with database...' });
                const sitesSnapshot = await getDocs(collection(db, "sites"));
                const sitesByCode = new Map<string, any>(sitesSnapshot.docs.map(doc => [String(doc.data().siteId || '').trim(), { id: doc.id, ...doc.data() }]));
                // Fallback map by name+district
                const sitesByNameDistrict = new Map<string, any>(sitesSnapshot.docs.map(doc => {
                    const d = doc.data();
                    return [(`${(d.siteName||'').toLowerCase().trim()}|${(d.district||'').toLowerCase().trim()}`), { id: doc.id, ...d }];
                }));

                let operationsCount = 0;
                let createdSites = 0;

                for (const row of dataRows) {
                    const getVal = (key:string) => row[staticIndices[key]];
                    const siteCode = String(getVal('siteCode') ?? '').trim();
                    const siteName = String(getVal('siteName') ?? '').trim();
                    const siteAddress = String(getVal('siteAddress') ?? '').trim();
                    const state = String(getVal('state') ?? '').trim();
                    const district = String(getVal('district') ?? '').trim();

                    if (!siteName) continue;

                    let site = (siteCode && sitesByCode.get(siteCode)) || sitesByNameDistrict.get(`${siteName.toLowerCase()}|${district.toLowerCase()}`);

                    if (!site) {
                        // Create site if missing
                        const newSiteData = {
                            clientName: 'Unassigned',
                            siteName,
                            siteId: siteCode || null,
                            siteAddress: siteAddress || '',
                            district: district || '',
                            state: state || 'Kerala',
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                        } as any;
                        const newRef = await addDoc(collection(db, 'sites'), newSiteData);
                        site = { id: newRef.id, ...newSiteData };
                        if (siteCode) sitesByCode.set(siteCode, site);
                        sitesByNameDistrict.set(`${siteName.toLowerCase()}|${district.toLowerCase()}`, site);
                        createdSites++;
                    }

                    for (const { date, maleIndex, femaleIndex } of dateColumns) {
                        const maleGuardsRequired = Number(row[maleIndex]) || 0;
                        const femaleGuardsRequired = Number(row[femaleIndex]) || 0;
                        const totalManpower = maleGuardsRequired + femaleGuardsRequired;
                        if (totalManpower <= 0) continue;

                        // Normalize to local noon to avoid timezone off-by-one when stored/retrieved
                        const safeDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
                        const dateString = `${safeDate.getFullYear()}-${String(safeDate.getMonth()+1).padStart(2,'0')}-${String(safeDate.getDate()).padStart(2,'0')}`;
                        const workOrderId = `${site.id}_${dateString}`;
                        const workOrderRef = doc(db, 'workOrders', workOrderId);
                        await writeBatch(db).set(workOrderRef, {
                            siteId: site.id,
                            siteName: site.siteName,
                            clientName: site.clientName,
                            district: site.district,
                            date: Timestamp.fromDate(safeDate),
                            maleGuardsRequired,
                            femaleGuardsRequired,
                            totalManpower,
                            assignedGuards: [],
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                        }).commit();
                        operationsCount++;
                    }
                }

                if (operationsCount > 0) {
                    toast({ title: 'Success', description: `Processed ${operationsCount} daily work orders. New sites created: ${createdSites}.` });
                } else {
                    toast({ variant: 'default', title: 'No New Data', description: 'No new work order entries were found to import.' });
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
    
    const pageTitle = userRole === 'fieldOfficer' ? "Upcoming Duty Schedules" : "Work Order Management";

    return (
        <div className="flex flex-col gap-6">
            <h1 className="text-3xl font-bold tracking-tight">{pageTitle}</h1>

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
                    <CardTitle>Active Duty Sites</CardTitle>
                    <CardDescription>
                        {userRole === 'admin' ? 'List of all sites with upcoming work orders.' : 'List of sites in your assigned districts with upcoming duties.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                         <div className="flex justify-center items-center h-20">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : Object.keys(workOrdersBySite).length === 0 ? (
                        <p className="text-center text-muted-foreground py-10">No upcoming duties found.</p>
                    ) : (
                        <div className="space-y-4">
                            {Object.entries(workOrdersBySite).map(([siteId, orders]) => {
                                const siteInfo = orders[0];
                                return (
                                <div key={siteId} className="p-4 border rounded-lg">
                                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                                        <div className='flex-1'>
                                            <h3 className="font-semibold text-lg">{siteInfo.siteName}</h3>
                                            <p className="text-sm text-muted-foreground">{siteInfo.clientName} - <Badge variant="secondary">{siteInfo.district}</Badge></p>
                                        </div>
                                         <div className="flex gap-2">
                                         {userRole === 'admin' && (
                                            <Button size="sm" variant="outline" asChild>
                                                <Link href={`/work-orders/${siteId}`}>
                                                    <Edit3 className="mr-2 h-4 w-4" />
                                                    Edit Duties
                                                </Link>
                                            </Button>
                                         )}
                                         <Button size="sm" variant="outline" asChild>
                                            <Link href={`/work-orders/${siteId}`}>
                                                <UserPlus className="mr-2 h-4 w-4" />
                                                Assign Guards
                                            </Link>
                                        </Button>
                                        </div>
                                    </div>
                                    <div className="mt-4">
                                        <h4 className="text-sm font-medium mb-2">Required Manpower:</h4>
                                        <div className="flex flex-wrap gap-2">
                                            {orders.map(order => {
                                                const totalRequired = (order.totalManpower ?? 0) || ((order.maleGuardsRequired || 0) + (order.femaleGuardsRequired || 0));
                                                const assignedCount = Array.isArray(order.assignedGuards) ? order.assignedGuards.length : 0;
                                                const percent = totalRequired > 0 ? Math.min(100, Math.round((assignedCount / totalRequired) * 100)) : 0;
                                                const status = assignedCount === 0 ? 'Unassigned' : (assignedCount >= totalRequired ? 'Fully Assigned' : 'Partially Assigned');
                                                const statusClasses = assignedCount === 0
                                                    ? 'bg-red-100 text-red-700 border-red-200'
                                                    : (assignedCount >= totalRequired ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-800 border-amber-200');
                                                return (
                                                    <div key={order.id} className={`relative p-2 border rounded-md text-center min-w-[160px] ${assignedCount === 0 ? 'bg-red-50/40' : (assignedCount >= totalRequired ? 'bg-green-50/40' : 'bg-amber-50/40')}`}>
                                                        <div className="flex items-center justify-between gap-2">
                                                            <p className="text-xs font-semibold">{order.date.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                                            <span className={`text-[10px] px-2 py-0.5 rounded border ${statusClasses}`}>{status}</span>
                                                        </div>
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
                                                                <p className="text-lg font-bold">{totalRequired}</p>
                                                                <p className="text-xs text-muted-foreground">Total</p>
                                                            </div>
                                                        </div>
                                                        <div className="mt-2 space-y-1">
                                                            <Progress value={percent} className="h-1.5" />
                                                            <p className="text-[11px] text-muted-foreground">Assigned {assignedCount}/{totalRequired} ({percent}%)</p>
                                                        </div>
                                                        {userRole === 'admin' && (
                                                            <button
                                                                className="absolute top-1 right-1 rounded p-1 text-destructive hover:bg-red-50"
                                                                title="Delete duty"
                                                                onClick={async ()=>{
                                                                    try { await deleteDoc(doc(db,'workOrders', order.id)); } catch(e){ console.error(e); }
                                                                }}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
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
