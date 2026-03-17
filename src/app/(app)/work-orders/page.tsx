
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UploadCloud, Loader2, FileCheck2, UserPlus, Edit3, Trash2, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db, auth } from '@/lib/firebase';
import { GeoPoint, collection, query, where, onSnapshot, orderBy, getDocs, serverTimestamp, doc, Timestamp, deleteDoc, addDoc, getDoc, setDoc, arrayUnion } from 'firebase/firestore';
import { startOfToday, format } from 'date-fns';
import * as XLSX from 'xlsx';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { onAuthStateChanged, type User } from 'firebase/auth';
import Link from 'next/link';
import { resolveAppUser } from '@/lib/auth/roles';
import { buildFirestoreAuditEvent, buildFirestoreCreateAudit, buildFirestoreUpdateAudit } from '@/lib/firestore-audit';
import { OPERATIONAL_CLIENT_NAME } from '@/lib/constants';
import { buildLocationIdentity } from '@/lib/location-utils';
import { PageHeader } from '@/components/layout/page-header';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

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

const isSameDay = (a: Date, b: Date) => {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
};

export default function WorkOrderPage() {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const { toast } = useToast();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    
    const [workOrdersBySite, setWorkOrdersBySite] = useState<{[key: string]: WorkOrder[]}>({});
    const [isLoading, setIsLoading] = useState(true);
    const [userRole, setUserRole] = useState<string | null>(null);
    const [assignedDistricts, setAssignedDistricts] = useState<string[]>([]);

    // ── Soft-delete with undo ────────────────────────────────────────────────
    // Orders hidden optimistically while the undo window is open
    const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
    // Map of orderId → saved data snapshot (for undo restore)
    const pendingDeleteData = React.useRef<Map<string, WorkOrder>>(new Map());
    // Map of orderId → timer handle
    const pendingDeleteTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const UNDO_MS = 5_000;

    // ── Expand / collapse per site ───────────────────────────────────────────
    // Tracks which siteIds are *collapsed*; all sites start expanded.
    const [collapsedSites, setCollapsedSites] = useState<Set<string>>(new Set());

    const toggleSite = React.useCallback((siteId: string) => {
        setCollapsedSites(prev => {
            const next = new Set(prev);
            if (next.has(siteId)) next.delete(siteId);
            else next.add(siteId);
            return next;
        });
    }, []);


    const handleDeleteOrder = React.useCallback((order: WorkOrder) => {
        const id = order.id;

        // 1. Optimistically hide
        setPendingDeleteIds(prev => new Set(prev).add(id));
        pendingDeleteData.current.set(id, order);

        // 2. Schedule actual Firestore delete after UNDO_MS
        const timer = setTimeout(async () => {
            try {
                await deleteDoc(doc(db, 'workOrders', id));
            } catch (e) {
                console.error('Delete failed', e);
                // Restore on error
                setPendingDeleteIds(prev => { const s = new Set(prev); s.delete(id); return s; });
                toast({ title: 'Delete failed', description: 'The work order could not be deleted.', variant: 'destructive' });
            }
            pendingDeleteData.current.delete(id);
            pendingDeleteTimers.current.delete(id);
            setPendingDeleteIds(prev => { const s = new Set(prev); s.delete(id); return s; });
        }, UNDO_MS);
        pendingDeleteTimers.current.set(id, timer);

        // 3. Show undo toast
        toast({
            title: 'Work order deleted',
            description: 'The duty entry has been removed.',
            duration: UNDO_MS,
            action: (
                <button
                    onClick={() => {
                        // Cancel the delete
                        clearTimeout(pendingDeleteTimers.current.get(id));
                        pendingDeleteTimers.current.delete(id);
                        pendingDeleteData.current.delete(id);
                        setPendingDeleteIds(prev => { const s = new Set(prev); s.delete(id); return s; });
                        toast({ title: 'Undo successful', description: 'Work order has been restored.', duration: 2500 });
                    }}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                    Undo
                </button>
            ) as any,
        });
    }, [toast]);
    const selectedDistrict = searchParams.get('district') || 'all';
    const dateSort = searchParams.get('dateSort') === 'desc' ? 'desc' : 'asc';
    const selectedDateValue = searchParams.get('date') || '';
    const selectedDate = useMemo(() => {
        if (!selectedDateValue) return null;
        const parsed = new Date(`${selectedDateValue}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }, [selectedDateValue]);

    const geocodeDutySite = async (siteAddress: string, district: string) => {
        if (!siteAddress.trim()) return null;
        const response = await fetch('/api/locations/geocode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                address: siteAddress,
                district,
                entityType: 'site',
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || typeof data.lat !== 'number' || typeof data.lng !== 'number') {
            return null;
        }
        return data as {
            lat: number;
            lng: number;
            formattedAddress?: string;
            placeAccuracy?: string;
        };
    };

    const updateUrlParams = (updates: Record<string, string | null>) => {
        const params = new URLSearchParams(searchParams.toString());

        Object.entries(updates).forEach(([key, value]) => {
            if (!value || value === 'all') {
                params.delete(key);
            } else {
                params.set(key, value);
            }
        });

        const next = params.toString();
        router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    const appUser = await resolveAppUser(user);
                    setUserRole(appUser.role);
                    setAssignedDistricts(appUser.assignedDistricts);
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

    // Distinct districts present in current work orders (for filter dropdown)
    const availableDistricts = useMemo(() => {
        const set = new Set<string>();
        Object.values(workOrdersBySite).forEach(orders => {
            orders.forEach(order => {
                if (order.district) {
                    set.add(order.district);
                }
            });
        });
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [workOrdersBySite]);

    // Apply district/date filters and sort by date for display
    const filteredEntries = useMemo(() => {
        const entries = Object.entries(workOrdersBySite);
        const result: [string, WorkOrder[]][] = [];

        for (const [siteId, orders] of entries) {
            let filtered = orders;

            if (selectedDistrict !== 'all') {
                const districtLower = selectedDistrict.toLowerCase();
                filtered = filtered.filter(o => (o.district || '').toLowerCase() === districtLower);
            }

            if (selectedDate) {
                filtered = filtered.filter(o => {
                    try {
                        const d = o.date.toDate() as Date;
                        return isSameDay(d, selectedDate);
                    } catch {
                        return false;
                    }
                });
            }

            if (filtered.length === 0) continue;

            const sortedOrders = [...filtered].sort((a, b) => {
                try {
                    const aTime = a.date.toMillis();
                    const bTime = b.date.toMillis();
                    return dateSort === 'asc' ? aTime - bTime : bTime - aTime;
                } catch {
                    return 0;
                }
            });

            result.push([siteId, sortedOrders]);
        }

        // Sort sites by their earliest (or latest) duty date according to sort order
        result.sort(([, aOrders], [, bOrders]) => {
            const aTime = aOrders[0]?.date?.toMillis?.() ?? 0;
            const bTime = bOrders[0]?.date?.toMillis?.() ?? 0;
            return dateSort === 'asc' ? aTime - bTime : bTime - aTime;
        });

        return result;
    }, [workOrdersBySite, selectedDistrict, selectedDate, dateSort]);

    // Derived from filteredEntries — must come after the useMemo above
    const allCollapsed = filteredEntries.length > 0 && collapsedSites.size >= filteredEntries.length;
    const toggleAll = React.useCallback(() => {
        if (allCollapsed) {
            setCollapsedSites(new Set());
        } else {
            setCollapsedSites(new Set(filteredEntries.map(([id]) => id)));
        }
    }, [allCollapsed, filteredEntries]);

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
                        const geocode = await geocodeDutySite(siteAddress || '', district || '');
                        const newSiteData = {
                            clientName: OPERATIONAL_CLIENT_NAME,
                            clientId: null,
                            siteName,
                            siteId: siteCode || null,
                            siteAddress: siteAddress || '',
                            district: district || '',
                            state: state || 'Kerala',
                            geolocation: geocode ? new GeoPoint(geocode.lat, geocode.lng) : null,
                            latString: geocode ? geocode.lat.toFixed(6) : null,
                            lngString: geocode ? geocode.lng.toFixed(6) : null,
                            coordinateStatus: geocode ? 'geocoded' : 'missing',
                            coordinateSource: geocode ? 'geocode' : null,
                            placeAccuracy: geocode?.placeAccuracy ?? null,
                            geocodedAt: geocode ? serverTimestamp() : null,
                            geofenceRadiusMeters: 150,
                            strictGeofence: true,
                            shiftMode: 'none',
                            shiftPattern: null,
                            shiftTemplates: [],
                            locationKey: buildLocationIdentity([OPERATIONAL_CLIENT_NAME, siteName, district]),
                            ...buildFirestoreCreateAudit(),
                        } as any;
                        const newRef = await addDoc(collection(db, 'sites'), newSiteData);
                        site = { id: newRef.id, ...newSiteData };
                        if (siteCode) sitesByCode.set(siteCode, site);
                        sitesByNameDistrict.set(`${siteName.toLowerCase()}|${district.toLowerCase()}`, site);
                        createdSites++;
                    }

                    for (const { date, maleIndex, femaleIndex } of dateColumns) {
                        const maleFromFile = Number(row[maleIndex]) || 0;
                        const femaleFromFile = Number(row[femaleIndex]) || 0;
                        const additionalTotal = maleFromFile + femaleFromFile;
                        // Skip if this file has no requirement for that date
                        if (additionalTotal <= 0) continue;

                        // Normalize to local noon to avoid timezone off-by-one when stored/retrieved
                        const safeDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
                        const dateString = `${safeDate.getFullYear()}-${String(safeDate.getMonth()+1).padStart(2,'0')}-${String(safeDate.getDate()).padStart(2,'0')}`;
                        const workOrderId = `${site.id}_${dateString}`;
                        const workOrderRef = doc(db, 'workOrders', workOrderId);

                        // If a work order already exists for this site+date, ADD to existing counts instead of replacing.
                        const existingSnap = await getDoc(workOrderRef);
                        let finalMale = maleFromFile;
                        let finalFemale = femaleFromFile;
                        let existingAssigned: any[] = [];
                        let existingCreatedAt: any = null;
                        let existingDate: any = Timestamp.fromDate(safeDate);

                        if (existingSnap.exists()) {
                            const existing = existingSnap.data() as any;
                            const existingMale = Number(existing.maleGuardsRequired || 0);
                            const existingFemale = Number(existing.femaleGuardsRequired || 0);
                            finalMale += existingMale;
                            finalFemale += existingFemale;
                            existingAssigned = Array.isArray(existing.assignedGuards) ? existing.assignedGuards : [];
                            existingCreatedAt = existing.createdAt || null;
                            existingDate = existing.date || existingDate;
                        }

                        const totalManpower = finalMale + finalFemale;

                        await setDoc(workOrderRef, {
                            siteId: site.id,
                            siteName: site.siteName,
                            clientName: OPERATIONAL_CLIENT_NAME,
                            district: site.district,
                            date: existingDate,
                            maleGuardsRequired: finalMale,
                            femaleGuardsRequired: finalFemale,
                            totalManpower,
                            // Preserve any existing guard assignments when re-importing
                            assignedGuards: existingAssigned,
                            createdAt: existingCreatedAt ?? serverTimestamp(),
                            ...buildFirestoreUpdateAudit(),
                            importHistory: arrayUnion(
                                buildFirestoreAuditEvent('work_order_imported', undefined, {
                                    siteId: site.id,
                                    siteName: site.siteName,
                                    date: dateString,
                                    maleGuardsRequired: finalMale,
                                    femaleGuardsRequired: finalFemale,
                                    totalManpower,
                                }),
                            ),
                        }, { merge: true });

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
    const listQueryString = searchParams.toString();
    const siteHref = (siteId: string) => (listQueryString ? `/work-orders/${siteId}?${listQueryString}` : `/work-orders/${siteId}`);

    return (
        <div className="flex flex-col gap-4 sm:gap-6">
            <PageHeader
                eyebrow="Workforce"
                title={pageTitle}
                description={
                    userRole === 'admin'
                        ? 'Upload and manage TCS duty requirements across active duty sites.'
                        : 'Review the TCS duty requirements that are relevant to your assigned districts.'
                }
                breadcrumbs={[
                    { label: "Dashboard", href: "/dashboard" },
                    { label: pageTitle },
                ]}
            />

            {userRole === 'admin' && (
                <Card>
                    <CardHeader>
                        <CardTitle>Upload Work Order</CardTitle>
                        <CardDescription>Upload the TCS duty requirement Excel file. The system will process multiple dates from one file.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid w-full items-center gap-1.5 sm:max-w-sm">
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
                         <Button onClick={handleUploadAndProcess} disabled={isProcessing || !file} className="w-full sm:w-auto">
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                            {isProcessing ? 'Processing...' : 'Upload & Process File'}
                        </Button>
                    </CardFooter>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <CardTitle>Active Duty Sites</CardTitle>
                            <CardDescription>
                                {userRole === 'admin'
                                    ? 'List of all TCS duty sites with upcoming work orders.'
                                    : 'List of TCS duty sites in your assigned districts with upcoming duties.'}
                            </CardDescription>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                            <div className="flex flex-col gap-1 min-w-[160px]">
                                <Label className="text-xs font-medium text-muted-foreground">Filter by date</Label>
                                <Input
                                    type="date"
                                    value={selectedDate ? format(selectedDate, 'yyyy-MM-dd') : ''}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        updateUrlParams({ date: value || null });
                                    }}
                                    className="h-9"
                                />
                            </div>
                            <div className="flex flex-col gap-1 min-w-[160px]">
                                <Label className="text-xs font-medium text-muted-foreground">Filter by district</Label>
                                <Select
                                    value={selectedDistrict}
                                    onValueChange={(val) => updateUrlParams({ district: val })}
                                >
                                    <SelectTrigger className="h-9">
                                        <SelectValue placeholder="All districts" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All districts</SelectItem>
                                        {availableDistricts.map((d) => (
                                            <SelectItem key={d} value={d}>
                                                {d}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex flex-col gap-1 min-w-[160px]">
                                <Label className="text-xs font-medium text-muted-foreground">Sort by date</Label>
                                <Select
                                    value={dateSort}
                                    onValueChange={(val) => updateUrlParams({ dateSort: val })}
                                >
                                    <SelectTrigger className="h-9">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="asc">Earliest first</SelectItem>
                                        <SelectItem value="desc">Latest first</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                         <div className="flex justify-center items-center h-20">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : Object.keys(workOrdersBySite).length === 0 ? (
                        <p className="text-center text-muted-foreground py-10">No upcoming duties found.</p>
                    ) : filteredEntries.length === 0 ? (
                        <p className="text-center text-muted-foreground py-10">No duties match the current filters.</p>
                    ) : (
                        <div className="space-y-3">
                            {/* Expand / Collapse all */}
                            <div className="flex justify-end">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                                    onClick={toggleAll}
                                >
                                    <ChevronsUpDown className="h-3.5 w-3.5" />
                                    {allCollapsed ? 'Expand all' : 'Collapse all'}
                                </Button>
                            </div>

                            {filteredEntries.map(([siteId, orders]) => {
                                const siteInfo = orders[0];
                                const isCollapsed = collapsedSites.has(siteId);
                                const visibleOrders = orders.filter(o => !pendingDeleteIds.has(o.id));
                                const totalDates = visibleOrders.length;
                                const totalGuards = visibleOrders.reduce((s, o) => s + ((o.totalManpower ?? 0) || (o.maleGuardsRequired || 0) + (o.femaleGuardsRequired || 0)), 0);
                                const unassigned = visibleOrders.filter(o => (Array.isArray(o.assignedGuards) ? o.assignedGuards.length : 0) === 0).length;
                                const fullyAssigned = visibleOrders.filter(o => {
                                    const req = (o.totalManpower ?? 0) || (o.maleGuardsRequired || 0) + (o.femaleGuardsRequired || 0);
                                    const asgn = Array.isArray(o.assignedGuards) ? o.assignedGuards.length : 0;
                                    return req > 0 && asgn >= req;
                                }).length;

                                return (
                                <div key={siteId} className="rounded-lg border overflow-hidden">
                                    {/* ── Site header (always visible) ── */}
                                    <div
                                        className="flex items-start gap-3 p-4 cursor-pointer select-none hover:bg-muted/40 transition-colors"
                                        onClick={() => toggleSite(siteId)}
                                    >
                                        {/* Collapse chevron */}
                                        <button
                                            className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                                            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                                            onClick={(e) => { e.stopPropagation(); toggleSite(siteId); }}
                                        >
                                            {isCollapsed
                                                ? <ChevronDown className="h-4 w-4" />
                                                : <ChevronUp className="h-4 w-4" />
                                            }
                                        </button>

                                        {/* Site info */}
                                        <div className="flex-1 min-w-0">
                                            <h3 className="text-base font-semibold leading-tight">{siteInfo.siteName}</h3>
                                            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                                <span>{OPERATIONAL_CLIENT_NAME}</span>
                                                <Badge variant="secondary">{siteInfo.district}</Badge>
                                            </p>
                                            {/* Summary strip (shown when collapsed) */}
                                            {isCollapsed && (
                                                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                                    <span className="font-medium text-foreground">{totalDates} date{totalDates !== 1 ? 's' : ''}</span>
                                                    <span>·</span>
                                                    <span>{totalGuards} guards total</span>
                                                    {unassigned > 0 && (
                                                        <span className="font-semibold text-red-500">{unassigned} unassigned</span>
                                                    )}
                                                    {unassigned === 0 && fullyAssigned === totalDates && totalDates > 0 && (
                                                        <span className="font-semibold text-green-600">All assigned</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* Action buttons — stop propagation so clicks don't toggle collapse */}
                                        <div
                                            className="flex shrink-0 flex-col gap-2 sm:flex-row"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {userRole === 'admin' && (
                                                <Button size="sm" variant="outline" asChild className="h-8 text-xs">
                                                    <Link href={siteHref(siteId)}>
                                                        <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                                                        Edit
                                                    </Link>
                                                </Button>
                                            )}
                                            <Button size="sm" variant="outline" asChild className="h-8 text-xs">
                                                <Link href={siteHref(siteId)}>
                                                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                                                    Assign
                                                </Link>
                                            </Button>
                                        </div>
                                    </div>

                                    {/* ── Collapsible date cards ── */}
                                    {!isCollapsed && (
                                        <div className="border-t px-4 pb-4 pt-3">
                                            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                                                Required Manpower · {totalDates} date{totalDates !== 1 ? 's' : ''}
                                            </h4>
                                            <div className="grid gap-2 sm:flex sm:flex-wrap">
                                                {visibleOrders.map(order => {
                                                    const totalRequired = (order.totalManpower ?? 0) || ((order.maleGuardsRequired || 0) + (order.femaleGuardsRequired || 0));
                                                    const assignedCount = Array.isArray(order.assignedGuards) ? order.assignedGuards.length : 0;
                                                    const percent = totalRequired > 0 ? Math.min(100, Math.round((assignedCount / totalRequired) * 100)) : 0;
                                                    const status = assignedCount === 0 ? 'Unassigned' : (assignedCount >= totalRequired ? 'Fully Assigned' : 'Partial');
                                                    const statusClasses = assignedCount === 0
                                                        ? 'bg-red-100 text-red-700 border-red-200'
                                                        : (assignedCount >= totalRequired ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-800 border-amber-200');
                                                    return (
                                                        <div key={order.id} className={`relative w-full rounded-md border p-3 sm:min-w-[180px] sm:w-auto ${assignedCount === 0 ? 'bg-red-50/40' : (assignedCount >= totalRequired ? 'bg-green-50/40' : 'bg-amber-50/40')}`}>
                                                            <div className="flex items-center justify-between gap-1 mb-2">
                                                                <p className="text-xs font-semibold">{order.date.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                                                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusClasses}`}>{status}</span>
                                                            </div>
                                                            <div className="grid grid-cols-3 items-center gap-2 border-t pt-2">
                                                                <div className="text-center">
                                                                    <p className="text-lg font-bold leading-none">{order.maleGuardsRequired}</p>
                                                                    <p className="text-[10px] text-muted-foreground mt-0.5">Male</p>
                                                                </div>
                                                                <div className="text-center">
                                                                    <p className="text-lg font-bold leading-none">{order.femaleGuardsRequired}</p>
                                                                    <p className="text-[10px] text-muted-foreground mt-0.5">Female</p>
                                                                </div>
                                                                <div className="text-center">
                                                                    <p className="text-lg font-bold leading-none">{totalRequired}</p>
                                                                    <p className="text-[10px] text-muted-foreground mt-0.5">Total</p>
                                                                </div>
                                                            </div>
                                                            <div className="mt-2 space-y-1">
                                                                <Progress value={percent} className="h-1.5" />
                                                                <p className="text-[10px] text-muted-foreground">
                                                                    Assigned {assignedCount}/{totalRequired} ({percent}%)
                                                                </p>
                                                            </div>
                                                            {userRole === 'admin' && (
                                                                <button
                                                                    className="absolute top-1 right-1 rounded p-1 text-destructive/60 hover:text-destructive hover:bg-red-50 transition-colors"
                                                                    title="Delete duty (5s undo)"
                                                                    onClick={() => handleDeleteOrder(order)}
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )})}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
