
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, onSnapshot, orderBy, doc, getDoc, updateDoc, getDocs, serverTimestamp, deleteDoc, Timestamp, arrayUnion } from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import Link from 'next/link';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, UserPlus, AlertCircle, Search, UserCheck, X, Edit3, Save, Trash2 } from 'lucide-react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Employee } from '@/types/employee';
import { resolveAppUser } from '@/lib/auth/roles';
import { startOfToday } from 'date-fns';
import { buildFirestoreAuditEvent, buildFirestoreUpdateAudit } from '@/lib/firestore-audit';


// Safely compute initials for avatar fallbacks
const getInitials = (name?: string, employeeId?: string) => {
    const safeName = (name || '').trim();
    if (safeName) {
        const parts = safeName.split(/\s+/g).filter(Boolean);
        const initials = parts.map(p => p[0]).slice(0, 2).join('');
        return initials.toUpperCase() || 'NA';
    }
    const id = (employeeId || '').trim();
    return id ? id.slice(-2).toUpperCase() : 'NA';
};

interface WorkOrder {
    id: string;
    siteId: string;
    siteName: string;
    clientName: string;
    district: string;
    date: any; // Firestore Timestamp
    maleGuardsRequired: number;
    femaleGuardsRequired: number;
    totalManpower: number;
    assignedGuards: { uid: string; name: string; employeeId: string; gender: string; }[];
}

interface Site {
    id: string;
    siteName: string;
    clientName: string;
    district: string;
}

