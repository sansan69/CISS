
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
    SpinnerGap as Loader2, ArrowLeft, UserPlus, WarningCircle as AlertCircle, MagnifyingGlass as Search,
    X, PencilSimple as Edit3, Trash as Trash2, CheckCircle as CheckCircle2,
} from '@phosphor-icons/react';
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
import { useToast } from '@/hooks/use-toast';
import { useHaptics } from '@/hooks/use-haptics';
import type { Employee } from '@/types/employee';
import type { WorkOrder } from '@/types/work-orders';
import { useAppAuth } from '@/context/auth-context';
import { startOfToday } from 'date-fns';
import { isOperationalWorkOrderClientName, isWorkOrderAdminRole } from '@/lib/work-orders';
import { PageHeader } from '@/components/layout/page-header';
import { canonicalizeDistrictName, districtMatches, resolveWorkOrderDistrict } from '@/lib/districts';
import { fetchActiveGuardsForDistricts } from '@/lib/work-orders/available-guards';
import { AssignGuardsDialog } from '@/components/field-officers/work-orders-panel';
import { PageLoading } from "@/components/common/page-loading";

type WorkOrderExamFields = Pick<
    WorkOrder,
    'examName' | 'examCode' | 'recordStatus' | 'importId' | 'sourceFileName'
>;


interface Site {
    id: string;
    siteName: string;
    clientName: string;
    district: string;
    districtName?: string;
}


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
    const canAssignGuards = canAdminWorkOrders || userRole === 'fieldOfficer';
    const isClientView = userRole === 'client';
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
                let resolvedDistrict = "";
                let districtFilter = "";
                if (!siteDoc.exists()) {
                    setSite(null);
                    toast({
                        title: "Site record deleted",
                        description: "This site document no longer exists. Update or restore it to fix site metadata.",
                    });
                } else {
                    const siteData = { id: siteDoc.id, ...siteDoc.data() } as Site;
                    resolvedDistrict = canonicalizeDistrictName(siteData.district || siteData.districtName || "");
                    districtFilter = resolvedDistrict;
                    if (!isOperationalWorkOrderClientName((siteData as { clientName?: string }).clientName)) {
                        throw new Error("Work orders are only available for TCS sites.");
                    }
                    if (
                        userRole === 'fieldOfficer' &&
                        !assignedDistricts.some((district) => districtMatches(district, resolvedDistrict))
                    ) {
                        throw new Error("You do not have permission to view this site's work orders.");
                    }
                    setSite({
                        ...siteData,
                        district: resolvedDistrict,
                    });
                }

                let q;
                if (userRole === 'fieldOfficer') {
                    const scope = districtFilter ? [districtFilter] : assignedDistricts.slice(0, 10);
                    q = query(
                        collection(db, "workOrders"),
                        where("siteId", "==", siteId),
                        where("district", "in", scope),
                    );
                } else {
                    q = query(collection(db, "workOrders"), where("siteId", "==", siteId));
                }
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
    }, [siteId, userRole, assignedDistricts, toast]);

    const handleOpenAssignDialog = async (workOrder: WorkOrder) => {
        setSelectedWorkOrder(workOrder);
        setIsAssignDialogOpen(true);
        setIsLoadingGuards(true);
        try {
            const resolvedDistrict = resolveWorkOrderDistrict(workOrder.district, site?.district || site?.districtName);
            // Admin: when the site/work-order has no usable district (legacy
            // import without a district column), fetch every active guard so
            // the dialog never silently shows "no guards to map". Toast a
            // warning so the operator knows to fix the site district.
            let scope: string[];
            if (canAdminWorkOrders) {
                scope = resolvedDistrict ? [resolvedDistrict] : [];
                if (!resolvedDistrict) {
                    toast({
                        variant: 'destructive',
                        title: 'Missing district',
                        description: 'This site has no district set. Showing all active guards. Fix the site district to scope the list.',
                    });
                }
            } else {
                scope = assignedDistricts;
            }
            const guards = await fetchActiveGuardsForDistricts(scope, { allowEmptyScope: canAdminWorkOrders });
            setAvailableGuards(guards);
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
            <PageLoading label="Loading schedules…" />
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
                title={site ? `${site.siteName}` : isClientView ? "Deployment Details" : "Guard Assignment"}
                description={
                    site
                        ? isClientView
                            ? `Review upcoming deployment coverage at ${site.clientName} — ${site.district}.`
                            : `Assign guards for upcoming duties at ${site.clientName} — ${site.district}.`
                        : isClientView
                            ? "Review staffing for the selected duty site."
                            : "Assign guards and review staffing for the selected duty site."
                }
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
                        const assignedGuards = Array.isArray(order.assignedGuards) ? order.assignedGuards : [];
                        const assignedCount = assignedGuards.length;
                        const assignedMale = assignedGuards.filter((guard) => guard.gender?.trim().toLowerCase() === 'male').length;
                        const assignedFemale = assignedGuards.filter((guard) => guard.gender?.trim().toLowerCase() === 'female').length;
                        const maleReady = assignedMale >= (order.maleGuardsRequired || 0);
                        const femaleReady = assignedFemale >= (order.femaleGuardsRequired || 0);
                        const needsAssignmentReview =
                            order.assignmentReviewRequired === true ||
                            order.assignmentStatus === 'review';
                        const percent = totalRequired > 0 ? Math.min(100, Math.round((assignedCount / totalRequired) * 100)) : 0;
                        const isFullyAssigned = !needsAssignmentReview && maleReady && femaleReady && totalRequired > 0;
                        const status = assignedCount === 0 ? 'Unassigned' : needsAssignmentReview ? 'Review' : isFullyAssigned ? 'Fully Assigned' : 'Partial';

                        const borderColor = assignedCount === 0 || needsAssignmentReview
                            ? 'border-l-red-400'
                            : isFullyAssigned ? 'border-l-green-500' : 'border-l-amber-400';

                        const statusBadge = assignedCount === 0 || needsAssignmentReview
                            ? 'bg-destructive/15 text-destructive border-destructive/30'
                            : isFullyAssigned
                                ? 'bg-success/15 text-success border-success/30'
                                : 'bg-warning/15 text-warning-strong border-warning/30';

                        const countColor = assignedCount === 0 || needsAssignmentReview
                            ? 'text-destructive'
                            : isFullyAssigned ? 'text-success' : 'text-warning-strong';

                        return (
                            <div key={order.id} className={`rounded-xl border-l-4 border bg-card shadow-brand-sm overflow-hidden ${borderColor}`}>
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
                                            {assignedCount > totalRequired
                                                ? `${assignedCount - totalRequired} excess assignment${assignedCount - totalRequired === 1 ? '' : 's'} — review required`
                                                : totalRequired - assignedCount > 0
                                                ? `${totalRequired - assignedCount} more guard${totalRequired - assignedCount !== 1 ? 's' : ''} needed`
                                                : isFullyAssigned
                                                    ? 'All positions filled'
                                                    : 'Gender allocation needs review'}
                                        </p>
                                        <p className="text-xs font-semibold">{percent}%</p>
                                    </div>
                                    <Progress value={percent} className="h-2" />
                                </div>

                                {/* Actions */}
                                <div className="px-4 pb-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                                    {canAssignGuards && (
                                        <Button
                                            onClick={() => { haptic('medium'); handleOpenAssignDialog(order); }}
                                            className="w-full sm:w-auto h-11 sm:h-9 text-sm"
                                            size="sm"
                                        >
                                            <UserPlus className="mr-2 h-4 w-4" />
                                            Assign Guards
                                        </Button>
                                    )}
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
