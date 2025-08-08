
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, onSnapshot, orderBy, doc, getDoc, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import Link from 'next/link';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, UserPlus, AlertCircle, Search, UserCheck, X } from 'lucide-react';
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
import type { Employee } from '@/types/employee';


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
    const [selectedGuards, setSelectedGuards] = useState(workOrder.assignedGuards || []);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setSelectedGuards(workOrder.assignedGuards || []);
    }, [workOrder]);

    const filteredGuards = useMemo(() => {
        if (!searchTerm) return availableGuards;
        const lowercasedFilter = searchTerm.toLowerCase();
        return availableGuards.filter(guard =>
            guard.fullName.toLowerCase().includes(lowercasedFilter) ||
            guard.employeeId.toLowerCase().includes(lowercasedFilter)
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
                updatedAt: serverTimestamp(),
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

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Assign Guards for {workOrder.siteName}</DialogTitle>
                    <DialogDescription>
                        Date: {workOrder.date.toDate().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex-1 grid md:grid-cols-2 gap-6 overflow-hidden">
                    {/* Left side: Search and available guards */}
                    <div className="flex flex-col gap-4 overflow-hidden">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <Input
                                placeholder="Search available guards..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                        <ScrollArea className="flex-1 border rounded-md">
                             <div className="p-2 space-y-1">
                                {filteredGuards.length > 0 ? filteredGuards.map(guard => (
                                    <div key={guard.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                                        <div className="flex items-center gap-3">
                                            <Avatar>
                                                <AvatarImage src={guard.profilePictureUrl} />
                                                <AvatarFallback>{guard.fullName.split(' ').map(n=>n[0]).join('')}</AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="font-medium">{guard.fullName}</p>
                                                <p className="text-sm text-muted-foreground">{guard.employeeId}</p>
                                            </div>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant={selectedGuards.some(g => g.uid === guard.id) ? "destructive" : "outline"}
                                            onClick={() => handleToggleGuard(guard)}
                                        >
                                           {selectedGuards.some(g => g.uid === guard.id) ? <X className="mr-2 h-4 w-4" /> : <UserCheck className="mr-2 h-4 w-4" />}
                                           {selectedGuards.some(g => g.uid === guard.id) ? "Unassign" : "Assign"}
                                        </Button>
                                    </div>
                                )) : (
                                    <p className="text-center text-muted-foreground p-4">No available guards found.</p>
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                    {/* Right side: Requirements and assigned guards */}
                    <div className="flex flex-col gap-4">
                        <Card>
                            <CardHeader className="p-4">
                                <CardTitle className="text-lg">Manpower Requirement</CardTitle>
                            </CardHeader>
                            <CardContent className="p-4 grid grid-cols-3 gap-2 text-center">
                                <div><p className="text-2xl font-bold">{workOrder.maleGuardsRequired}</p><p className="text-sm text-muted-foreground">Male</p></div>
                                <div><p className="text-2xl font-bold">{workOrder.femaleGuardsRequired}</p><p className="text-sm text-muted-foreground">Female</p></div>
                                <div><p className="text-2xl font-bold">{workOrder.totalManpower}</p><p className="text-sm text-muted-foreground">Total</p></div>
                            </CardContent>
                        </Card>
                        <Separator />
                        <div className="flex-1 flex flex-col gap-2 overflow-hidden">
                           <h3 className="font-semibold">
                                Assigned Guards ({selectedGuards.length} / {workOrder.totalManpower})
                           </h3>
                           <div className="flex gap-4 text-sm">
                               <p>Male: {maleAssignedCount}/{workOrder.maleGuardsRequired}</p>
                               <p>Female: {femaleAssignedCount}/{workOrder.femaleGuardsRequired}</p>
                           </div>
                           <ScrollArea className="flex-1 border rounded-md p-2">
                               {selectedGuards.length > 0 ? selectedGuards.map(guard => (
                                    <div key={guard.uid} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                                         <div className="flex items-center gap-3">
                                            <div>
                                                <p className="font-medium">{guard.name}</p>
                                                <p className="text-sm text-muted-foreground">{guard.employeeId}</p>
                                            </div>
                                        </div>
                                         <Button size="sm" variant="destructive" onClick={() => setSelectedGuards(prev => prev.filter(g => g.uid !== guard.uid))}>
                                            <X className="mr-2 h-4 w-4" /> Remove
                                         </Button>
                                    </div>
                               )) : (
                                   <p className="text-center text-muted-foreground p-4">No guards assigned yet.</p>
                               )}
                           </ScrollArea>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSaveAssignments} disabled={isSaving}>
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

    const [user, setUser] = useState<User | null>(null);
    const [assignedDistricts, setAssignedDistricts] = useState<string[]>([]);
    const [userRole, setUserRole] = useState<string | null>(null);

    // State for Dialog
    const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
    const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
    const [availableGuards, setAvailableGuards] = useState<Employee[]>([]);
    const [isLoadingGuards, setIsLoadingGuards] = useState(false);

    useEffect(() => {
        const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUser(user);
                 try {
                    const officersRef = collection(db, "fieldOfficers");
                    const q = query(officersRef, where("uid", "==", user.uid));
                    const snapshot = await getDocs(q);
                    if (!snapshot.empty) {
                        const officerData = snapshot.docs[0].data();
                        setUserRole('fieldOfficer');
                        setAssignedDistricts(officerData.assignedDistricts || []);
                    } else if (user.email === 'admin@cisskerala.app') {
                        setUserRole('admin');
                        setAssignedDistricts([]);
                    } else {
                        setUserRole('user');
                    }
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

                const q = query(collection(db, "workOrders"), where("siteId", "==", siteId), orderBy("date", "asc"));
                const unsubscribe = onSnapshot(q, (snapshot) => {
                    const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WorkOrder));
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
            const guardsQuery = query(
                collection(db, "employees"),
                where("district", "in", assignedDistricts.length > 0 ? assignedDistricts : [workOrder.district]),
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
        <div className="flex flex-col gap-6">
            <div className="flex items-center gap-4">
                 <Button variant="outline" size="sm" asChild>
                    <Link href="/work-orders">
                        <ArrowLeft className="mr-2 h-4 w-4"/>
                        Back to All Sites
                    </Link>
                </Button>
            </div>
            
             <Card>
                <CardHeader>
                    <CardTitle className="text-2xl">Guard Assignment for {site?.siteName}</CardTitle>
                    <CardDescription>
                        Assign guards for the upcoming shifts at <span className="font-semibold">{site?.clientName} - {site?.district}</span>.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {workOrders.length === 0 ? (
                        <p className="text-center text-muted-foreground py-10">No upcoming duties found for this site.</p>
                    ) : (
                        <div className="space-y-4">
                           {workOrders.map(order => (
                                <div key={order.id} className="p-4 border rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                    <div>
                                        <p className="font-bold text-lg">{order.date.toDate().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                                        <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
                                            <span>Male Required: <Badge>{order.maleGuardsRequired}</Badge></span>
                                            <span>Female Required: <Badge>{order.femaleGuardsRequired}</Badge></span>
                                            <span>Total: <Badge variant="secondary">{order.totalManpower}</Badge></span>
                                            <span>Assigned: <Badge variant="default">{order.assignedGuards?.length || 0}</Badge></span>
                                        </div>
                                    </div>
                                    <Button onClick={() => handleOpenAssignDialog(order)}>
                                        <UserPlus className="mr-2 h-4 w-4" /> Assign
                                    </Button>
                                </div>
                           ))}
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
