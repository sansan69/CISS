
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UploadCloud, Loader2, FileCheck2, UserPlus, Edit3, Trash2, ChevronDown, ChevronUp, ChevronsUpDown, Download, FileSpreadsheet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { authorizedFetch } from '@/lib/api-client';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, getDocs, Timestamp } from 'firebase/firestore';
import { startOfToday, format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import Link from 'next/link';
import { useAppAuth } from '@/context/auth-context';
import { OPERATIONAL_CLIENT_NAME } from '@/lib/constants';
import { isWorkOrderAdminRole } from '@/lib/work-orders';
import { buildTcsExamContentHashBrowser } from '@/lib/work-orders/tcs-exam-hash-browser';
import { PageHeader } from '@/components/layout/page-header';
import { AssignedGuardsExportPanel } from '@/components/work-orders/assigned-guards-export-panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import type {
    TcsExamImportPreviewPayload,
    WorkOrder,
    WorkOrderImportMode,
} from '@/types/work-orders';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

type WorkspaceTab = 'assignments' | 'assigned-guards-export';

const ADMIN_TABS: { value: WorkspaceTab; label: string; icon: React.ElementType }[] = [
    { value: 'assignments', label: 'Assignments', icon: FileSpreadsheet },
    { value: 'assigned-guards-export', label: 'Assigned Guards Export', icon: Download },
];

const FIELD_OFFICER_TABS: { value: WorkspaceTab; label: string; icon: React.ElementType }[] = [
    { value: 'assignments', label: 'Assignments', icon: FileSpreadsheet },
];

const WORK_ORDER_NAV_META = {
    fieldOfficerLabel: 'Upcoming Duties',
};

function resolveWorkspaceTab(rawTab: string | null, userRole: string | null): WorkspaceTab {
    if (!isWorkOrderAdminRole(userRole)) {
        return 'assignments';
    }
    if (rawTab === 'assigned-guards-export') return 'assigned-guards-export';
    return 'assignments';
}

const isSameDay = (a: Date, b: Date) => {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
};

type ResolvedImportPreview = TcsExamImportPreviewPayload & {
    matchedSites: number;
    pendingSiteCreations: number;
};

const normalizeSegment = (value: string | null | undefined) =>
    String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const buildFallbackSiteKey = (siteName: string, district: string) =>
    `${normalizeSegment(siteName)}|${normalizeSegment(district)}`;

