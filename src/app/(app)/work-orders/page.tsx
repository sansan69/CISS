
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
import { UploadCloud, Loader2, FileCheck2, UserPlus, Edit3, Trash2, Download, FileSpreadsheet, Search, X, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { authorizedFetch } from '@/lib/api-client';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, getDocs, Timestamp } from 'firebase/firestore';
import { startOfToday, format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { useAppAuth } from '@/context/auth-context';
import { OPERATIONAL_CLIENT_NAME } from '@/lib/constants';
import { isOperationalWorkOrderClientName, isWorkOrderAdminRole } from '@/lib/work-orders';
import { buildTcsExamContentHashBrowser } from '@/lib/work-orders/tcs-exam-hash-browser';
import { districtKey, districtMatches } from '@/lib/districts';
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
    { value: 'assigned-guards-export', label: 'Export', icon: Download },
];

const FIELD_OFFICER_TABS: { value: WorkspaceTab; label: string; icon: React.ElementType }[] = [
    { value: 'assignments', label: 'Assignments', icon: FileSpreadsheet },
];

const CLIENT_TABS: { value: WorkspaceTab; label: string; icon: React.ElementType }[] = [
    { value: 'assignments', label: 'Deployments', icon: FileSpreadsheet },
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
    `${normalizeSegment(siteName)}|district:${districtKey(district) || normalizeSegment(district)}`;

const buildSiteCodeDistrictKey = (siteId: string | null | undefined, district: string) => {
    const codeKey = normalizeSegment(siteId);
    const resolvedDistrictKey = districtKey(district) || normalizeSegment(district);
    return codeKey && resolvedDistrictKey ? `${codeKey}|district:${resolvedDistrictKey}` : '';
};

const getWorkOrderExamLabel = (order: Partial<Pick<WorkOrder, 'examName' | 'examCode'>>) =>
    String(order.examName || order.examCode || '').replace(/\s+/g, ' ').trim();

const getWorkOrderExamKey = (order: Partial<Pick<WorkOrder, 'examName' | 'examCode'>>) =>
    normalizeSegment(order.examCode || order.examName || '');

type WorkOrderBoardRow = {
    orders: WorkOrder[];
    siteId: string;
    siteName: string;
    district: string;
    districtKey: string;
    examKeys: string[];
    examLabels: string[];
    dateMs: number;
    dateKey: string;
    dateLabel: string;
    maleRequired: number;
    femaleRequired: number;
    totalRequired: number;
    assignedCount: number;
    assignedMale: number;
    assignedFemale: number;
    statusLabel: string;
    statusClassName: string;
};

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
    const { userRole, assignedDistricts, clientInfo } = useAppAuth();
    const canAdminWorkOrders = isWorkOrderAdminRole(userRole);
    const isClientView = userRole === 'client';
    const activeTab = useMemo(
        () => resolveWorkspaceTab(searchParams.get('tab'), userRole),
        [searchParams, userRole],
    );
    const visibleTabs = canAdminWorkOrders ? ADMIN_TABS : isClientView ? CLIENT_TABS : FIELD_OFFICER_TABS;

    // ── Soft-delete with undo ────────────────────────────────────────────────
    // Orders hidden optimistically while the undo window is open
    const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
    // Map of orderId → saved data snapshot (for undo restore)
    const pendingDeleteData = React.useRef<Map<string, WorkOrder>>(new Map());
    // Map of orderId → timer handle
    const pendingDeleteTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const UNDO_MS = 5_000;

    // ── Bulk delete by exam ────────────────────────────────────────────────
    const [bulkDeleteExam, setBulkDeleteExam] = useState<{ key: string; label: string } | null>(null);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);
    const [renameExam, setRenameExam] = useState<{ key: string; label: string } | null>(null);
    const [renameExamName, setRenameExamName] = useState('');
    const [isRenamingExam, setIsRenamingExam] = useState(false);
    const [collapsedDateKeys, setCollapsedDateKeys] = useState<Set<string>>(new Set());
    const initializedCollapsedDateKeysRef = React.useRef(false);

    const toggleDateGroup = React.useCallback((dateKey: string) => {
        setCollapsedDateKeys((current) => {
            const next = new Set(current);
            if (next.has(dateKey)) {
                next.delete(dateKey);
            } else {
                next.add(dateKey);
            }
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
                body: JSON.stringify({ examName: bulkDeleteExam.label, examCode: bulkDeleteExam.key }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Bulk delete failed');
            toast({ title: 'Exam deleted completely', description: data.message });
            setBulkDeleteExam(null);
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message || 'Could not delete exam work orders.' });
        } finally {
            setIsBulkDeleting(false);
        }
    };

    const handleOpenRenameExam = (exam: { key: string; label: string }) => {
        setRenameExam(exam);
        setRenameExamName(exam.label);
    };

    const handleRenameExam = async () => {
        if (!renameExam) return;
        const nextName = renameExamName.trim().replace(/\s+/g, ' ');
        if (!nextName) {
            toast({ variant: 'destructive', title: 'Exam name required', description: 'Enter a valid exam duty name.' });
            return;
        }
        setIsRenamingExam(true);
        try {
            const res = await authorizedFetch('/api/admin/work-orders/rename-exam', {
                method: 'POST',
                body: JSON.stringify({
                    examName: renameExam.label,
                    examCode: renameExam.key,
                    newExamName: nextName,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Exam rename failed');
            toast({ title: 'Exam renamed', description: data.message });
            setRenameExam(null);
            setRenameExamName('');
            updateUrlParams({ exam: data.examCode || null });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message || 'Could not rename exam.' });
        } finally {
            setIsRenamingExam(false);
        }
    };

    const selectedDistrict = searchParams.get('district') || 'all';
    const selectedExamParam = searchParams.get('exam') || 'all';
    const searchText = searchParams.get('q') || '';
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

    // Clean up old sort params from earlier work-order screens.
    useEffect(() => {
        if (searchParams.has('dateSort') || searchParams.has('sort')) {
            const params = new URLSearchParams(searchParams.toString());
            params.delete('dateSort');
            params.delete('sort');
            router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
        }
    }, [searchParams, router, pathname]);


    useEffect(() => {
        setIsLoading(true);
        // Fetch upcoming work orders starting from today's midnight to include today's duties.
        // Field officers can read work orders, then we normalize district matching
        // client-side so minor casing/spacing differences do not hide centers.
        let q = query(collection(db, "workOrders"), where("date", ">=", Timestamp.fromDate(startOfToday())));

        if (userRole === 'fieldOfficer' && assignedDistricts.length === 0) {
            // Field officer has no assigned districts, so they see nothing.
            setIsLoading(false);
            setWorkOrdersBySite({});
            return;
        }

        if (isClientView && !clientInfo?.clientName) {
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
                    if (isClientView && clientInfo?.clientName && o.clientName !== clientInfo.clientName) {
                        return false;
                    }
                    if (!isOperationalWorkOrderClientName(o.clientName)) {
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

    }, [userRole, assignedDistricts, toast, isClientView, clientInfo?.clientName]);

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

    const selectedDistrictKey = selectedDistrict === 'all' ? 'all' : normalizeSegment(selectedDistrict);
    const selectedExamKey = selectedExamParam === 'all' ? 'all' : normalizeSegment(selectedExamParam);

    const allWorkOrderRows = useMemo<WorkOrderBoardRow[]>(() => {
        return Object.entries(workOrdersBySite)
            .flatMap(([siteId, orders]) => {
                return orders
                    .filter((order) => !pendingDeleteIds.has(order.id))
                    .map((order) => {
                        const district = siteDistricts[siteId] || order.district || '';
                        if (
                            userRole === 'fieldOfficer' &&
                            assignedDistricts.length > 0 &&
                            !assignedDistricts.some((assigned) => districtMatches(assigned, district))
                        ) {
                            return null;
                        }
                        const date = (() => {
                            try {
                                return order.date.toDate() as Date;
                            } catch {
                                return null;
                            }
                        })();
                        const dateMs = date?.getTime() ?? 0;
                        const assignedGuards = Array.isArray(order.assignedGuards) ? order.assignedGuards : [];
                        const totalRequired = (order.totalManpower ?? 0) || ((order.maleGuardsRequired || 0) + (order.femaleGuardsRequired || 0));
                        const assignedMale = assignedGuards.filter((guard: any) => guard.gender === 'Male').length;
                        const assignedFemale = assignedGuards.filter((guard: any) => guard.gender === 'Female').length;
                        const assignedCount = assignedGuards.length;
                        const statusLabel = assignedCount === 0
                            ? 'Open'
                            : assignedCount >= totalRequired
                                ? 'Filled'
                                : 'Partial';
                        const statusClassName = assignedCount === 0
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : assignedCount >= totalRequired
                                ? 'border-green-200 bg-green-50 text-green-700'
                                : 'border-amber-200 bg-amber-50 text-amber-800';

                        return {
                            orders: [order],
                            siteId,
                            siteName: order.siteName || siteId,
                            district,
                            districtKey: normalizeSegment(district),
                            examKeys: [getWorkOrderExamKey(order)].filter(Boolean),
                            examLabels: [getWorkOrderExamLabel(order) || 'General Duty'],
                            dateMs,
                            dateKey: date ? format(date, 'yyyy-MM-dd') : 'unknown-date',
                            dateLabel: date ? format(date, 'dd MMM yyyy') : 'Date unavailable',
                            maleRequired: order.maleGuardsRequired || 0,
                            femaleRequired: order.femaleGuardsRequired || 0,
                            totalRequired,
                            assignedCount,
                            assignedMale,
                            assignedFemale,
                            statusLabel,
                            statusClassName,
                        };
                    });
            })
            .filter((row): row is WorkOrderBoardRow => row !== null)
            .sort((a, b) => {
                if (a.dateMs !== b.dateMs) return a.dateMs - b.dateMs;
                const districtCompare = a.district.localeCompare(b.district);
                if (districtCompare !== 0) return districtCompare;
                const siteCompare = a.siteName.localeCompare(b.siteName);
                if (siteCompare !== 0) return siteCompare;
                return (a.examLabels[0] || '').localeCompare(b.examLabels[0] || '');
            });
    }, [workOrdersBySite, siteDistricts, pendingDeleteIds]);

    const availableDistricts = useMemo(() => {
        const set = new Set<string>();
        for (const row of allWorkOrderRows) {
            if (row.district) set.add(row.district);
        }

        if (userRole === 'fieldOfficer' && assignedDistricts.length > 0) {
            return Array.from(set)
                .filter((d) => assignedDistricts.some((assigned) => districtMatches(assigned, d)))
                .sort((a, b) => a.localeCompare(b));
        }

        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [allWorkOrderRows, userRole, assignedDistricts]);

    const availableExams = useMemo(() => {
        const map = new Map<string, string>();
        for (const row of allWorkOrderRows) {
            row.examKeys.forEach((examKey, index) => {
                if (!examKey) return;
                const label = row.examLabels[index] || row.examLabels[0] || 'General Duty';
                if (!map.has(examKey) || label.length > (map.get(examKey) ?? '').length) {
                    map.set(examKey, label);
                }
            });
        }

        return Array.from(map.entries())
            .map(([key, label]) => ({ key, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [allWorkOrderRows]);

    const selectedExamLabel = useMemo(() => {
        if (selectedExamKey === 'all') return 'All exams';
        return availableExams.find((e) => e.key === selectedExamKey)?.label ?? selectedExamParam;
    }, [availableExams, selectedExamKey, selectedExamParam]);

    const filteredRows = useMemo(() => {
        const queryKey = normalizeSegment(searchText);

        return allWorkOrderRows.filter((row) => {
            if (selectedDistrictKey !== 'all' && row.districtKey !== selectedDistrictKey) return false;
            if (selectedExamKey !== 'all' && !row.examKeys.includes(selectedExamKey)) return false;
            if (selectedDate && !isSameDay(new Date(row.dateMs), selectedDate)) return false;

            if (queryKey) {
                const haystack = normalizeSegment([
                    row.siteName,
                    row.district,
                    row.examLabels.join(' '),
                    row.dateLabel,
                    ...row.orders.map((order) => order.sourceFileName),
                    ...row.orders.map((order) => order.siteId),
                ].filter(Boolean).join(' '));
                if (!haystack.includes(queryKey)) return false;
            }

            return true;
        });
    }, [allWorkOrderRows, searchText, selectedDate, selectedDistrictKey, selectedExamKey]);

    const groupedRowsByDate = useMemo(() => {
        const map = new Map<string, {
            dateLabel: string;
            rows: WorkOrderBoardRow[];
            maleRequired: number;
            femaleRequired: number;
            totalRequired: number;
            assignedCount: number;
            examLabels: Set<string>;
        }>();
        for (const row of filteredRows) {
            const groupedSiteKey = `${row.dateKey}::${row.siteId}`;
            const existing = map.get(row.dateKey) ?? {
                dateLabel: row.dateLabel,
                rows: [],
                maleRequired: 0,
                femaleRequired: 0,
                totalRequired: 0,
                assignedCount: 0,
                examLabels: new Set<string>(),
            };
            const existingSiteIndex = existing.rows.findIndex((entry) => `${entry.dateKey}::${entry.siteId}` === groupedSiteKey);
            if (existingSiteIndex === -1) {
                existing.rows.push(row);
            } else {
                const current = existing.rows[existingSiteIndex];
                const examLabels = Array.from(new Set([...current.examLabels, ...row.examLabels]));
                const examKeys = Array.from(new Set([...current.examKeys, ...row.examKeys]));
                const totalRequired = current.totalRequired + row.totalRequired;
                const assignedCount = current.assignedCount + row.assignedCount;
                const assignedMale = current.assignedMale + row.assignedMale;
                const assignedFemale = current.assignedFemale + row.assignedFemale;
                const statusLabel = assignedCount === 0
                    ? 'Open'
                    : assignedCount >= totalRequired
                        ? 'Filled'
                        : 'Partial';
                const statusClassName = assignedCount === 0
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : assignedCount >= totalRequired
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : 'border-amber-200 bg-amber-50 text-amber-800';

                existing.rows[existingSiteIndex] = {
                    ...current,
                    orders: [...current.orders, ...row.orders],
                    examLabels,
                    examKeys,
                    maleRequired: current.maleRequired + row.maleRequired,
                    femaleRequired: current.femaleRequired + row.femaleRequired,
                    totalRequired,
                    assignedCount,
                    assignedMale,
                    assignedFemale,
                    statusLabel,
                    statusClassName,
                };
            }
            row.examLabels.forEach((label) => existing.examLabels.add(label));
            existing.maleRequired += row.maleRequired;
            existing.femaleRequired += row.femaleRequired;
            existing.totalRequired += row.totalRequired;
            existing.assignedCount += row.assignedCount;
            map.set(row.dateKey, existing);
        }
        return Array.from(map.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([dateKey, group]) => {
                const rows = [...group.rows].sort((a, b) => {
                    const districtCompare = a.district.localeCompare(b.district);
                    if (districtCompare !== 0) return districtCompare;
                    return a.siteName.localeCompare(b.siteName);
                });
                const assignedCenters = rows.filter((row) => row.totalRequired > 0 && row.assignedCount >= row.totalRequired).length;
                const pendingCenters = rows.length - assignedCenters;
                return {
                    dateKey,
                    dateLabel: group.dateLabel,
                    rows,
                    maleRequired: group.maleRequired,
                    femaleRequired: group.femaleRequired,
                    totalRequired: group.totalRequired,
                    assignedCount: group.assignedCount,
                    totalCenters: rows.length,
                    assignedCenters,
                    pendingCenters,
                    examLabels: Array.from(group.examLabels).sort((a, b) => a.localeCompare(b)),
                };
            });
    }, [filteredRows]);

    useEffect(() => {
        if (initializedCollapsedDateKeysRef.current || groupedRowsByDate.length === 0) {
            return;
        }
        setCollapsedDateKeys(new Set(groupedRowsByDate.map((group) => group.dateKey)));
        initializedCollapsedDateKeysRef.current = true;
    }, [groupedRowsByDate]);

    const hasActiveFilters = Boolean(searchText || selectedDate || selectedDistrictKey !== 'all' || selectedExamKey !== 'all');
    const clearFilters = () => updateUrlParams({ q: null, date: null, district: null, exam: null });

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
        const sitesByCodeDistrict = new Map<string, { id: string; siteId?: string | null; siteName: string; district: string }>();
        const sitesByNameDistrict = new Map<string, { id: string; siteId?: string | null; siteName: string; district: string }>();

        for (const siteDoc of sitesSnapshot.docs) {
            const site = { id: siteDoc.id, ...(siteDoc.data() as any) };
            const codeDistrictKey = buildSiteCodeDistrictKey(site.siteId, site.district);
            if (codeDistrictKey && !sitesByCodeDistrict.has(codeDistrictKey)) {
                sitesByCodeDistrict.set(codeDistrictKey, site);
            }
            const fallbackKey = buildFallbackSiteKey(site.siteName, site.district);
            if (!sitesByNameDistrict.has(fallbackKey)) {
                sitesByNameDistrict.set(fallbackKey, site);
            }
        }
        let matchedSites = 0;
        let pendingSiteCreations = 0;

        for (const row of rows) {
            const codeDistrictKey = buildSiteCodeDistrictKey(row.siteId, row.district);
            const fallbackKey = buildFallbackSiteKey(row.siteName, row.district);
            const site = (codeDistrictKey && sitesByCodeDistrict.get(codeDistrictKey)) || sitesByNameDistrict.get(fallbackKey);
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
        : isClientView
            ? "Client Deployment Board"
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
                        ? `${OPERATIONAL_CLIENT_NAME} exam-duty workspace for uploading work orders and assigning guards.`
                        : isClientView
                            ? `Review upcoming ${OPERATIONAL_CLIENT_NAME} exam-duty deployments and assigned coverage for your linked sites.`
                            : `Review the ${OPERATIONAL_CLIENT_NAME} exam-duty requirements that are relevant to your assigned districts.`
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
                                <CardTitle>{OPERATIONAL_CLIENT_NAME} Work Order Upload</CardTitle>
                                <CardDescription>Upload the {OPERATIONAL_CLIENT_NAME} exam-duty workbook, preview the active-row changes, then confirm the import.</CardDescription>
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
                        <CardHeader className="gap-4">
                            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <CardTitle>Duty Board</CardTitle>
                                    <CardDescription>
                                        {canAdminWorkOrders
                                            ? 'Upcoming exam duties grouped by date. Use one filter at a time or combine them safely.'
                                            : 'Upcoming exam duties for your assigned districts, grouped by date.'}
                                    </CardDescription>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <Badge variant="secondary">{filteredRows.length} duties</Badge>
                                    <Badge variant="outline">{allWorkOrderRows.length} active rows</Badge>
                                </div>
                            </div>

                            <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.2fr)_160px_180px_220px_auto]">
                                <div className="flex flex-col gap-1">
                                    <Label className="text-xs font-medium text-muted-foreground">Search</Label>
                                    <div className="relative">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            value={searchText}
                                            onChange={(e) => updateUrlParams({ q: e.target.value || null })}
                                            placeholder="Site, district, exam, file..."
                                            className="h-9 pl-9"
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <Label className="text-xs font-medium text-muted-foreground">Date</Label>
                                    <Input
                                        type="date"
                                        value={selectedDate ? format(selectedDate, 'yyyy-MM-dd') : ''}
                                        onChange={(e) => updateUrlParams({ date: e.target.value || null })}
                                        className="h-9"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <Label className="text-xs font-medium text-muted-foreground">District</Label>
                                    <Select value={selectedDistrict} onValueChange={(val) => updateUrlParams({ district: val })}>
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
                                <div className="flex flex-col gap-1">
                                    <Label className="text-xs font-medium text-muted-foreground">Exam</Label>
                                    <Select value={selectedExamKey} onValueChange={(val) => updateUrlParams({ exam: val })}>
                                        <SelectTrigger className="h-9">
                                            <SelectValue placeholder="All exams" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All exams</SelectItem>
                                            {availableExams.map((exam) => (
                                                <SelectItem key={exam.key} value={exam.key}>
                                                    {exam.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex items-end">
                                    <Button variant="outline" className="h-9 w-full lg:w-auto" onClick={clearFilters} disabled={!hasActiveFilters}>
                                        <X className="mr-1.5 h-4 w-4" />
                                        Clear
                                    </Button>
                                </div>
                            </div>

                            {hasActiveFilters && (
                                <div className="flex flex-wrap items-center gap-2">
                                    {searchText && (
                                        <Badge variant="secondary" className="gap-1.5">
                                            Search: {searchText}
                                            <button aria-label="Remove search filter" onClick={() => updateUrlParams({ q: null })}>
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    )}
                                    {selectedDate && (
                                        <Badge variant="secondary" className="gap-1.5">
                                            Date: {format(selectedDate, 'dd MMM yyyy')}
                                            <button aria-label="Remove date filter" onClick={() => updateUrlParams({ date: null })}>
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    )}
                                    {selectedDistrictKey !== 'all' && (
                                        <Badge variant="secondary" className="gap-1.5">
                                            District: {selectedDistrict}
                                            <button aria-label="Remove district filter" onClick={() => updateUrlParams({ district: null })}>
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    )}
                                    {selectedExamKey !== 'all' && (
                                        <Badge variant="secondary" className="gap-1.5">
                                            Exam: {selectedExamLabel}
                                            <button aria-label="Remove exam filter" onClick={() => updateUrlParams({ exam: null })}>
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    )}
                                    {canAdminWorkOrders && selectedExamKey !== 'all' && (
                                        <>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => handleOpenRenameExam({ key: selectedExamKey, label: selectedExamLabel })}
                                            >
                                                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                                Rename exam
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 border-destructive/30 text-xs text-destructive hover:bg-destructive hover:text-destructive-foreground"
                                                onClick={() => setBulkDeleteExam({ key: selectedExamKey, label: selectedExamLabel })}
                                            >
                                                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                                Delete exam completely
                                            </Button>
                                        </>
                                    )}
                                </div>
                            )}
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="flex h-24 items-center justify-center">
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                </div>
                            ) : allWorkOrderRows.length === 0 ? (
                                <div className="rounded-lg border border-dashed py-10 text-center">
                                    <p className="font-medium">No upcoming duties found.</p>
                                    <p className="mt-1 text-sm text-muted-foreground">Upload a {OPERATIONAL_CLIENT_NAME} work order to start assigning guards.</p>
                                </div>
                            ) : filteredRows.length === 0 ? (
                                <div className="rounded-lg border border-dashed py-10 text-center">
                                    <p className="font-medium">No duties match these filters.</p>
                                    <p className="mt-1 text-sm text-muted-foreground">Remove a filter or clear all filters to return to the full duty board.</p>
                                    <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                                        Clear filters
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-5">
                                    {groupedRowsByDate.map((group) => {
                                        const isCollapsed = collapsedDateKeys.has(group.dateKey);
                                        const ToggleIcon = isCollapsed ? ChevronRight : ChevronDown;
                                        const examSummary = group.examLabels.join(' · ');

                                        return (
                                            <section key={group.dateKey} className="overflow-hidden rounded-xl border bg-card">
                                                <button
                                                    type="button"
                                                    className="flex w-full flex-col gap-2 border-b bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between"
                                                    onClick={() => toggleDateGroup(group.dateKey)}
                                                    aria-expanded={!isCollapsed}
                                                    aria-controls={`work-orders-date-${group.dateKey}`}
                                                >
                                                    <div className="flex min-w-0 items-start gap-3">
                                                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background shadow-sm">
                                                            <ToggleIcon className="h-4 w-4" />
                                                        </span>
                                                        <div className="min-w-0">
                                                            <h3 className="text-base font-semibold">{group.dateLabel}</h3>
                                                            <p className="text-sm text-muted-foreground">
                                                                {group.maleRequired} M · {group.femaleRequired} F · {group.totalRequired} total
                                                            </p>
                                                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                                                {examSummary || 'No exam names available'}
                                                            </p>
                                                            <p className="mt-1 text-xs text-muted-foreground">
                                                                {group.totalCenters} center{group.totalCenters === 1 ? '' : 's'} · {group.assignedCenters} assigned · {group.pendingCenters} non assigned
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Badge variant={group.assignedCount >= group.totalRequired ? 'default' : 'secondary'} className="w-fit">
                                                            {group.assignedCount >= group.totalRequired ? 'Ready' : `${group.totalRequired - group.assignedCount} pending`}
                                                        </Badge>
                                                        <span className="text-xs font-medium text-primary">
                                                            {isCollapsed ? 'View details' : 'Hide details'}
                                                        </span>
                                                    </div>
                                                </button>

                                                {!isCollapsed && (
                                                    <div id={`work-orders-date-${group.dateKey}`} className="divide-y">
                                                        {group.rows.map((row) => {
                                                    const assignmentLabel = `Assigned ${row.assignedCount}/${row.totalRequired}`;
                                                    const examSummary = row.examLabels.join(' · ');
                                                    const isMergedRow = row.orders.length > 1;
                                                    const singleOrder = row.orders[0];
                                                    return (
                                                        <div key={`${row.siteId}-${row.dateKey}-${row.examKeys.join('__') || 'general'}`} className="grid gap-3 p-4 transition-colors hover:bg-muted/30 lg:grid-cols-[minmax(260px,1.4fr)_140px_190px_120px_auto] lg:items-center">
                                                            <div className="min-w-0">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <h4 className="truncate text-sm font-semibold text-foreground">{row.siteName}</h4>
                                                                    <Badge variant="outline" className="text-[10px]">{row.district || 'No district'}</Badge>
                                                                </div>
                                                                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{examSummary}</p>
                                                                {isMergedRow ? (
                                                                    <p className="mt-1 text-[11px] font-medium text-primary">{row.orders.length} exams merged for this center</p>
                                                                ) : null}
                                                            </div>

                                                            <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 px-3 py-2 text-center lg:bg-transparent lg:px-0 lg:py-0">
                                                                <div>
                                                                    <p className="text-sm font-semibold">{row.maleRequired || 0}</p>
                                                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">M</p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-sm font-semibold">{row.femaleRequired || 0}</p>
                                                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">F</p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-sm font-semibold">{row.totalRequired}</p>
                                                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</p>
                                                                </div>
                                                            </div>

                                                            <div className="text-sm">
                                                                <p className="font-medium">{assignmentLabel}</p>
                                                                <p className="text-xs text-muted-foreground">M {row.assignedMale} · F {row.assignedFemale}</p>
                                                            </div>

                                                            <div>
                                                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${row.statusClassName}`}>
                                                                    {row.statusLabel}
                                                                </span>
                                                            </div>

                                                            <div className="flex flex-wrap gap-2 lg:justify-end">
                                                                {canAdminWorkOrders && (
                                                                    <Button size="sm" variant="outline" asChild className="h-8 text-xs">
                                                                        <Link href={siteHref(row.siteId)}>
                                                                            <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                                                                            Open
                                                                        </Link>
                                                                    </Button>
                                                                )}
                                                                <Button size="sm" asChild className="h-8 text-xs">
                                                                    <Link href={siteHref(row.siteId)}>
                                                                        <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                                                                        Assign
                                                                    </Link>
                                                                </Button>
                                                                {canAdminWorkOrders && !isMergedRow && singleOrder && (
                                                                    <Button
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-8 w-8 text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                                                                        title="Delete duty (5s undo)"
                                                                        onClick={() => handleDeleteOrder(singleOrder)}
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                        })}
                                                    </div>
                                                )}
                                            </section>
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
            <Dialog open={!!renameExam} onOpenChange={(open) => {
                if (!open) {
                    setRenameExam(null);
                    setRenameExamName('');
                }
            }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Rename exam duty</DialogTitle>
                        <DialogDescription>
                            This updates the exam name and code for all matching work orders and import-history records.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label htmlFor="rename-exam-name">Exam duty name</Label>
                        <Input
                            id="rename-exam-name"
                            value={renameExamName}
                            onChange={(event) => setRenameExamName(event.target.value)}
                            placeholder="Enter exam duty name"
                        />
                    </div>
                    <DialogFooter className="gap-2 mt-1">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setRenameExam(null);
                                setRenameExamName('');
                            }}
                            className="w-full sm:w-auto"
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleRenameExam} disabled={isRenamingExam || !renameExamName.trim()} className="w-full sm:w-auto">
                            {isRenamingExam && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Rename Exam
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!bulkDeleteExam} onOpenChange={(open) => !open && setBulkDeleteExam(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Delete {bulkDeleteExam?.label} completely?</DialogTitle>
                        <DialogDescription>
                            This permanently removes every work order row and import-history record for this exam.
                            This cannot be undone from the app.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 mt-1">
                        <Button variant="outline" onClick={() => setBulkDeleteExam(null)} className="w-full sm:w-auto">
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleBulkDelete} disabled={isBulkDeleting} className="w-full sm:w-auto">
                            {isBulkDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete Completely
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