const AssignGuardsDialog: React.FC<{
    workOrder: WorkOrder;
    isOpen: boolean;
    onClose: () => void;
    availableGuards: Employee[];
}> = ({ workOrder, isOpen, onClose, availableGuards }) => {
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    // Ensure selectedGuards is always an array
    const [selectedGuards, setSelectedGuards] = useState(Array.isArray(workOrder.assignedGuards) ? workOrder.assignedGuards : []);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setSelectedGuards(Array.isArray(workOrder.assignedGuards) ? workOrder.assignedGuards : []);
    }, [workOrder]);

    const filteredGuards = useMemo(() => {
        if (!searchTerm) return availableGuards;
        const lowercasedFilter = searchTerm.toLowerCase();
        return availableGuards.filter(guard =>
            (guard.fullName || '').toLowerCase().includes(lowercasedFilter) ||
            (guard.employeeId || '').toLowerCase().includes(lowercasedFilter)
        );
    }, [searchTerm, availableGuards]);

    const handleToggleGuard = (guard: Employee) => {
        const isSelected = selectedGuards.some(g => g.uid === guard.id);
        const newGuardSelection = { uid: guard.id, name: guard.fullName, employeeId: guard.employeeId, gender: guard.gender };

        if (isSelected) {
            setSelectedGuards(prev => prev.filter(g => g.uid !== guard.id));
        } else {
            setSelectedGuards(prev => [...prev, newGuardSelection]);
        }
    };
    
    const handleSaveAssignments = async () => {
        setIsSaving(true);
        try {
            const workOrderRef = doc(db, "workOrders", workOrder.id);
            await updateDoc(workOrderRef, {
                assignedGuards: selectedGuards,
                ...buildFirestoreUpdateAudit(),
                assignmentHistory: arrayUnion(
                  buildFirestoreAuditEvent('work_order_assignments_updated', undefined, {
                    siteId: workOrder.siteId,
                    assignedGuardIds: selectedGuards.map((guard) => guard.uid),
                    assignedCount: selectedGuards.length,
                  }),
                ),
            });
            toast({ title: "Success", description: "Guard assignments have been updated." });
            onClose();
        } catch (error) {
            console.error("Error saving assignments:", error);
            toast({ variant: "destructive", title: "Error", description: "Could not save assignments." });
        } finally {
            setIsSaving(false);
        }
    };
    
    const maleAssignedCount = selectedGuards.filter(g => g.gender === 'Male').length;
    const femaleAssignedCount = selectedGuards.filter(g => g.gender === 'Female').length;

    // Find assigned guard details for display
    const getAssignedGuardDetails = (uid: string) => {
        return availableGuards.find(g => g.id === uid);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="flex h-[min(92dvh,56rem)] w-[calc(100vw-1rem)] max-w-full flex-col gap-0 overflow-hidden p-0 sm:h-[85vh] sm:w-[90vw] md:max-w-4xl lg:max-w-5xl">
                <DialogHeader className="flex-shrink-0 border-b px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
                    <DialogTitle className="pr-8 text-base leading-tight sm:text-xl">Assign Guards for {workOrder.siteName}</DialogTitle>
                    <DialogDescription className="text-sm">
                        {workOrder.date.toDate().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </DialogDescription>
                </DialogHeader>

                {/* Mobile: Tabs, Desktop: Side-by-side */}
                <div className="flex-1 overflow-hidden min-h-0 flex flex-col md:flex-row">
                    {/* Mobile: Tab Navigation */}
                    <div className="md:hidden flex flex-col flex-1 overflow-hidden min-h-0">
                        <Tabs defaultValue="available" className="flex flex-col flex-1 overflow-hidden min-h-0 w-full">
                            <div className="flex-shrink-0 border-b px-4 pt-2">
                                <TabsList className="w-full grid grid-cols-2 h-auto p-1">
                                    <TabsTrigger value="available" className="text-xs sm:text-sm py-2.5">
                                        Available ({filteredGuards.length})
                                    </TabsTrigger>
                                    <TabsTrigger value="assigned" className="text-xs sm:text-sm py-2.5 relative">
                                        Assigned ({selectedGuards.length}/{workOrder.totalManpower})
                                        {selectedGuards.length > 0 && (
                                            <span className="ml-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
                                                {selectedGuards.length}
                                            </span>
                                        )}
                                    </TabsTrigger>
                                </TabsList>
                            </div>
                            
                            <TabsContent value="available" className="flex-1 overflow-hidden m-0 p-4 data-[state=active]:flex data-[state=active]:flex-col">
                                <div className="flex flex-col gap-3 h-full">
                                    <div className="relative flex-shrink-0">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Search guards..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            className="pl-9 h-10 text-sm"
                                        />
                                    </div>
                                    <Card className="flex-shrink-0">
                                        <CardContent className="p-3 grid grid-cols-3 gap-2 text-center">
                                            <div>
                                                <p className="text-xl font-bold">{workOrder.maleGuardsRequired}</p>
                                                <p className="text-xs text-muted-foreground">Male</p>
                                            </div>
                                            <div>
                                                <p className="text-xl font-bold">{workOrder.femaleGuardsRequired}</p>
                                                <p className="text-xs text-muted-foreground">Female</p>
                                            </div>
                                            <div>
                                                <p className="text-xl font-bold">{workOrder.totalManpower}</p>
                                                <p className="text-xs text-muted-foreground">Total</p>
                                            </div>
                                        </CardContent>
                                    </Card>
                                    <ScrollArea className="flex-1 min-h-0">
                                        <div className="space-y-2 pr-2">
                                            {filteredGuards.length > 0 ? filteredGuards.map(guard => {
                                                const isSelected = selectedGuards.some(g => g.uid === guard.id);
                                                return (
                                                    <div 
                                                        key={guard.id} 
                                                        className={`flex flex-col gap-3 rounded-lg border p-3 transition-colors sm:flex-row sm:items-center ${
                                                            isSelected ? 'bg-primary/5 border-primary/20' : 'bg-card hover:bg-muted/50'
                                                        }`}
                                                    >
                                                        <div className="flex items-start gap-3">
                                                            <Avatar className="h-10 w-10 flex-shrink-0">
                                                                <AvatarImage src={guard.profilePictureUrl} />
                                                                <AvatarFallback className="text-xs">
                                                                    {getInitials(guard.fullName as any, (guard as any).employeeId)}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            <div className="min-w-0 flex-1">
                                                                <p className="font-medium text-sm break-words">{guard.fullName}</p>
                                                                <p className="text-xs text-muted-foreground break-all">{guard.employeeId}</p>
                                                                <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0">
                                                                    {guard.gender}
                                                                </Badge>
                                                            </div>
                                                        </div>
                                                        <Button
                                                            size="sm"
                                                            variant={isSelected ? "destructive" : "default"}
                                                            onClick={() => handleToggleGuard(guard)}
                                                            className="w-full flex-shrink-0 text-xs sm:w-auto"
                                                        >
                                                            {isSelected ? (
                                                                <>
                                                                    <X className="h-3 w-3 mr-1" />
                                                                    Remove
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <UserCheck className="h-3 w-3 mr-1" />
                                                                    Add
                                                                </>
                                                            )}
                                                        </Button>
                                                    </div>
                                                );
                                            }) : (
                                                <div className="text-center text-muted-foreground py-8">
                                                    <p className="text-sm">No available guards found.</p>
                                                </div>
                                            )}
                                        </div>
                                    </ScrollArea>
                                </div>
                            </TabsContent>
                            
                            <TabsContent value="assigned" className="flex-1 overflow-hidden m-0 p-4 data-[state=active]:flex data-[state=active]:flex-col">
                                <div className="flex flex-col gap-3 h-full">
                                    <Card className="flex-shrink-0">
                                        <CardContent className="p-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <h3 className="font-semibold text-sm">Assignment Status</h3>
                                                <Badge variant={selectedGuards.length >= workOrder.totalManpower ? "default" : "secondary"}>
                                                    {selectedGuards.length}/{workOrder.totalManpower}
                                                </Badge>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                                                    <span className="text-muted-foreground">Male:</span>
                                                    <span className="font-semibold">
                                                        {maleAssignedCount}/{workOrder.maleGuardsRequired}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                                                    <span className="text-muted-foreground">Female:</span>
                                                    <span className="font-semibold">
                                                        {femaleAssignedCount}/{workOrder.femaleGuardsRequired}
                                                    </span>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                    <ScrollArea className="flex-1 min-h-0">
                                        <div className="space-y-2 pr-2">
                                            {selectedGuards.length > 0 ? selectedGuards.map(guard => {
                                                const guardDetails = getAssignedGuardDetails(guard.uid);
                                                return (
                                                    <div 
                                                        key={guard.uid} 
                                                        className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center"
                                                    >
                                                        <div className="flex items-start gap-3">
                                                            <Avatar className="h-10 w-10 flex-shrink-0">
                                                                <AvatarImage src={guardDetails?.profilePictureUrl} />
                                                                <AvatarFallback className="text-xs">
                                                                    {getInitials(guard.name, guard.employeeId)}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            <div className="min-w-0 flex-1">
                                                                <p className="font-medium text-sm break-words">{guard.name}</p>
                                                                <p className="text-xs text-muted-foreground break-all">{guard.employeeId}</p>
                                                                <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0">
                                                                    {guard.gender}
                                                                </Badge>
                                                            </div>
                                                        </div>
                                                        <Button 
                                                            size="sm" 
                                                            variant="destructive" 
                                                            onClick={() => setSelectedGuards(prev => prev.filter(g => g.uid !== guard.uid))}
                                                            className="w-full flex-shrink-0 text-xs sm:w-auto"
                                                        >
                                                            <X className="h-3 w-3 sm:mr-1" />
                                                            <span className="sm:hidden">Remove Guard</span>
                                                        </Button>
                                                    </div>
                                                );
                                            }) : (
                                                <div className="text-center text-muted-foreground py-8">
                                                    <UserPlus className="h-12 w-12 mx-auto mb-2 opacity-50" />
                                                    <p className="text-sm">No guards assigned yet.</p>
                                                    <p className="text-xs mt-1">Switch to "Available" tab to assign guards.</p>
                                                </div>
                                            )}
                                        </div>
                                    </ScrollArea>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>

                    {/* Desktop: Side-by-side layout */}
                    <div className="hidden md:flex flex-1 overflow-hidden min-h-0 gap-4 px-4 sm:px-6 py-4">
                        {/* Left: Available Guards */}
                        <div className="flex flex-col gap-3 flex-1 min-w-0 overflow-hidden">
                            <div className="relative flex-shrink-0">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search available guards..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                            <ScrollArea className="flex-1 min-h-0 border rounded-md">
                                <div className="p-3 space-y-2">
                                    {filteredGuards.length > 0 ? filteredGuards.map(guard => {
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
                                                        <>
                                                            <X className="h-4 w-4 mr-1.5" />
                                                            Unassign
                                                        </>
                                                    ) : (
                                                        <>
                                                            <UserCheck className="h-4 w-4 mr-1.5" />
                                                            Assign
                                                        </>
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
                                <CardHeader className="p-4 pb-2">
                                    <CardTitle className="text-base">Manpower Requirement</CardTitle>
                                </CardHeader>
                                <CardContent className="p-4 pt-0 grid grid-cols-3 gap-3 text-center">
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
                                    <h3 className="font-semibold text-sm">
                                        Assigned Guards
                                    </h3>
                                    <Badge variant={selectedGuards.length >= workOrder.totalManpower ? "default" : "secondary"}>
                                        {selectedGuards.length}/{workOrder.totalManpower}
                                    </Badge>
                                </div>
                                <div className="flex gap-3 text-xs text-muted-foreground flex-shrink-0">
                                    <span>Male: {maleAssignedCount}/{workOrder.maleGuardsRequired}</span>
                                    <span>Female: {femaleAssignedCount}/{workOrder.femaleGuardsRequired}</span>
                                </div>
                                <ScrollArea className="flex-1 min-h-0 border rounded-md">
                                    <div className="p-3 space-y-2">
                                        {selectedGuards.length > 0 ? selectedGuards.map(guard => {
                                            const guardDetails = getAssignedGuardDetails(guard.uid);
                                            return (
                                                <div 
                                                    key={guard.uid} 
                                                    className="flex items-center gap-3 p-2.5 rounded-md bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors"
                                                >
                                                    <Avatar className="h-9 w-9 flex-shrink-0">
                                                        <AvatarImage src={guardDetails?.profilePictureUrl} />
                                                        <AvatarFallback className="text-xs">
                                                            {getInitials(guard.name, guard.employeeId)}
                                                        </AvatarFallback>
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

                <DialogFooter className="flex-shrink-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 sm:px-6 py-3 sm:py-4 gap-2">
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
}


export default function AssignGuardsPage() {
    const params = useParams();
    const router = useRouter();
    const siteId = params.siteId as string;

    const [site, setSite] = useState<Site | null>(null);
    const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [assignedDistricts, setAssignedDistricts] = useState<string[]>([]);
    const [userRole, setUserRole] = useState<string | null>(null);

    // State for Dialog
    const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
    const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
    const [availableGuards, setAvailableGuards] = useState<Employee[]>([]);
    const [isLoadingGuards, setIsLoadingGuards] = useState(false);
    const [editCountsFor, setEditCountsFor] = useState<string | null>(null);
    const [editMale, setEditMale] = useState<number>(0);
    const [editFemale, setEditFemale] = useState<number>(0);

    useEffect(() => {
        const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    const appUser = await resolveAppUser(user);
                    setUserRole(appUser.role);
                    setAssignedDistricts(appUser.assignedDistricts || []);
                } catch (e) {
                    setUserRole('user');
                    setAssignedDistricts([]);
                }
            } else {
                router.push('/admin-login');
            }
        });
        return () => unsubscribeAuth();
    }, [router]);

    useEffect(() => {
        if (!siteId || userRole === null) return;

        const fetchSiteAndWorkOrders = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const siteDocRef = doc(db, "sites", siteId);
                const siteDoc = await getDoc(siteDocRef);

                if (!siteDoc.exists()) throw new Error("Site not found.");

                const siteData = { id: siteDoc.id, ...siteDoc.data() } as Site;
                
                if (userRole === 'fieldOfficer' && !assignedDistricts.includes(siteData.district)) {
                     throw new Error("You do not have permission to view this site's work orders.");
                }
                setSite(siteData);

                const q = query(collection(db, "workOrders"), where("siteId", "==", siteId));
                const unsubscribe = onSnapshot(q, (snapshot) => {
                    const todayMs = startOfToday().getTime();
                    const orders = snapshot.docs
                        .map(doc => ({ id: doc.id, ...doc.data() } as WorkOrder))
                        .filter(o => {
                            try { return o.date.toDate().getTime() >= todayMs; } catch { return true; }
                        });
                    // Sort by date ascending client-side to avoid composite index requirement
                    orders.sort((a,b) => a.date.toMillis() - b.date.toMillis());
                    setWorkOrders(orders);
                    setIsLoading(false);
                }, (err) => {
                    setError("Could not load work orders for this site.");
                    setIsLoading(false);
                });
                
                return unsubscribe;
            } catch (err: any) {
                setError(err.message);
                setIsLoading(false);
            }
        };

        fetchSiteAndWorkOrders();

    }, [siteId, userRole, assignedDistricts]);
    
    const handleOpenAssignDialog = async (workOrder: WorkOrder) => {
        setSelectedWorkOrder(workOrder);
        setIsAssignDialogOpen(true);
        setIsLoadingGuards(true);

        try {
            const districtsToQuery = userRole === 'admin' ? [workOrder.district] : assignedDistricts;
            if (districtsToQuery.length === 0) {
                 setAvailableGuards([]);
                 setIsLoadingGuards(false);
                 return;
            }

            const guardsQuery = query(
                collection(db, "employees"),
                where("district", "in", districtsToQuery),
                where("status", "==", "Active")
            );
            const snapshot = await getDocs(guardsQuery);
            const guards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
            setAvailableGuards(guards);
        } catch (error) {
            console.error("Error fetching available guards:", error);
            setError("Could not load guards for assignment.");
        } finally {
            setIsLoadingGuards(false);
        }
    }


    if (isLoading || userRole === null) {
        return (
            <div className="flex justify-center items-center h-40">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2">Loading Site Duty Schedules...</p>
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
                    <Link href="/work-orders"><ArrowLeft className="mr-2 h-4 w-4"/>Back to Schedules</Link>
                </Button>
            </Alert>
         )
    }

    return (
        <div className="flex flex-col gap-4 sm:gap-6">
            <div className="flex items-center gap-4">
                 <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
                    <Link href="/work-orders">
                        <ArrowLeft className="mr-2 h-4 w-4"/>
                        Back to All Sites
                    </Link>
                </Button>
            </div>
            
             <Card>
                <CardHeader>
                    <CardTitle className="text-xl leading-tight sm:text-2xl">Guard Assignment for {site?.siteName}</CardTitle>
                    <CardDescription>
                        Assign guards for the upcoming shifts at <span className="font-semibold">{site?.clientName} - {site?.district}</span>.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {workOrders.length === 0 ? (
                        <p className="text-center text-muted-foreground py-10">No upcoming duties found for this site.</p>
                    ) : (
                        <div className="space-y-4">
                           {workOrders.map(order => {
                                const totalRequired = (order.totalManpower ?? 0) || ((order.maleGuardsRequired || 0) + (order.femaleGuardsRequired || 0));
                                const assignedCount = Array.isArray(order.assignedGuards) ? order.assignedGuards.length : 0;
                                const percent = totalRequired > 0 ? Math.min(100, Math.round((assignedCount / totalRequired) * 100)) : 0;
                                const status = assignedCount === 0 ? 'Unassigned' : (assignedCount >= totalRequired ? 'Fully Assigned' : 'Partially Assigned');
                                const cardBg = assignedCount === 0 ? 'bg-red-50/40' : (assignedCount >= totalRequired ? 'bg-green-50/40' : 'bg-amber-50/40');
                                const badgeClass = assignedCount === 0 ? 'bg-red-100 text-red-700 border-red-200' : (assignedCount >= totalRequired ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-800 border-amber-200');
                                return (
                                    <div key={order.id} className={`rounded-lg border p-4 ${cardBg}`}>
                                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="w-full sm:w-auto">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                                <p className="text-base font-bold sm:text-lg">{order.date.toDate().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                                                <span className={`w-fit rounded border px-2 py-0.5 text-[10px] ${badgeClass}`}>{status}</span>
                                            </div>
                                            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
                                                {editCountsFor === order.id ? (
                                                    <>
                                                        <span className="flex items-center gap-2">Male Required:
                                                            <Input type="number" value={editMale} onChange={(e)=>setEditMale(parseInt(e.target.value || '0'))} className="w-20 h-8" />
                                                        </span>
                                                        <span className="flex items-center gap-2">Female Required:
                                                            <Input type="number" value={editFemale} onChange={(e)=>setEditFemale(parseInt(e.target.value || '0'))} className="w-20 h-8" />
                                                        </span>
                                                        <span>Total: <Badge variant="secondary">{(editMale||0)+(editFemale||0)}</Badge></span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span>Male Required: <Badge>{order.maleGuardsRequired}</Badge></span>
                                                        <span>Female Required: <Badge>{order.femaleGuardsRequired}</Badge></span>
                                                        <span>Total: <Badge variant="secondary">{totalRequired}</Badge></span>
                                                    </>
                                                )}
                                                <span>Assigned: <Badge variant="default">{assignedCount}/{totalRequired}</Badge></span>
                                            </div>
                                            <div className="mt-2 max-w-xs">
                                                <Progress value={percent} className="h-1.5" />
                                                <p className="text-[11px] text-muted-foreground mt-1">{percent}% assigned</p>
                                            </div>
                                        </div>
                                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                                            {userRole === 'admin' && (
                                                editCountsFor === order.id ? (
                                                    <Button size="sm" className="w-full sm:w-auto" onClick={async ()=>{
                                                        try {
                                                            const ref = doc(db, 'workOrders', order.id);
                                                            const male = Number.isFinite(editMale) ? editMale : 0;
                                                            const female = Number.isFinite(editFemale) ? editFemale : 0;
                                                            await updateDoc(ref, {
                                                              maleGuardsRequired: male,
                                                              femaleGuardsRequired: female,
                                                              totalManpower: male + female,
                                                              ...buildFirestoreUpdateAudit(),
                                                              assignmentHistory: arrayUnion(
                                                                buildFirestoreAuditEvent('work_order_manpower_updated', undefined, {
                                                                  maleGuardsRequired: male,
                                                                  femaleGuardsRequired: female,
                                                                  totalManpower: male + female,
                                                                }),
                                                              ),
                                                            });
                                                            setEditCountsFor(null);
                                                        } catch (e) {
                                                            console.error(e);
                                                        }
                                                    }}>
                                                        <Save className="mr-2 h-4 w-4"/> Save
                                                    </Button>
                                                ) : (
                                                    <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={()=>{ setEditCountsFor(order.id); setEditMale(order.maleGuardsRequired); setEditFemale(order.femaleGuardsRequired); }}>
                                                        <Edit3 className="mr-2 h-4 w-4"/> Edit
                                                    </Button>
                                                )
                                            )}
                                            {userRole === 'admin' && (
                                                <Button size="sm" variant="destructive" className="w-full sm:w-auto" onClick={async ()=>{
                                                    try {
                                                        await deleteDoc(doc(db,'workOrders', order.id));
                                                    } catch (e) {
                                                        console.error(e);
                                                    }
                                                }}>
                                                    <Trash2 className="mr-2 h-4 w-4"/> Delete
                                                </Button>
                                            )}
                                            <Button onClick={() => handleOpenAssignDialog(order)} size="sm" className="w-full sm:w-auto">
                                                <UserPlus className="mr-2 h-4 w-4" /> Assign
                                            </Button>
                                        </div>
                                        </div>
                                    </div>
                                );
                           })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {selectedWorkOrder && (
                <AssignGuardsDialog
                    isOpen={isAssignDialogOpen}
                    onClose={() => setIsAssignDialogOpen(false)}
                    workOrder={selectedWorkOrder}
                    availableGuards={availableGuards}
                />
            )}
        </div>
    )
}