export default function WorkOrderPage() {
    const [file, setFile] = useState<File | null>(null);
    const [importMode, setImportMode] = useState<WorkOrderImportMode>('new');
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [isConfirmingImport, setIsConfirmingImport] = useState(false);
    const [importPreview, setImportPreview] = useState<ResolvedImportPreview | null>(null);
    const [customExamName, setCustomExamName] = useState('');
    const { toast } = useToast();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    
    const [workOrdersBySite, setWorkOrdersBySite] = useState<{[key: string]: WorkOrder[]}>({});
    const [siteDistricts, setSiteDistricts] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(true);
    const { userRole, assignedDistricts } = useAppAuth();
    const canAdminWorkOrders = isWorkOrderAdminRole(userRole);
    const activeTab = useMemo(
        () => resolveWorkspaceTab(searchParams.get('tab'), userRole),
        [searchParams, userRole],
    );
    const visibleTabs = canAdminWorkOrders ? ADMIN_TABS : FIELD_OFFICER_TABS;

    // ── Soft-delete with undo ────────────────────────────────────────────────
    // Orders hidden optimistically while the undo window is open
    const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
    // Map of orderId → saved data snapshot (for undo restore)
    const pendingDeleteData = React.useRef<Map<string, WorkOrder>>(new Map());
    // Map of orderId → timer handle
    const pendingDeleteTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const UNDO_MS = 5_000;

    // ── Bulk delete by exam ────────────────────────────────────────────────
    const [bulkDeleteExam, setBulkDeleteExam] = useState<string | null>(null);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);

    // ── Expand / collapse per site ───────────────────────────────────────────
    // Tracks which siteIds are *expanded*; empty set = all collapsed by default.
    const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());

    const toggleSite = React.useCallback((siteId: string) => {
        setExpandedSites(prev => {
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
                const res = await authorizedFetch(`/api/admin/work-orders/${id}`, { method: 'DELETE' });
                if (!res.ok) throw new Error('Delete failed');
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

    const handleBulkDelete = async () => {
        if (!bulkDeleteExam) return;
        setIsBulkDeleting(true);
        try {
            const res = await authorizedFetch('/api/admin/work-orders/bulk-delete', {
                method: 'POST',
                body: JSON.stringify({ examName: bulkDeleteExam }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Bulk delete failed');
            toast({ title: 'Exam deleted', description: data.message });
            setBulkDeleteExam(null);
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message || 'Could not delete exam work orders.' });
        } finally {
            setIsBulkDeleting(false);
        }
    };

    const selectedDistrict = searchParams.get('district') || 'all';
    const selectedExam = searchParams.get('exam') || 'all';
    const dateSort = searchParams.get('dateSort') === 'desc' ? 'desc' : 'asc';
    const selectedDateValue = searchParams.get('date') || '';
    const selectedDate = useMemo(() => {
        if (!selectedDateValue) return null;
        const parsed = new Date(`${selectedDateValue}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }, [selectedDateValue]);

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

    const handleTabChange = (nextTab: string) => {
        updateUrlParams({ tab: nextTab === 'assignments' ? null : nextTab });
    };


    useEffect(() => {
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
                    if ((o.recordStatus ?? 'active').trim().toLowerCase() !== 'active') {
                        return false;
                    }
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

    // Fetch site districts so UI always shows the current site district
    useEffect(() => {
        const siteIds = Object.keys(workOrdersBySite);
        if (siteIds.length === 0) {
            setSiteDistricts({});
            return;
        }

        const fetchSites = async () => {
            const mapping: Record<string, string> = {};
            // Firestore 'in' queries support up to 30 values
            const chunkSize = 30;
            for (let i = 0; i < siteIds.length; i += chunkSize) {
                const chunk = siteIds.slice(i, i + chunkSize);
                const q = query(collection(db, "sites"), where("__name__", "in", chunk));
                const snap = await getDocs(q);
                snap.docs.forEach((doc) => {
                    const data = doc.data();
                    mapping[doc.id] = data.district || data.districtName || "";
                });
            }
            setSiteDistricts(mapping);
        };

        fetchSites().catch((err) => {
            console.error("Error fetching site districts:", err);
        });
    }, [workOrdersBySite]);

    // Distinct districts present in current sites (uses live site district mapping)
    const availableDistricts = useMemo(() => {
        const set = new Set<string>();
        Object.entries(workOrdersBySite).forEach(([siteId, orders]) => {
            const district = siteDistricts[siteId] || orders[0]?.district || "";
            if (district) set.add(district);
        });
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [workOrdersBySite, siteDistricts]);

    // Distinct exam names present in current work orders
    const availableExams = useMemo(() => {
        const set = new Set<string>();
        Object.values(workOrdersBySite).forEach(orders => {
            orders.forEach(order => {
                const en = order.examName || order.examCode || "";
                if (en) set.add(en);
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
                const siteDistrict = (siteDistricts[siteId] || orders[0]?.district || '').toLowerCase();
                if (siteDistrict !== districtLower) continue;
            }

            if (selectedExam !== 'all') {
                const hasExam = orders.some(o => (o.examName || o.examCode || '') === selectedExam);
                if (!hasExam) continue;
                filtered = orders.filter(o => (o.examName || o.examCode || '') === selectedExam);
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
    const allExpanded = filteredEntries.length > 0 && filteredEntries.every(([id]) => expandedSites.has(id));
    const toggleAll = React.useCallback(() => {
        if (allExpanded) {
            setExpandedSites(new Set());
        } else {
            setExpandedSites(new Set(filteredEntries.map(([id]) => id)));
        }
    }, [allExpanded, filteredEntries]);

    const clearImportPreview = React.useCallback(() => {
        setImportPreview(null);
        setCustomExamName('');
    }, []);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            const selectedFile = event.target.files[0];
            const validTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/vnd.ms-excel'];
            if (validTypes.some(type => selectedFile.type.includes(type))) {
                setFile(selectedFile);
                setImportPreview(null);
            } else {
                toast({
                    variant: 'destructive',
                    title: 'Invalid File Type',
                    description: 'Please upload a CSV or XLSX file.',
                });
            }
        }
    };

    const resolveExistingSitesForRows = React.useCallback(async (
        rows: TcsExamImportPreviewPayload['rows'],
    ) => {
        const sitesSnapshot = await getDocs(collection(db, 'sites'));
        const sitesByCode = new Map<string, { id: string; siteId?: string | null; siteName: string; district: string }>();
        const sitesByNameDistrict = new Map<string, { id: string; siteId?: string | null; siteName: string; district: string }>();

        for (const siteDoc of sitesSnapshot.docs) {
            const site = { id: siteDoc.id, ...(siteDoc.data() as any) };
            const codeKey = normalizeSegment(site.siteId);
            if (codeKey && !sitesByCode.has(codeKey)) {
                sitesByCode.set(codeKey, site);
            }
            const fallbackKey = buildFallbackSiteKey(site.siteName, site.district);
            if (!sitesByNameDistrict.has(fallbackKey)) {
                sitesByNameDistrict.set(fallbackKey, site);
            }
        }
        let matchedSites = 0;
        let pendingSiteCreations = 0;

        for (const row of rows) {
            const fileSiteCode = normalizeSegment(row.siteId);
            const fallbackKey = buildFallbackSiteKey(row.siteName, row.district);
            const site = (fileSiteCode && sitesByCode.get(fileSiteCode)) || sitesByNameDistrict.get(fallbackKey);
            if (site) {
                matchedSites += 1;
            } else {
                pendingSiteCreations += 1;
            }
        }

        return { matchedSites, pendingSiteCreations };
    }, []);

    const handlePreviewImport = async () => {
        if (!file) {
            toast({ variant: 'destructive', title: 'No File Selected' });
            return;
        }
        setIsPreviewing(true);
        toast({ title: 'Previewing Import...', description: 'Parsing the workbook and matching duty rows.' });

        try {
            const formData = new FormData();
            formData.set('file', file);
            formData.set('mode', importMode);

            const response = await authorizedFetch('/api/admin/work-orders/import/preview', {
                method: 'POST',
                body: formData,
            });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload?.error || 'Could not preview the import.');
            }

            const previewPayload = payload as TcsExamImportPreviewPayload;
            const resolution = await resolveExistingSitesForRows(previewPayload.rows);

            setImportPreview({
                ...previewPayload,
                matchedSites: resolution.matchedSites,
                pendingSiteCreations: resolution.pendingSiteCreations,
            });

            toast({
                title: 'Preview Ready',
                description: `Reviewed ${previewPayload.rowCount} rows across ${previewPayload.siteCount} sites.`,
            });
        } catch (error: any) {
            console.error('Error previewing import:', error);
            toast({
                variant: 'destructive',
                title: 'Preview Failed',
                description: error.message || 'Could not preview the import.',
                duration: 8000,
            });
        } finally {
            setIsPreviewing(false);
        }
    };

    const handleConfirmImport = async () => {
        if (!file || !importPreview) {
            toast({ variant: 'destructive', title: 'Preview Required', description: 'Preview the file before confirming the import.' });
            return;
        }

        const resolvedExamName = customExamName.trim() || importPreview.suggestedExamName;
        const resolvedExamCode = resolvedExamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const rowsWithExam = importPreview.rows.map((row) => ({
            ...row,
            examName: resolvedExamName,
            examCode: resolvedExamCode,
        }));

        const resolvedContentHash = await buildTcsExamContentHashBrowser(
            resolvedExamCode,
            rowsWithExam.map((row) => ({
                siteId: row.siteId,
                siteName: row.siteName,
                district: row.district,
                date: row.date,
                examCode: row.examCode ?? resolvedExamCode,
                maleGuardsRequired: row.maleGuardsRequired,
                femaleGuardsRequired: row.femaleGuardsRequired,
            })),
        );

        setIsConfirmingImport(true);
        try {
            const response = await authorizedFetch('/api/admin/work-orders/import/commit', {
                method: 'POST',
                body: JSON.stringify({
                    mode: importPreview.mode,
                    fileName: file.name,
                    parserMode: importPreview.parserMode,
                    examName: resolvedExamName,
                    examCode: resolvedExamCode,
                    binaryFileHash: importPreview.binaryFileHash,
                    contentHash: resolvedContentHash,
                    rows: rowsWithExam,
                    warnings: importPreview.warnings,
                }),
            });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload?.error || 'Could not confirm the import.');
            }

            toast({
                title: 'Import Confirmed',
                description: `Committed ${payload.committedRows ?? importPreview.rowCount} rows${payload.createdSites > 0 ? ` and created ${payload.createdSites} site${payload.createdSites === 1 ? '' : 's'}` : ''}.`,
            });
            setFile(null);
            setImportPreview(null);
        } catch (error: any) {
            console.error('Error confirming import:', error);
            toast({
                variant: 'destructive',
                title: 'Import Failed',
                description: error.message || 'Could not confirm the import.',
                duration: 8000,
            });
        } finally {
            setIsConfirmingImport(false);
        }
    };
    
    const pageTitle = userRole === 'fieldOfficer'
        ? `${WORK_ORDER_NAV_META.fieldOfficerLabel} Schedules`
        : "Work Order Management";
    const listQueryString = searchParams.toString();
    const siteHref = (siteId: string) => (listQueryString ? `/work-orders/${siteId}?${listQueryString}` : `/work-orders/${siteId}`);

    return (
        <div className="flex flex-col gap-4 sm:gap-6">
            <PageHeader
                eyebrow="Workforce"
                title={pageTitle}
                description={
                    canAdminWorkOrders
                        ? 'Upload and manage exam duty requirements across active duty sites.'
                        : 'Review the exam duty requirements that are relevant to your assigned districts.'
                }
                breadcrumbs={[
                    { label: "Dashboard", href: "/dashboard" },
                    { label: pageTitle },
                ]}
            />

            <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col gap-4">
                <TabsList className={`grid h-auto w-full gap-2 ${visibleTabs.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {visibleTabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                            <TabsTrigger key={tab.value} value={tab.value} className="py-2">
                                <Icon className="mr-2 h-4 w-4" />
                                {tab.label}
                            </TabsTrigger>
                        );
                    })}
                </TabsList>

                <TabsContent value="assignments" className="mt-0 flex flex-col gap-4 sm:gap-6">
                    {canAdminWorkOrders && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Upload Work Order</CardTitle>
                                <CardDescription>Upload the exam duty requirement workbook, preview the active-row changes, then confirm the import.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                                    <div className="grid w-full items-center gap-1.5">
                                        <Label htmlFor="work-order-file">Work Order File (Excel/CSV)</Label>
                                        <Input id="work-order-file" type="file" accept=".csv, .xlsx, .xls" onChange={handleFileChange} />
                                    </div>
                                    <div className="grid w-full items-center gap-1.5">
                                        <Label htmlFor="work-order-mode">Import Mode</Label>
                                        <Select
                                            value={importMode}
                                            onValueChange={(value) => {
                                                setImportMode(value as WorkOrderImportMode);
                                                clearImportPreview();
                                            }}
                                        >
                                            <SelectTrigger id="work-order-mode">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="new">New Import</SelectItem>
                                                <SelectItem value="revision">Revision Import</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                {file && (
                                    <div className="flex items-center gap-2 rounded-md border bg-muted p-2 text-sm">
                                        <FileCheck2 className="h-5 w-5 text-green-500" />
                                        <span>{file.name}</span>
                                    </div>
                                )}
                                {importPreview && (
                                    <div className="space-y-4 rounded-lg border p-4">
                                        <div className="space-y-3">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Badge variant="secondary">{importPreview.mode === 'revision' ? 'Revision' : 'New'}</Badge>
                                                <Badge variant="outline">
                                                    {importPreview.dateRange.from} to {importPreview.dateRange.to}
                                                </Badge>
                                                {importPreview.pendingSiteCreations > 0 && (
                                                    <Badge>{importPreview.pendingSiteCreations} site{importPreview.pendingSiteCreations === 1 ? '' : 's'} to create on confirm</Badge>
                                                )}
                                            </div>
                                            <div className="grid w-full items-center gap-1.5">
                                                <Label htmlFor="exam-name-override" className="text-xs text-muted-foreground">Exam Name (editable)</Label>
                                                <Input
                                                    id="exam-name-override"
                                                    value={customExamName || importPreview.suggestedExamName}
                                                    onChange={(e) => setCustomExamName(e.target.value)}
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-4">
                                            <div className="rounded-md bg-muted px-3 py-2">
                                                <p className="text-xs text-muted-foreground">Rows</p>
                                                <p className="text-lg font-semibold">{importPreview.rowCount}</p>
                                            </div>
                                            <div className="rounded-md bg-muted px-3 py-2">
                                                <p className="text-xs text-muted-foreground">Sites</p>
                                                <p className="text-lg font-semibold">{importPreview.siteCount}</p>
                                            </div>
                                            <div className="rounded-md bg-muted px-3 py-2">
                                                <p className="text-xs text-muted-foreground">Added</p>
                                                <p className="text-lg font-semibold">
                                                    {importPreview.diffRows.filter((row) => row.status === 'added').length}
                                                </p>
                                            </div>
                                            <div className="rounded-md bg-muted px-3 py-2">
                                                <p className="text-xs text-muted-foreground">Updated/Cancelled</p>
                                                <p className="text-lg font-semibold">
                                                    {importPreview.diffRows.filter((row) => row.status === 'updated' || row.status === 'cancelled').length}
                                                </p>
                                            </div>
                                        </div>
                                        {importPreview.duplicateMessage && (
                                            <div className={`rounded-md border px-3 py-2 text-sm ${importPreview.duplicateState === 'overlap' && importMode === 'revision' ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                                                <p className="font-medium">{importPreview.duplicateMessage}</p>
                                                {importPreview.duplicateState === 'overlap' && importMode === 'revision' && (
                                                    <p className="mt-1 text-xs">This is expected for revision imports. Existing work orders will be updated and missing ones will be cancelled.</p>
                                                )}
                                                {importPreview.duplicateState === 'overlap' && importMode === 'new' && (
                                                    <p className="mt-1 text-xs">Switch to <strong>Revision Import</strong> mode if you want to update existing work orders instead.</p>
                                                )}
                                            </div>
                                        )}
                                        {importPreview.warnings.length > 0 && (
                                            <div className="space-y-2">
                                                <p className="text-sm font-medium">Warnings</p>
                                                <div className="space-y-1">
                                                    {importPreview.warnings.map((warning) => (
                                                        <p key={`${warning.code}-${warning.rowNumber ?? 'na'}-${warning.sheetName ?? 'sheet'}`} className="text-xs text-muted-foreground">
                                                            {warning.message}
                                                        </p>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Preview Details Table */}
                                        <div className="space-y-2">
                                            <p className="text-sm font-medium">Preview Details</p>
                                            <ScrollArea className="h-[300px] rounded-md border">
                                                <Table>
                                                    <TableHeader className="sticky top-0 bg-background">
                                                        <TableRow>
                                                            <TableHead className="w-[100px] text-[10px]">Date</TableHead>
                                                            <TableHead className="text-[10px]">Site</TableHead>
                                                            <TableHead className="w-[80px] text-[10px]">District</TableHead>
                                                            <TableHead className="w-[60px] text-right text-[10px]">Male</TableHead>
                                                            <TableHead className="w-[60px] text-right text-[10px]">Female</TableHead>
                                                            <TableHead className="w-[80px] text-[10px]">Status</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {importPreview.diffRows
                                                            .sort((a, b) => a.date.localeCompare(b.date) || a.siteName.localeCompare(b.siteName))
                                                            .map((row, idx) => {
                                                                const statusColors: Record<string, string> = {
                                                                    added: 'text-green-600 bg-green-50',
                                                                    updated: 'text-amber-600 bg-amber-50',
                                                                    unchanged: 'text-muted-foreground',
                                                                    cancelled: 'text-red-600 bg-red-50',
                                                                };
                                                                const maleDisplay = row.status === 'updated' && row.previousMaleGuardsRequired !== undefined
                                                                    ? `${row.previousMaleGuardsRequired} → ${row.maleGuardsRequired}`
                                                                    : String(row.maleGuardsRequired);
                                                                const femaleDisplay = row.status === 'updated' && row.previousFemaleGuardsRequired !== undefined
                                                                    ? `${row.previousFemaleGuardsRequired} → ${row.femaleGuardsRequired}`
                                                                    : String(row.femaleGuardsRequired);
                                                                return (
                                                                    <TableRow key={idx} className={row.status === 'cancelled' ? 'opacity-60' : ''}>
                                                                        <TableCell className="text-xs font-medium">{row.date}</TableCell>
                                                                        <TableCell className="text-xs">{row.siteName}</TableCell>
                                                                        <TableCell className="text-xs">{row.district}</TableCell>
                                                                        <TableCell className="text-xs text-right font-mono">{maleDisplay}</TableCell>
                                                                        <TableCell className="text-xs text-right font-mono">{femaleDisplay}</TableCell>
                                                                        <TableCell>
                                                                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${statusColors[row.status] || ''}`}>
                                                                                {row.status}
                                                                            </span>
                                                                        </TableCell>
                                                                    </TableRow>
                                                                );
                                                            })}
                                                    </TableBody>
                                                </Table>
                                            </ScrollArea>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                                <div className="text-xs text-muted-foreground">
                                    {importPreview
                                        ? `${importPreview.matchedSites} existing site match${importPreview.matchedSites === 1 ? '' : 'es'} applied before commit.`
                                        : 'Preview the workbook first to validate site matching and active-row changes.'}
                                </div>
                                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                                    {importPreview && (
                                        <Button variant="outline" onClick={clearImportPreview} className="w-full sm:w-auto">
                                            Clear Preview
                                        </Button>
                                    )}
                                    <Button onClick={handlePreviewImport} disabled={isPreviewing || isConfirmingImport || !file} className="w-full sm:w-auto">
                                        {isPreviewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                                        {isPreviewing ? 'Previewing...' : 'Preview Import'}
                                    </Button>
                                    <Button
                                        onClick={handleConfirmImport}
                                        disabled={isPreviewing || isConfirmingImport || !file || !importPreview || (
                                            importPreview.duplicateState !== 'none' &&
                                            !(importPreview.duplicateState === 'overlap' && importMode === 'revision')
                                        )}
                                        className="w-full sm:w-auto"
                                    >
                                        {isConfirmingImport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
                                        {isConfirmingImport ? 'Confirming...' : 'Confirm Import'}
                                    </Button>
                                </div>
                            </CardFooter>
                        </Card>
                    )}

                    <Card>
                        <CardHeader>
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                                <div>
                                    <CardTitle>Active Duty Sites</CardTitle>
                                    <CardDescription>
                                        {canAdminWorkOrders
                                            ? 'List of all duty sites with upcoming work orders.'
                                            : 'List of duty sites in your assigned districts with upcoming duties.'}
                                    </CardDescription>
                                </div>
                                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                                    <div className="flex min-w-[160px] flex-col gap-1">
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
                                    <div className="flex min-w-[160px] flex-col gap-1">
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
                                    <div className="flex min-w-[180px] flex-col gap-1">
                                        <Label className="text-xs font-medium text-muted-foreground">Filter by exam</Label>
                                        <Select
                                            value={selectedExam}
                                            onValueChange={(val) => updateUrlParams({ exam: val })}
                                        >
                                            <SelectTrigger className="h-9">
                                                <SelectValue placeholder="All exams" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">All exams</SelectItem>
                                                {availableExams.map((e) => (
                                                    <SelectItem key={e} value={e}>
                                                        {e}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {canAdminWorkOrders && selectedExam !== 'all' && (
                                        <div className="flex min-w-[140px] flex-col gap-1">
                                            <Label className="text-xs font-medium text-muted-foreground">Actions</Label>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                className="h-9 text-xs"
                                                onClick={() => setBulkDeleteExam(selectedExam)}
                                            >
                                                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                                Delete Exam
                                            </Button>
                                        </div>
                                    )}
                                    <div className="flex min-w-[160px] flex-col gap-1">
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
                                <div className="flex h-20 items-center justify-center">
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                </div>
                            ) : Object.keys(workOrdersBySite).length === 0 ? (
                                <p className="py-10 text-center text-muted-foreground">No upcoming duties found.</p>
                            ) : filteredEntries.length === 0 ? (
                                <p className="py-10 text-center text-muted-foreground">No duties match the current filters.</p>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex justify-end">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                                            onClick={toggleAll}
                                        >
                                            <ChevronsUpDown className="h-3.5 w-3.5" />
                                            {allExpanded ? 'Collapse all' : 'Expand all'}
                                        </Button>
                                    </div>

                                    {filteredEntries.map(([siteId, orders]) => {
                                        const siteInfo = orders[0];
                                        const isCollapsed = !expandedSites.has(siteId);
                                        const visibleOrders = orders.filter((o) => !pendingDeleteIds.has(o.id));
                                        const totalDates = visibleOrders.length;
                                        const totalGuards = visibleOrders.reduce((sum, order) => sum + ((order.totalManpower ?? 0) || (order.maleGuardsRequired || 0) + (order.femaleGuardsRequired || 0)), 0);
                                        const unassigned = visibleOrders.filter((order) => (Array.isArray(order.assignedGuards) ? order.assignedGuards.length : 0) === 0).length;
                                        const fullyAssigned = visibleOrders.filter((order) => {
                                            const required = (order.totalManpower ?? 0) || (order.maleGuardsRequired || 0) + (order.femaleGuardsRequired || 0);
                                            const assigned = Array.isArray(order.assignedGuards) ? order.assignedGuards.length : 0;
                                            return required > 0 && assigned >= required;
                                        }).length;

                                        return (
                                            <div key={siteId} className="overflow-hidden rounded-lg border">
                                                <div
                                                    className="flex cursor-pointer select-none items-start gap-3 p-4 transition-colors hover:bg-muted/40"
                                                    onClick={() => toggleSite(siteId)}
                                                >
                                                    <button
                                                        className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                                                        aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            toggleSite(siteId);
                                                        }}
                                                    >
                                                        {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                                                    </button>

                                                    <div className="min-w-0 flex-1">
                                                        <h3 className="text-base font-semibold leading-tight">{siteInfo.siteName}</h3>
                                                        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                                                            <span className="font-medium text-foreground">
                                                                {siteInfo.examName || siteInfo.examCode || "TCS Exam"}
                                                            </span>
                                                            {(() => {
                                                                const district = siteDistricts[siteId] || siteInfo.district;
                                                                if (!district || district === 'South 2') return null;
                                                                return (
                                                                    <>
                                                                        <span className="text-muted-foreground">·</span>
                                                                        <span className="text-muted-foreground">{district}</span>
                                                                    </>
                                                                );
                                                            })()}
                                                        </p>
                                                        {isCollapsed && (
                                                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                                                <span className="font-medium text-foreground">{totalDates} date{totalDates !== 1 ? 's' : ''}</span>
                                                                <span>·</span>
                                                                <span>{totalGuards} guards total</span>
                                                                {unassigned > 0 && <span className="font-semibold text-red-500">{unassigned} unassigned</span>}
                                                                {unassigned === 0 && fullyAssigned === totalDates && totalDates > 0 && (
                                                                    <span className="font-semibold text-green-600">All assigned</span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row" onClick={(e) => e.stopPropagation()}>
                                                        {canAdminWorkOrders && (
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

                                                {!isCollapsed && (
                                                    <div className="border-t px-4 pb-4 pt-3">
                                                        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                            Required Manpower · {totalDates} date{totalDates !== 1 ? 's' : ''}
                                                        </h4>
                                                        <div className="grid gap-2 sm:flex sm:flex-wrap">
                                                            {visibleOrders.map((order) => {
                                                                const totalRequired = (order.totalManpower ?? 0) || ((order.maleGuardsRequired || 0) + (order.femaleGuardsRequired || 0));
                                                                const assignedCount = Array.isArray(order.assignedGuards) ? order.assignedGuards.length : 0;
                                                                const percent = totalRequired > 0 ? Math.min(100, Math.round((assignedCount / totalRequired) * 100)) : 0;
                                                                const status = assignedCount === 0 ? 'Unassigned' : assignedCount >= totalRequired ? 'Fully Assigned' : 'Partial';
                                                                const statusClasses = assignedCount === 0
                                                                    ? 'bg-red-100 text-red-700 border-red-200'
                                                                    : assignedCount >= totalRequired
                                                                        ? 'bg-green-100 text-green-700 border-green-200'
                                                                        : 'bg-amber-100 text-amber-800 border-amber-200';

                                                                return (
                                                                    <div
                                                                        key={order.id}
                                                                        className={`relative w-full rounded-md border p-3 sm:min-w-[180px] sm:w-auto ${assignedCount === 0 ? 'bg-red-50/40' : assignedCount >= totalRequired ? 'bg-green-50/40' : 'bg-amber-50/40'}`}
                                                                    >
                                                                        <div className="mb-2 flex items-center justify-between gap-1">
                                                                            <div className="min-w-0">
                                                                                <p className="text-xs font-semibold">{order.date.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                                                                <p className="truncate text-xs font-semibold text-foreground">{order.examName || order.examCode || "General Duty"}</p>
                                                                            </div>
                                                                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusClasses}`}>{status}</span>
                                                                        </div>
                                                                        <div className="grid grid-cols-3 items-center gap-2 border-t pt-2">
                                                                            <div className="text-center">
                                                                                <p className="text-lg font-bold leading-none">{order.maleGuardsRequired}</p>
                                                                                <p className="mt-0.5 text-[10px] text-muted-foreground">Male</p>
                                                                            </div>
                                                                            <div className="text-center">
                                                                                <p className="text-lg font-bold leading-none">{order.femaleGuardsRequired}</p>
                                                                                <p className="mt-0.5 text-[10px] text-muted-foreground">Female</p>
                                                                            </div>
                                                                            <div className="text-center">
                                                                                <p className="text-lg font-bold leading-none">{totalRequired}</p>
                                                                                <p className="mt-0.5 text-[10px] text-muted-foreground">Total</p>
                                                                            </div>
                                                                        </div>
                                                                        <div className="mt-2 space-y-1">
                                                                            <Progress value={percent} className="h-1.5" />
                                                                            <p className="text-[10px] text-muted-foreground">
                                                                                Assigned {assignedCount}/{totalRequired} ({percent}%)
                                                                            </p>
                                                                        </div>
                                                                        {canAdminWorkOrders && (
                                                                            <button
                                                                                className="absolute right-1 top-1 rounded p-1 text-destructive/60 transition-colors hover:bg-red-50 hover:text-destructive"
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
                                        );
                                    })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {canAdminWorkOrders && (
                    <TabsContent value="assigned-guards-export" className="mt-0">
                        <AssignedGuardsExportPanel />
                    </TabsContent>
                )}

            </Tabs>

            {/* ── Bulk Delete Exam Confirmation Dialog ── */}
            <Dialog open={!!bulkDeleteExam} onOpenChange={(open) => !open && setBulkDeleteExam(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Delete All Work Orders for {bulkDeleteExam}?</DialogTitle>
                        <DialogDescription>
                            This will permanently cancel all upcoming work orders for this exam.
                            Any assigned guards will be unassigned.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 mt-1">
                        <Button variant="outline" onClick={() => setBulkDeleteExam(null)} className="w-full sm:w-auto">
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleBulkDelete} disabled={isBulkDeleting} className="w-full sm:w-auto">
                            {isBulkDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete All
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
