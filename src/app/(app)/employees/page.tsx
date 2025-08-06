
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type Employee } from '@/types/employee';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { MoreHorizontal, Search, UserPlus, Eye, Loader2, AlertCircle, CheckCircle, Trash2, AlertTriangle as WarningIcon, CalendarIcon, ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, query, orderBy, limit, getDocs, startAfter, where, doc, updateDoc, serverTimestamp, Timestamp, deleteField, deleteDoc, type QueryDocumentSnapshot, type DocumentData, type Query } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Label } from '@/components/ui/label';

const ITEMS_PER_PAGE = 10;
interface ClientOption { id: string; name: string; }

const keralaDistricts = [ "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod" ];
const statuses = ['Active', 'Inactive', 'OnLeave', 'Exited'];

const getPendingDetails = (employee: Employee): string[] => {
    const pending: string[] = [];
    if (!employee.profilePictureUrl) pending.push("Profile Picture");
    if (!employee.signatureUrl) pending.push("Signature");
    if (!employee.identityProofUrlFront) pending.push("ID Proof (Front)");
    if (!employee.identityProofUrlBack) pending.push("ID Proof (Back)");
    if (!employee.addressProofUrlFront) pending.push("Address Proof (Front)");
    if (!employee.addressProofUrlBack) pending.push("Address Proof (Back)");
    if (!employee.panNumber) pending.push("PAN Number");
    if (!employee.bankAccountNumber || !employee.ifscCode || !employee.bankName) pending.push("Bank Details");
    if (!employee.bankPassbookStatementUrl) pending.push("Bank Document");
    return pending;
};

