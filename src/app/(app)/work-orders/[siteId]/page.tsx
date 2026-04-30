
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, getDoc, getDocs } from 'firebase/firestore';
import { authorizedFetch } from '@/lib/api-client';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
    Loader2, ArrowLeft, UserPlus, AlertCircle, Search,
    X, Edit3, Trash2, CheckCircle2,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { useHaptics } from '@/hooks/use-haptics';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Employee } from '@/types/employee';
import type { WorkOrder } from '@/types/work-orders';
import { useAppAuth } from '@/context/auth-context';
import { startOfToday } from 'date-fns';
import { isOperationalWorkOrderClientName, isWorkOrderAdminRole } from '@/lib/work-orders';
import { PageHeader } from '@/components/layout/page-header';
import { districtMatches, expandDistrictQueryValues } from '@/lib/districts';

type WorkOrderExamFields = Pick<
    WorkOrder,
    'examName' | 'examCode' | 'recordStatus' | 'importId' | 'sourceFileName'
>;


// Safely compute initials for avatar fallbacks
const getInitials = (name?: string, employeeId?: string) => {
    const safeName = (name || '').trim();
    if (safeName) {
        const parts = safeName.split(/\s+/g).filter(Boolean);
        return parts.map(p => p[0]).slice(0, 2).join('').toUpperCase() || 'NA';
    }
    const id = (employeeId || '').trim();
    return id ? id.slice(-2).toUpperCase() : 'NA';
};

interface Site {
    id: string;
    siteName: string;
    clientName: string;
    district: string;
}


/* ──────────────────────────────────────────────────────────────────────────
   AssignGuardsDialog
   Mobile: full-screen sheet with Available / Assigned tabs, tappable rows
   Desktop: side-by-side panel (unchanged)
────────────────────────────────────────────────────────────────────────── */
const AssignGuardsDialog: React.FC<{
    workOrder: WorkOrder;
    isOpen: boolean;
    onClose: () => void;
    availableGuards: Employee[];
    isLoadingGuards: boolean;
}> = ({ workOrder, isOpen, onClose, availableGuards, isLoadingGuards }) => {
    const { toast } = useToast();
    const { haptic } = useHaptics();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedGuards, setSelectedGuards] = useState(
        Array.isArray(workOrder.assignedGuards) ? workOrder.assignedGuards : []
    );
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setSelectedGuards(Array.isArray(workOrder.assignedGuards) ? workOrder.assignedGuards : []);
        setSearchTerm('');
    }, [workOrder]);

    const filteredGuards = useMemo(() => {
        if (!searchTerm) return availableGuards;
        const lc = searchTerm.toLowerCase();
        return availableGuards.filter(g =>
            (g.fullName || '').toLowerCase().includes(lc) ||
            (g.employeeId || '').toLowerCase().includes(lc)
        );
    }, [searchTerm, availableGuards]);

    const handleToggleGuard = (guard: Employee) => {
        haptic('selection');
        const isSelected = selectedGuards.some(g => g.uid === guard.id);
        if (isSelected) {
            setSelectedGuards(prev => prev.filter(g => g.uid !== guard.id));
        } else {
            setSelectedGuards(prev => [
                ...prev,
                { uid: guard.id, name: guard.fullName, employeeId: guard.employeeId, gender: guard.gender },
            ]);
        }
    };

    const handleSaveAssignments = async () => {
        setIsSaving(true);
        try {
            const res = await authorizedFetch(`/api/admin/work-orders/${workOrder.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    assignedGuards: selectedGuards,
                }),
            });
            if (!res.ok) throw new Error('Failed to save');
            haptic('success');
            toast({ title: "Saved", description: "Guard assignments updated successfully." });
            onClose();
        } catch {
            toast({ variant: "destructive", title: "Error", description: "Could not save assignments." });
        } finally {
            setIsSaving(false);
        }
    };

    const maleCount = selectedGuards.filter(g => g.gender === 'Male').length;
    const femaleCount = selectedGuards.filter(g => g.gender === 'Female').length;
    const getGuardDetails = (uid: string) => availableGuards.find(g => g.id === uid);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="flex h-[min(92dvh,56rem)] w-[calc(100vw-1rem)] max-w-full flex-col gap-0 overflow-hidden p-0 sm:h-[85vh] sm:w-[90vw] md:max-w-4xl lg:max-w-5xl">

                {/* Header */}
                <DialogHeader className="flex-shrink-0 border-b px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
                    <DialogTitle className="pr-8 text-base leading-tight sm:text-xl">
                        Assign Guards — {workOrder.siteName}
                    </DialogTitle>
                    <DialogDescription className="text-sm">
                        {workOrder.date.toDate().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </DialogDescription>
                </DialogHeader>

                {/* Body */}
                <div className="flex-1 overflow-hidden min-h-0 flex flex-col md:flex-row">

                    {/* ── MOBILE: Tab Layout ── */}
                    <div className="md:hidden flex flex-col flex-1 overflow-hidden min-h-0">
                        <Tabs defaultValue="available" className="flex flex-col flex-1 overflow-hidden min-h-0 w-full">
                            <div className="flex-shrink-0 border-b px-4 pt-2">
                                <TabsList className="w-full grid grid-cols-2 h-auto p-1">
                                    <TabsTrigger value="available" className="text-xs py-2.5">
                                        Available ({filteredGuards.length})
                                    </TabsTrigger>
                                    <TabsTrigger value="assigned" className="text-xs py-2.5">
                                        Assigned
                                        <span className={`ml-1.5 h-5 w-5 rounded-full text-[11px] font-bold flex items-center justify-center ${
                                            selectedGuards.length >= workOrder.totalManpower
                                                ? 'bg-green-500 text-white'
                                                : 'bg-primary text-primary-foreground'
                                        }`}>
                                            {selectedGuards.length}
                                        </span>
                                    </TabsTrigger>
                                </TabsList>
                            </div>

                            {/* Available tab */}
                            <TabsContent value="available" className="flex-1 overflow-hidden m-0 p-3 data-[state=active]:flex data-[state=active]:flex-col gap-3">
                                {/* Search */}
                                <div className="relative flex-shrink-0">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search by name or ID…"
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        className="pl-9 h-11 text-base"
                                    />
                                </div>

                                {/* Manpower strip */}
                                <div className="flex-shrink-0 grid grid-cols-3 rounded-lg border divide-x text-center">
                                    <div className="py-2.5">
                                        <p className="text-lg font-bold leading-none">{workOrder.maleGuardsRequired}</p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">Male</p>
                                    </div>
                                    <div className="py-2.5">
                                        <p className="text-lg font-bold leading-none">{workOrder.femaleGuardsRequired}</p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">Female</p>
                                    </div>
                                    <div className="py-2.5">
                                        <p className="text-lg font-bold leading-none">{workOrder.totalManpower}</p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">Total</p>
                                    </div>
                                </div>

                                {/* Guard list */}
                                <ScrollArea className="flex-1 min-h-0">
                                    {isLoadingGuards ? (
                                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                                            <Loader2 className="h-7 w-7 animate-spin text-primary" />
                                            <p className="text-sm text-muted-foreground">Loading guards…</p>
                                        </div>
                                    ) : filteredGuards.length === 0 ? (
                                        <div className="text-center text-muted-foreground py-10">
                                            <p className="text-sm">No guards found.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2 pb-2 pr-1">
                                            {filteredGuards.map(guard => {
                                                const isSelected = selectedGuards.some(g => g.uid === guard.id);
                                                return (
                                                    <button
                                                        key={guard.id}
                                                        type="button"
                                                        onClick={() => handleToggleGuard(guard)}
                                                        className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-all active:scale-[0.98] ${
                                                            isSelected
                                                                ? 'bg-primary/5 border-primary/30'
                                                                : 'bg-card border-border'
                                                        }`}
                                                    >
                                                        <div className="relative flex-shrink-0">
                                                            <Avatar className="h-11 w-11">
                                                                <AvatarImage src={guard.profilePictureUrl} />
                                                                <AvatarFallback className="text-xs">
                                                                    {getInitials(guard.fullName as any, (guard as any).employeeId)}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            {isSelected && (
                                                                <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center ring-2 ring-background">
                                                                    <CheckCircle2 className="h-3.5 w-3.5 text-primary-foreground" />
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-sm">{guard.fullName}</p>
                                                            <p className="text-xs text-muted-foreground">{guard.employeeId}</p>
                                                            <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0">{guard.gender}</Badge>
                                                        </div>
                                                        <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                                                            isSelected ? 'bg-destructive/10' : 'bg-muted'
                                                        }`}>
                                                            {isSelected
                                                                ? <X className="h-4 w-4 text-destructive" />
                                                                : <UserPlus className="h-4 w-4 text-muted-foreground" />
                                                            }
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </ScrollArea>
                            </TabsContent>

                            {/* Assigned tab */}
                            <TabsContent value="assigned" className="flex-1 overflow-hidden m-0 p-3 data-[state=active]:flex data-[state=active]:flex-col gap-3">
                                {/* Status card */}
                                <div className="flex-shrink-0 rounded-xl border p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="font-semibold text-sm">Assignment Status</p>
                                        <Badge variant={selectedGuards.length >= workOrder.totalManpower ? "default" : "secondary"}>
                                            {selectedGuards.length}/{workOrder.totalManpower}
                                        </Badge>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                                            <span className="text-muted-foreground">Male</span>
                                            <span className="font-bold">{maleCount}/{workOrder.maleGuardsRequired}</span>
                                        </div>
                                        <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                                            <span className="text-muted-foreground">Female</span>
                                            <span className="font-bold">{femaleCount}/{workOrder.femaleGuardsRequired}</span>
                                        </div>
                                    </div>
                                    <Progress
                                        value={workOrder.totalManpower > 0 ? Math.min(100, Math.round((selectedGuards.length / workOrder.totalManpower) * 100)) : 0}
                                        className="h-2 mt-2"
                                    />
                                </div>

                                <ScrollArea className="flex-1 min-h-0">
                                    {selectedGuards.length === 0 ? (
                                        <div className="text-center text-muted-foreground py-12">
                                            <UserPlus className="h-12 w-12 mx-auto mb-3 opacity-30" />
                                            <p className="text-sm font-medium">No guards assigned yet</p>
                                            <p className="text-xs mt-1">Go to "Available" tab to assign guards.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2 pb-2 pr-1">
                                            {selectedGuards.map(guard => {
                                                const details = getGuardDetails(guard.uid);
                                                return (
                                                    <div key={guard.uid} className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
                                                        <Avatar className="h-10 w-10 flex-shrink-0">
                                                            <AvatarImage src={details?.profilePictureUrl} />
                                                            <AvatarFallback className="text-xs">{getInitials(guard.name, guard.employeeId)}</AvatarFallback>
                                                        </Avatar>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-sm truncate">{guard.name}</p>
                                                            <p className="text-xs text-muted-foreground">{guard.employeeId}</p>
                                                            <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0">{guard.gender}</Badge>
                                                        </div>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => setSelectedGuards(prev => prev.filter(g => g.uid !== guard.uid))}
                                                            className="h-9 w-9 p-0 flex-shrink-0 hover:bg-destructive/10 hover:text-destructive rounded-full"
                                                        >
                                                            <X className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </ScrollArea>
                            </TabsContent>
                        </Tabs>
                    </div>

                    {/* ── DESKTOP: Side-by-side layout (unchanged) ── */}
                    <div className="hidden md:flex flex-1 overflow-hidden min-h-0 gap-4 px-4 sm:px-6 py-4">
                        {/* Left: Available Guards */}
                        <div className="flex flex-col gap-3 flex-1 min-w-0 overflow-hidden">
                            <div className="relative flex-shrink-0">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search available guards..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                            <ScrollArea className="flex-1 min-h-0 border rounded-md">
                                <div className="p-3 space-y-2">
                                    {isLoadingGuards ? (
                                        <div className="flex items-center justify-center py-10 gap-2">
                                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                            <span className="text-sm text-muted-foreground">Loading guards…</span>
                                        </div>
                                    ) : filteredGuards.length > 0 ? filteredGuards.map(guard => {
                                        const isSelected = selectedGuards.some(g => g.uid === guard.id);
                                        return (
                                            <div
                                                key={guard.id}
                                                className={`flex items-center gap-3 p-2.5 rounded-md transition-colors ${
                                                    isSelected ? 'bg-primary/5 border border-primary/20' : 'hover:bg-muted'
                                                }`}
                                            >
                                                <Avatar className="h-9 w-9 flex-shrink-0">
                                                    <AvatarImage src={guard.profilePictureUrl} />
                                                    <AvatarFallback className="text-xs">
                                                        {getInitials(guard.fullName as any, (guard as any).employeeId)}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-sm truncate">{guard.fullName}</p>
                                                    <p className="text-xs text-muted-foreground truncate">{guard.employeeId}</p>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    variant={isSelected ? "destructive" : "outline"}
                                                    onClick={() => handleToggleGuard(guard)}
                                                    className="flex-shrink-0"
                                                >
                                                    {isSelected ? (
                                                        <><X className="h-4 w-4 mr-1.5" />Unassign</>
                                                    ) : (
                                                        <><CheckCircle2 className="h-4 w-4 mr-1.5" />Assign</>
                                                    )}
                                                </Button>
                                            </div>
                                        );
                                    }) : (
                                        <p className="text-center text-muted-foreground py-6 text-sm">No available guards found.</p>
                                    )}
                                </div>
                            </ScrollArea>
                        </div>

                        {/* Right: Requirements & Assigned */}
                        <div className="flex flex-col gap-3 w-80 lg:w-96 flex-shrink-0 overflow-hidden">
                            <Card className="flex-shrink-0">
                                <CardContent className="p-4 grid grid-cols-3 gap-3 text-center">
                                    <div>
                                        <p className="text-2xl font-bold">{workOrder.maleGuardsRequired}</p>
                                        <p className="text-xs text-muted-foreground">Male</p>
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{workOrder.femaleGuardsRequired}</p>
                                        <p className="text-xs text-muted-foreground">Female</p>
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{workOrder.totalManpower}</p>
                                        <p className="text-xs text-muted-foreground">Total</p>
                                    </div>
                                </CardContent>
                            </Card>

                            <div className="flex-1 flex flex-col gap-2 overflow-hidden min-h-0">
                                <div className="flex items-center justify-between flex-shrink-0">
                                    <h3 className="font-semibold text-sm">Assigned Guards</h3>
                                    <Badge variant={selectedGuards.length >= workOrder.totalManpower ? "default" : "secondary"}>
                                        {selectedGuards.length}/{workOrder.totalManpower}
                                    </Badge>
                                </div>
                                <div className="flex gap-3 text-xs text-muted-foreground flex-shrink-0">
                                    <span>Male: {maleCount}/{workOrder.maleGuardsRequired}</span>
                                    <span>Female: {femaleCount}/{workOrder.femaleGuardsRequired}</span>
                                </div>
                                <ScrollArea className="flex-1 min-h-0 border rounded-md">
                                    <div className="p-3 space-y-2">
                                        {selectedGuards.length > 0 ? selectedGuards.map(guard => {
                                            const details = getGuardDetails(guard.uid);
                                            return (
                                                <div
                                                    key={guard.uid}
                                                    className="flex items-center gap-3 p-2.5 rounded-md bg-primary/5 border border-primary/20"
                                                >
                                                    <Avatar className="h-9 w-9 flex-shrink-0">
                                                        <AvatarImage src={details?.profilePictureUrl} />
                                                        <AvatarFallback className="text-xs">{getInitials(guard.name, guard.employeeId)}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium text-sm truncate">{guard.name}</p>
                                                        <p className="text-xs text-muted-foreground truncate">{guard.employeeId}</p>
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => setSelectedGuards(prev => prev.filter(g => g.uid !== guard.uid))}
                                                        className="flex-shrink-0 h-8 w-8 p-0 hover:bg-destructive hover:text-destructive-foreground"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            );
                                        }) : (
                                            <div className="text-center text-muted-foreground py-8">
                                                <UserPlus className="h-10 w-10 mx-auto mb-2 opacity-50" />
                                                <p className="text-sm">No guards assigned yet.</p>
                                            </div>
                                        )}
                                    </div>
                                </ScrollArea>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <DialogFooter className="flex-shrink-0 border-t bg-background px-4 sm:px-6 py-3 sm:py-4 gap-2">
                    <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
                        Cancel
                    </Button>
                    <Button onClick={handleSaveAssignments} disabled={isSaving} className="w-full sm:w-auto">
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Assignments
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


/* ──────────────────────────────────────────────────────────────────────────
   Main Page
────────────────────────────────────────────────────────────────────────── */
export default function AssignGuardsPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const siteId = params.siteId as string;
    const backHref = searchParams.toString() ? `/work-orders?${searchParams.toString()}` : '/work-orders';

    const [site, setSite] = useState<Site | null>(null);
    const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { userRole, assignedDistricts } = useAppAuth();

    // Assign dialog
    const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
    const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
    const [availableGuards, setAvailableGuards] = useState<Employee[]>([]);
    const [isLoadingGuards, setIsLoadingGuards] = useState(false);

    // Edit counts dialog
    const [editCountsFor, setEditCountsFor] = useState<string | null>(null);
    const [editMale, setEditMale] = useState<number>(0);
    const [editFemale, setEditFemale] = useState<number>(0);
    const [isSavingCounts, setIsSavingCounts] = useState(false);

    // Delete confirmation dialog
    const [deleteConfirmOrder, setDeleteConfirmOrder] = useState<WorkOrder | null>(null);
    const [isDeletingOrder, setIsDeletingOrder] = useState(false);

    const { toast } = useToast();
    const { haptic } = useHaptics();
    const canAdminWorkOrders = isWorkOrderAdminRole(userRole);
    const activeOrders = useMemo(
        () => workOrders.filter((order) => (order.recordStatus ?? 'active').trim().toLowerCase() === 'active'),
        [workOrders],
    );


    useEffect(() => {
        if (!siteId) return;

        let unsubscribe: (() => void) | null = null;

        const fetchSiteAndWorkOrders = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const siteDocRef = doc(db, "sites", siteId);
                const siteDoc = await getDoc(siteDocRef);
                if (!siteDoc.exists()) throw new Error("Site not found.");

                const siteData = { id: siteDoc.id, ...siteDoc.data() } as Site;
                if (!isOperationalWorkOrderClientName((siteData as { clientName?: string }).clientName)) {
                    throw new Error("Work orders are only available for TCS sites.");
                }
                if (
                    userRole === 'fieldOfficer' &&
                    !assignedDistricts.some((district) => districtMatches(district, siteData.district))
                ) {
                    throw new Error("You do not have permission to view this site's work orders.");
                }
                setSite(siteData);

                const q = query(collection(db, "workOrders"), where("siteId", "==", siteId));
                unsubscribe = onSnapshot(q, (snapshot) => {
                    const todayMs = startOfToday().getTime();
                    const orders = snapshot.docs
                        .map(d => ({ id: d.id, ...d.data() } as WorkOrder))
                        .filter((order) => isOperationalWorkOrderClientName(order.clientName))
                        .filter(o => {
                            try { return o.date.toDate().getTime() >= todayMs; } catch { return true; }
                        });
                    orders.sort((a, b) => a.date.toMillis() - b.date.toMillis());
                    setWorkOrders(orders);
                    setIsLoading(false);
                }, () => {
                    setError("Could not load work orders for this site.");
                    setIsLoading(false);
                });
            } catch (err: any) {
                setError(err.message);
                setIsLoading(false);
            }
        };

        fetchSiteAndWorkOrders();

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [siteId, userRole, assignedDistricts]);

    const handleOpenAssignDialog = async (workOrder: WorkOrder) => {
        setSelectedWorkOrder(workOrder);
        setIsAssignDialogOpen(true);
        setIsLoadingGuards(true);
        try {
            const districtScope = site?.district || workOrder.district;
            const districtsToQuery = canAdminWorkOrders
                ? expandDistrictQueryValues([districtScope])
                : expandDistrictQueryValues(assignedDistricts);
            if (districtsToQuery.length === 0) { setAvailableGuards([]); setIsLoadingGuards(false); return; }
            const snap = await getDocs(query(
                collection(db, "employees"),
                where("district", "in", districtsToQuery),
                where("status", "==", "Active")
            ));
            setAvailableGuards(snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
        } catch {
            setError("Could not load guards for assignment.");
        } finally {
            setIsLoadingGuards(false);
        }
    };

    const handleSaveCounts = async () => {
        if (!editCountsFor) return;
        setIsSavingCounts(true);
        try {
            const male = Number.isFinite(editMale) ? editMale : 0;
            const female = Number.isFinite(editFemale) ? editFemale : 0;
            const res = await authorizedFetch(`/api/admin/work-orders/${editCountsFor}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    maleGuardsRequired: male,
                    femaleGuardsRequired: female,
                }),
            });
            if (!res.ok) throw new Error('Failed to save');
            haptic('success');
            toast({ title: "Updated", description: "Manpower requirements saved." });
            setEditCountsFor(null);
        } catch {
            haptic('error');
            toast({ variant: "destructive", title: "Error", description: "Could not save changes." });
        } finally {
            setIsSavingCounts(false);
        }
    };

    const handleConfirmDelete = async () => {
        if (!deleteConfirmOrder) return;
        setIsDeletingOrder(true);
        try {
            const res = await authorizedFetch(`/api/admin/work-orders/${deleteConfirmOrder.id}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete');
            haptic('error');
            toast({ title: "Deleted", description: "Work order removed." });
            setDeleteConfirmOrder(null);
        } catch {
            toast({ variant: "destructive", title: "Error", description: "Could not delete work order." });
        } finally {
            setIsDeletingOrder(false);
        }
    };

    /* ── Loading / Error states ── */
    if (isLoading) {
        return (
            <div className="flex flex-col justify-center items-center h-40 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading schedules…</p>
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
                <Button asChild variant="secondary" className="mt-4">
                    <Link href={backHref}><ArrowLeft className="mr-2 h-4 w-4" />Back to Schedules</Link>
                </Button>
            </Alert>
        );
    }

    /* ── Main render ── */
    return (
        <div className="flex flex-col gap-4 sm:gap-6">
            <PageHeader
                eyebrow="Workforce"
                title={site ? `${site.siteName}` : "Guard Assignment"}
                description={site ? `Assign guards for upcoming duties at ${site.clientName} — ${site.district}.` : "Assign guards and review staffing for the selected duty site."}
                breadcrumbs={[
                    { label: "Dashboard", href: "/dashboard" },
                    { label: "Work Orders", href: backHref },
                    { label: site?.siteName || "Site Detail" },
                ]}
                actions={
                    /* Hidden on mobile — users swipe-back or use bottom nav */
                    <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex">
                        <Link href={backHref}>
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back to All Sites
                        </Link>
                    </Button>
                }
            />

            {activeOrders.length === 0 ? (
                <div className="rounded-xl border border-dashed p-12 text-center">
                    <p className="text-muted-foreground text-sm">No upcoming duties found for this site.</p>
                </div>
            ) : (
                <div className="space-y-3 sm:space-y-4">
                    {activeOrders.map(order => {
                        const totalRequired = (order.totalManpower ?? 0) || ((order.maleGuardsRequired || 0) + (order.femaleGuardsRequired || 0));
                        const assignedCount = Array.isArray(order.assignedGuards) ? order.assignedGuards.length : 0;
                        const percent = totalRequired > 0 ? Math.min(100, Math.round((assignedCount / totalRequired) * 100)) : 0;
                        const isFullyAssigned = assignedCount >= totalRequired && totalRequired > 0;
                        const isPartial = assignedCount > 0 && !isFullyAssigned;
                        const status = assignedCount === 0 ? 'Unassigned' : isFullyAssigned ? 'Fully Assigned' : 'Partial';

                        const borderColor = assignedCount === 0
                            ? 'border-l-red-400'
                            : isFullyAssigned ? 'border-l-green-500' : 'border-l-amber-400';

                        const statusBadge = assignedCount === 0
                            ? 'bg-red-100 text-red-700 border-red-200'
                            : isFullyAssigned
                                ? 'bg-green-100 text-green-700 border-green-200'
                                : 'bg-amber-100 text-amber-800 border-amber-200';

                        const countColor = assignedCount === 0
                            ? 'text-red-600'
                            : isFullyAssigned ? 'text-green-600' : 'text-amber-600';

                        return (
                            <div key={order.id} className={`rounded-xl border-l-4 border bg-card shadow-sm overflow-hidden ${borderColor}`}>
                                {/* Date + Status */}
                                <div className="flex items-start justify-between px-4 pt-4 pb-3">
                                    <div>
                                        <p className="font-bold text-base sm:text-lg leading-tight">
                                            {order.date.toDate().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {order.date.toDate().getFullYear()}
                                        </p>
                                        <p className="mt-1 text-sm font-semibold text-foreground">
                                            {order.examName || order.examCode || "General Duty"}
                                        </p>
                                    </div>
                                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold flex-shrink-0 ml-2 ${statusBadge}`}>
                                        {status}
                                    </span>
                                </div>

                                {/* Stats grid */}
                                <div className="grid grid-cols-4 border-y divide-x">
                                    <div className="text-center py-3 px-1">
                                        <p className="text-xl font-bold leading-none">{order.maleGuardsRequired}</p>
                                        <p className="text-[11px] text-muted-foreground mt-1">Male</p>
                                    </div>
                                    <div className="text-center py-3 px-1">
                                        <p className="text-xl font-bold leading-none">{order.femaleGuardsRequired}</p>
                                        <p className="text-[11px] text-muted-foreground mt-1">Female</p>
                                    </div>
                                    <div className="text-center py-3 px-1">
                                        <p className="text-xl font-bold leading-none">{totalRequired}</p>
                                        <p className="text-[11px] text-muted-foreground mt-1">Required</p>
                                    </div>
                                    <div className="text-center py-3 px-1">
                                        <p className={`text-xl font-bold leading-none ${countColor}`}>{assignedCount}</p>
                                        <p className="text-[11px] text-muted-foreground mt-1">Assigned</p>
                                    </div>
                                </div>

                                {/* Progress */}
                                <div className="px-4 py-3">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <p className="text-xs text-muted-foreground">
                                            {totalRequired - assignedCount > 0
                                                ? `${totalRequired - assignedCount} more guard${totalRequired - assignedCount !== 1 ? 's' : ''} needed`
                                                : 'All positions filled'}
                                        </p>
                                        <p className="text-xs font-semibold">{percent}%</p>
                                    </div>
                                    <Progress value={percent} className="h-2" />
                                </div>

                                {/* Actions */}
                                <div className="px-4 pb-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                                    <Button
                                        onClick={() => { haptic('medium'); handleOpenAssignDialog(order); }}
                                        className="w-full sm:w-auto h-11 sm:h-9 text-sm"
                                        size="sm"
                                    >
                                        <UserPlus className="mr-2 h-4 w-4" />
                                        Assign Guards
                                    </Button>
                                    {canAdminWorkOrders && (
                                        <div className="grid grid-cols-2 gap-2 sm:contents">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-11 sm:h-9 text-sm"
                                                onClick={() => {
                                                    haptic('light');
                                                    setEditCountsFor(order.id);
                                                    setEditMale(order.maleGuardsRequired);
                                                    setEditFemale(order.femaleGuardsRequired);
                                                }}
                                            >
                                                <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                                                Edit
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-11 sm:h-9 text-sm border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                                                onClick={() => { haptic('warning'); setDeleteConfirmOrder(order); }}
                                            >
                                                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                                Delete
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Assign Guards Dialog ── */}
            {selectedWorkOrder && (
                <AssignGuardsDialog
                    isOpen={isAssignDialogOpen}
                    onClose={() => setIsAssignDialogOpen(false)}
                    workOrder={selectedWorkOrder}
                    availableGuards={availableGuards}
                    isLoadingGuards={isLoadingGuards}
                />
            )}

            {/* ── Edit Counts Dialog ── */}
            <Dialog open={editCountsFor !== null} onOpenChange={open => !open && setEditCountsFor(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Edit Manpower Requirements</DialogTitle>
                        <DialogDescription>Update the required guard counts for this duty date.</DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="edit-male">Male Guards</Label>
                            <Input
                                id="edit-male"
                                type="tel"
                                inputMode="numeric"
                                value={editMale}
                                onChange={e => setEditMale(parseInt(e.target.value || '0'))}
                                className="text-center text-xl font-bold h-14"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-female">Female Guards</Label>
                            <Input
                                id="edit-female"
                                type="tel"
                                inputMode="numeric"
                                value={editFemale}
                                onChange={e => setEditFemale(parseInt(e.target.value || '0'))}
                                className="text-center text-xl font-bold h-14"
                            />
                        </div>
                    </div>
                    <div className="rounded-lg bg-muted px-4 py-3 text-center text-sm">
                        Total: <span className="font-bold text-2xl ml-1">{(editMale || 0) + (editFemale || 0)}</span>
                        <span className="text-muted-foreground ml-1">guards</span>
                    </div>
                    <DialogFooter className="gap-2 mt-1">
                        <Button variant="outline" onClick={() => setEditCountsFor(null)} className="w-full sm:w-auto">
                            Cancel
                        </Button>
                        <Button onClick={handleSaveCounts} disabled={isSavingCounts} className="w-full sm:w-auto">
                            {isSavingCounts && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Delete Confirmation Dialog ── */}
            <Dialog open={deleteConfirmOrder !== null} onOpenChange={open => !open && setDeleteConfirmOrder(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Delete Work Order?</DialogTitle>
                        <DialogDescription>
                            This will permanently remove the duty on{' '}
                            <strong>
                                {deleteConfirmOrder?.date.toDate().toLocaleDateString('en-GB', {
                                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                                })}
                            </strong>.
                            {Array.isArray(deleteConfirmOrder?.assignedGuards) && deleteConfirmOrder.assignedGuards.length > 0 && (
                                <span className="block mt-1 text-destructive font-medium">
                                    {deleteConfirmOrder.assignedGuards.length} guard{deleteConfirmOrder.assignedGuards.length !== 1 ? 's are' : ' is'} currently assigned and will be unassigned.
                                </span>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 mt-1">
                        <Button variant="outline" onClick={() => setDeleteConfirmOrder(null)} className="w-full sm:w-auto">
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleConfirmDelete} disabled={isDeletingOrder} className="w-full sm:w-auto">
                            {isDeletingOrder && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