export default function EmployeeDirectoryPage() {
    const { toast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();

    // User auth state
    const [userRole, setUserRole] = useState<string | null>(null);
    const [assignedDistricts, setAssignedDistricts] = useState<string[]>([]);
    
    // URL is the single source of truth for filters
    const page = parseInt(searchParams.get('page') || '1');
    const searchTerm = searchParams.get('searchTerm') || '';
    const client = searchParams.get('client') || 'all';
    const status = searchParams.get('status') || 'all';
    const district = searchParams.get('district') || 'all';
    
    // Component state
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [clients, setClients] = useState<ClientOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasNextPage, setHasNextPage] = useState(false);

    // Modals state
    const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
    const [selectedEmployeeForStatusChange, setSelectedEmployeeForStatusChange] = useState<Employee | null>(null);
    const [newStatus, setNewStatus] = useState<Employee['status'] | ''>('');
    const [exitDate, setExitDate] = useState<Date | undefined>(undefined);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    
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

    const updateUrlParams = useCallback((newParams: Record<string, string | number | null>) => {
        const params = new URLSearchParams(searchParams.toString());
        for (const [key, value] of Object.entries(newParams)) {
            if (value === null || value === '' || value === 'all' || value === 1) {
                params.delete(key);
            } else {
                params.set(key, String(value));
            }
        }
        router.push(`/employees?${params.toString()}`, { scroll: false });
    }, [router, searchParams]);
    
    const handleFilterChange = (filterType: string, value: string) => {
        updateUrlParams({ [filterType]: value, page: null });
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        updateUrlParams({ searchTerm: e.target.value, page: null });
    };

    useEffect(() => {
        const fetchClients = async () => {
            try {
                const clientsSnapshot = await getDocs(query(collection(db, 'clients'), orderBy('name')));
                setClients(clientsSnapshot.docs.map(docSnap => ({ id: docSnap.id, name: docSnap.data().name as string })));
            } catch (err) {
                toast({ variant: "destructive", title: "Error", description: "Could not fetch client list." });
            }
        };
        fetchClients();
    }, [toast]);

    const fetchData = useCallback(async () => {
        if (userRole === null) return; // Don't fetch until we know the user's role

        setIsLoading(true);
        setError(null);
        try {
            let q: Query = collection(db, "employees");
            
            // Apply role-based filtering first
            if (userRole === 'fieldOfficer' && assignedDistricts.length > 0) {
                q = query(q, where('district', 'in', assignedDistricts));
            } else if (userRole === 'fieldOfficer' && assignedDistricts.length === 0) {
                 // If a field officer has no districts assigned, they should see no employees.
                setEmployees([]);
                setHasNextPage(false);
                setIsLoading(false);
                return;
            }

            if (searchTerm) {
                q = query(q, where('searchableFields', 'array-contains', searchTerm.trim().toUpperCase()));
            }
            if (client !== 'all') {
                q = query(q, where('clientName', '==', client));
            }
            if (status !== 'all') {
                q = query(q, where('status', '==', status));
            }
            if (district !== 'all' && userRole !== 'fieldOfficer') { // Field officers are already filtered by their districts
                q = query(q, where('district', '==', district));
            }

            if (!searchTerm.trim()) {
                q = query(q, orderBy('createdAt', 'desc'));
            }

            let finalQuery = q;
            if (page > 1) {
                const snapshot = await getDocs(query(q, limit( (page -1) * ITEMS_PER_PAGE)));
                const lastDoc = snapshot.docs[snapshot.docs.length-1];
                if (lastDoc) {
                    finalQuery = query(q, startAfter(lastDoc), limit(ITEMS_PER_PAGE));
                }
            } else {
                finalQuery = query(q, limit(ITEMS_PER_PAGE));
            }

            const documentSnapshots = await getDocs(finalQuery);
            const fetchedEmployees = documentSnapshots.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Employee));
            setEmployees(fetchedEmployees);
            
            const lastDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1];

            // Check if there is a next page
            if(lastDoc) {
                const nextQuery = query(q, startAfter(lastDoc), limit(1));
                const nextSnapshot = await getDocs(nextQuery);
                setHasNextPage(!nextSnapshot.empty);
            } else {
                setHasNextPage(false);
            }

        } catch (err: any) {
            let message = err.message || "Failed to fetch employees.";
            if (err.code === 'permission-denied') message = "Permission denied. Check Firestore security rules.";
            if (err.code === 'failed-precondition') message = "A required database index is missing. Check browser console for a link to create it.";
            setError(message);
        } finally {
            setIsLoading(false);
        }
    }, [page, searchTerm, client, status, district, userRole, assignedDistricts]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleConfirmDelete = async () => {
        if (!employeeToDelete) return;
        setIsDeleting(true);
        try {
            await deleteDoc(doc(db, "employees", employeeToDelete.id));
            toast({ title: "Employee Deleted", description: `${employeeToDelete.fullName} has been removed.` });
            fetchData(); // Refetch current page
        } catch (err) {
            toast({ variant: "destructive", title: "Error", description: "Could not delete employee." });
        } finally {
            setIsDeleting(false);
            setIsDeleteDialogOpen(false);
            setEmployeeToDelete(null);
        }
    };
    
    const handleConfirmStatusUpdate = async () => {
        if (!selectedEmployeeForStatusChange || !newStatus) return;
        setIsUpdatingStatus(true);
        try {
          const employeeDocRef = doc(db, "employees", selectedEmployeeForStatusChange.id);
          const updateData: any = { status: newStatus, updatedAt: serverTimestamp() };
          if (newStatus === 'Exited') {
            if (!exitDate) {
              toast({ variant: "destructive", title: "Error", description: "Exit date is required." });
              setIsUpdatingStatus(false);
              return;
            }
            updateData.exitDate = Timestamp.fromDate(exitDate);
          } else {
            updateData.exitDate = deleteField();
          }
          await updateDoc(employeeDocRef, updateData);
          toast({ title: "Status Updated", description: `${selectedEmployeeForStatusChange.fullName}'s status updated to ${newStatus}.` });
          setEmployees(prev => prev.map(emp => emp.id === selectedEmployeeForStatusChange.id ? { ...emp, status: newStatus, exitDate: newStatus === 'Exited' ? exitDate : undefined } : emp));
        } catch (err) {
          toast({ variant: "destructive", title: "Error", description: "Could not update employee status." });
        } finally {
          setIsUpdatingStatus(false);
          setIsStatusModalOpen(false);
          setSelectedEmployeeForStatusChange(null);
        }
      };

    const getStatusBadgeVariant = (status?: Employee['status']) => {
        switch (status) {
            case 'Active': return 'default';
            case 'Inactive': return 'secondary';
            case 'OnLeave': return 'outline';
            case 'Exited': return 'destructive';
            default: return 'outline';
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Employee Directory</h1>
                    <p className="text-muted-foreground">Manage and view all employee profiles.</p>
                </div>
                {userRole === 'admin' && (
                  <Button asChild><Link href="/employees/enroll"><UserPlus className="mr-2 h-4 w-4" /> Enroll New</Link></Button>
                )}
            </div>

            <Card>
                <CardHeader><CardTitle>Filters & Search</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    <div className="sm:col-span-2 lg:col-span-1 xl:col-span-2 relative">
                        <Label htmlFor="search-input" className="sr-only">Search</Label>
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input id="search-input" type="search" placeholder="Search by Name, ID, or Phone..." defaultValue={searchTerm} onChange={handleSearchChange} className="pl-10" />
                    </div>
                    <div>
                        <Label htmlFor="client-filter" className="sr-only">Client</Label>
                        <Select value={client} onValueChange={(val) => handleFilterChange('client', val)}><SelectTrigger id="client-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Clients</SelectItem>{clients.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent></Select>
                    </div>
                     <div>
                        <Label htmlFor="district-filter" className="sr-only">District</Label>
                        <Select value={district} onValueChange={(val) => handleFilterChange('district', val)} disabled={userRole === 'fieldOfficer'}>
                            <SelectTrigger id="district-filter"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Districts</SelectItem>
                                { (userRole === 'fieldOfficer' ? assignedDistricts : keralaDistricts).map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        {userRole === 'fieldOfficer' && <p className="text-xs text-muted-foreground mt-1">Filtered by your assigned districts.</p>}
                    </div>
                    <div>
                        <Label htmlFor="status-filter" className="sr-only">Status</Label>
                        <Select value={status} onValueChange={(val) => handleFilterChange('status', val)}><SelectTrigger id="status-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Statuses</SelectItem>{statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Employee List</CardTitle>
                    <CardDescription>A directory of all personnel in the system.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Employee</TableHead>
                                    <TableHead className="hidden md:table-cell">Employee ID</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Profile</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    Array.from({ length: 5 }).map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell colSpan={5} className="p-0">
                                                <div className="flex items-center gap-4 p-4">
                                                    <Avatar><AvatarFallback className="animate-pulse bg-muted" /></Avatar>
                                                    <div className="w-full space-y-2">
                                                        <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
                                                        <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : error ? (
                                    <TableRow><TableCell colSpan={5} className="text-center h-24 text-destructive">{error}</TableCell></TableRow>
                                ) : employees.length === 0 ? (
                                    <TableRow><TableCell colSpan={5} className="text-center h-24">No employees found for the current filters.</TableCell></TableRow>
                                ) : (
                                    employees.map((emp) => {
                                        const pendingItems = getPendingDetails(emp);
                                        return (
                                            <TableRow 
                                                key={emp.id} 
                                                className="hover:bg-muted/50 cursor-pointer"
                                                onClick={() => router.push(`/employees/${emp.id}?${searchParams.toString()}`)}
                                            >
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        <Avatar>
                                                            <AvatarImage src={emp.profilePictureUrl} data-ai-hint="employee avatar" />
                                                            <AvatarFallback>{emp.fullName?.split(' ').map(n => n[0]).join('') || 'U'}</AvatarFallback>
                                                        </Avatar>
                                                        <div>
                                                            <div className="font-medium">{emp.fullName}</div>
                                                            <div className="text-sm text-muted-foreground">{emp.clientName}</div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell font-mono text-xs">{emp.employeeId}</TableCell>
                                                <TableCell><Badge variant={getStatusBadgeVariant(emp.status)}>{emp.status}</Badge></TableCell>
                                                <TableCell>
                                                    {pendingItems.length === 0 ? (
                                                        <div className="flex items-center gap-1.5 text-green-600"><CheckCircle className="h-4 w-4" /> <span className="text-xs">Complete</span></div>
                                                    ) : (
                                                        <Popover>
                                                            <PopoverTrigger asChild>
                                                                <Button variant="ghost" size="sm" className="flex items-center gap-1.5 text-amber-600 px-2 h-auto py-1" onClick={(e) => e.stopPropagation()}>
                                                                    <WarningIcon className="h-4 w-4" /> <span className="text-xs">{pendingItems.length} Pending</span>
                                                                </Button>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-64 text-xs">
                                                                <div className="space-y-2">
                                                                    <h4 className="font-medium">Pending Items</h4>
                                                                    <ul className="list-disc list-inside space-y-1">
                                                                        {pendingItems.slice(0, 5).map(item => <li key={item}>{item}</li>)}
                                                                        {pendingItems.length > 5 && <li className='font-medium'>...and {pendingItems.length - 5} more.</li>}
                                                                    </ul>
                                                                </div>
                                                            </PopoverContent>
                                                        </Popover>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onClick={() => router.push(`/employees/${emp.id}?${searchParams.toString()}`)}><Eye className="mr-2 h-4 w-4" /> View / Edit</DropdownMenuItem>
                                                            {userRole === 'admin' && (
                                                                <>
                                                                    <DropdownMenuSeparator />
                                                                    <DropdownMenuItem onClick={() => { setSelectedEmployeeForStatusChange(emp); setNewStatus('Active'); setExitDate(undefined); setIsStatusModalOpen(true); }}>Set Active</DropdownMenuItem>
                                                                    <DropdownMenuItem onClick={() => { setSelectedEmployeeForStatusChange(emp); setNewStatus('Exited'); setExitDate(undefined); setIsStatusModalOpen(true); }}>Set Exited</DropdownMenuItem>
                                                                    <DropdownMenuSeparator />
                                                                    <DropdownMenuItem className="text-destructive" onClick={() => { setEmployeeToDelete(emp); setIsDeleteDialogOpen(true); }}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                                                                </>
                                                            )}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
                <CardFooter>
                    <div className="flex justify-between items-center w-full">
                        <span className="text-sm text-muted-foreground">Page {page}</span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => updateUrlParams({page: page - 1})} disabled={isLoading || page <= 1}>
                                <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => updateUrlParams({page: page + 1})} disabled={isLoading || !hasNextPage}>
                                Next <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardFooter>
            </Card>

            {selectedEmployeeForStatusChange && (
                <AlertDialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Update Status for {selectedEmployeeForStatusChange.fullName}</AlertDialogTitle>
                            <AlertDialogDescription>
                                Changing status to <Badge variant={getStatusBadgeVariant(newStatus as Employee['status'])}>{newStatus}</Badge>. 
                                {newStatus === 'Exited' && " Please provide the exit date."}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {newStatus === 'Exited' && (
                            <div className="grid gap-2 py-2">
                                <Label htmlFor="exitDate">Date of Exit</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button id="exitDate" variant={"outline"}>
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {exitDate ? format(exitDate, "dd-MM-yyyy") : <span>Pick a date</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar mode="single" selected={exitDate} onSelect={setExitDate} disabled={(date) => date > new Date()} initialFocus />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        )}
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={isUpdatingStatus}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleConfirmStatusUpdate} disabled={isUpdatingStatus || (newStatus === 'Exited' && !exitDate)}>
                                {isUpdatingStatus && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}

            {employeeToDelete && (
                <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
                            <AlertDialogDescription>Are you sure you want to delete {employeeToDelete.fullName}? This action cannot be undone and all associated files will be removed.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                               {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </div>
    );
}
