
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { collection, query, orderBy, limit, getDocs, startAfter, where, doc, updateDoc, serverTimestamp, Timestamp, deleteField, deleteDoc, type QueryDocumentSnapshot, type DocumentData, type Query, getCountFromServer, startAt, endAt } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Label } from '@/components/ui/label';

const ITEMS_PER_PAGE = 10;
interface ClientOption { id: string; name: string; }

const keralaDistricts = [ "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod", "Lakshadweep" ];
const statuses = ['Active', 'Inactive', 'OnLeave', 'Exited'];

// A custom hook for debouncing a value
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}


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
    
    // Filters state - source of truth is the URL search params
    const client = searchParams.get('client') || 'all';
    const status = searchParams.get('status') || 'all';
    const district = searchParams.get('district') || 'all';

    // State for search input, which is then debounced
    const [searchTerm, setSearchTerm] = useState(searchParams.get('searchTerm') || '');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    // Component state for data and pagination
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [clients, setClients] = useState<ClientOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    const [firstVisible, setFirstVisible] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
    const [lastVisible, setLastVisible] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [hasNextPage, setHasNextPage] = useState(false);
    const [hasPreviousPage, setHasPreviousPage] = useState(false);
    const [pageCursors, setPageCursors] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
    
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
                    if (user.email === 'admin@cisskerala.app') {
                        setUserRole('admin');
                        setAssignedDistricts([]);
                    } else {
                        const officersRef = collection(db, "fieldOfficers");
                        const q = query(officersRef, where("uid", "==", user.uid));
                        const snapshot = await getDocs(q);
                        if (!snapshot.empty) {
                            const officerData = snapshot.docs[0].data();
                            setUserRole('fieldOfficer');
                            setAssignedDistricts(officerData.assignedDistricts || []);
                        } else {
                            setUserRole('user');
                            setAssignedDistricts([]);
                        }
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
            if (value === null || value === '' || value === 'all') {
                params.delete(key);
            } else {
                params.set(key, String(value));
            }
        }
        // Remove page param for filter changes
        if(newParams.page === undefined) params.delete('page');

        router.push(`/employees?${params.toString()}`, { scroll: false });
    }, [router, searchParams]);
    
    const handleFilterChange = (filterType: string, value: string) => {
        updateUrlParams({ [filterType]: value });
    };

    const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
    };

    // Update URL when debounced search term changes for shareable filters
    useEffect(() => {
      updateUrlParams({ searchTerm });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearchTerm]);


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
    
    const buildBaseQuery = useCallback(() => {
        let q: Query = collection(db, "employees");

        if (userRole === 'fieldOfficer' && assignedDistricts.length > 0) {
            q = query(q, where('district', 'in', assignedDistricts));
        } else if (userRole === 'fieldOfficer' && assignedDistricts.length === 0) {
            return null; // Return null to indicate no query should be run
        }
        
        if (client !== 'all') {
            q = query(q, where('clientName', '==', client));
        }
        if (status !== 'all') {
            q = query(q, where('status', '==', status));
        }
        if (district !== 'all' && userRole !== 'fieldOfficer') {
            q = query(q, where('district', '==', district));
        }
        // Note: ordering and search are applied in fetchData to support multi-field search
        return q;
    }, [userRole, assignedDistricts, client, status, district]);

    const fetchData = useCallback(async (direction: 'next' | 'prev' | 'first' = 'first') => {
        setIsLoading(true);
        setError(null);
        
        const baseQuery = buildBaseQuery();
        if (!baseQuery) {
            setEmployees([]);
            setIsLoading(false);
            return;
        }

        const trimmed = debouncedSearchTerm.trim();
        const hasSearch = trimmed.length > 0;

        try {
            if (hasSearch) {
                // Multi-field search: name (prefix, case variants) + exact employeeId/phone
                const term = trimmed;
                const termCap = term.replace(/\b\w/g, (c) => c.toUpperCase());
                const termUpper = term.toUpperCase();
                const queries: Promise<any>[] = [];

                // Name prefix searches (different case variants to improve matches)
                queries.push(getDocs(query(baseQuery, orderBy('fullName'), startAt(term), endAt(term + '\uf8ff'), limit(ITEMS_PER_PAGE)) as Query));
                if (termCap !== term) {
                    queries.push(getDocs(query(baseQuery, orderBy('fullName'), startAt(termCap), endAt(termCap + '\uf8ff'), limit(ITEMS_PER_PAGE)) as Query));
                }
                if (termUpper !== term && termUpper !== termCap) {
                    queries.push(getDocs(query(baseQuery, orderBy('fullName'), startAt(termUpper), endAt(termUpper + '\uf8ff'), limit(ITEMS_PER_PAGE)) as Query));
                }

                // Exact employeeId and phoneNumber matches (no extra indexes needed)
                if (term.length >= 4) {
                    queries.push(getDocs(query(baseQuery, where('employeeId', '==', termUpper)) as Query));
                }
                const digits = term.replace(/\D/g, '');
                if (digits.length >= 6) {
                    queries.push(getDocs(query(baseQuery, where('phoneNumber', '==', digits)) as Query));
                }

                const snapshots = await Promise.all(queries);
                const seen = new Set<string>();
                const merged: Employee[] = [];
                snapshots.forEach(snap => {
                    snap.docs.forEach((d: any) => {
                        if (!seen.has(d.id)) {
                            seen.add(d.id);
                            merged.push({ id: d.id, ...(d.data() as any) } as Employee);
                        }
                    });
                });
                // Sort by createdAt desc to keep recency
                merged.sort((a: any, b: any) => {
                    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
                    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
                    return tb - ta;
                });
                setEmployees(merged.slice(0, ITEMS_PER_PAGE));
                setHasNextPage(false);
                setHasPreviousPage(false);
                setCurrentPage(1);
                setFirstVisible(null);
                setLastVisible(null);
                return;
            }

            // No search: use paginated order by createdAt desc
            let finalQuery: Query;
            let targetPage = currentPage;
            if (direction === 'next') targetPage = currentPage + 1;
            if (direction === 'prev') targetPage = Math.max(1, currentPage - 1);

            const orderedBase = query(baseQuery, orderBy('createdAt', 'desc')) as Query;
            const startAfterCursor = pageCursors[targetPage - 1] || null;
            if (startAfterCursor) {
                finalQuery = query(orderedBase, startAfter(startAfterCursor), limit(ITEMS_PER_PAGE));
            } else {
                finalQuery = query(orderedBase, limit(ITEMS_PER_PAGE));
            }

            const documentSnapshots = await getDocs(finalQuery);
            const fetchedEmployees = documentSnapshots.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Employee));
            setEmployees(fetchedEmployees);

            if (!documentSnapshots.empty) {
                const first = documentSnapshots.docs[0];
                const last = documentSnapshots.docs[documentSnapshots.docs.length - 1];
                setFirstVisible(first);
                setLastVisible(last);
                setPageCursors(prev => {
                    const next = prev.slice(0, targetPage);
                    next[targetPage - 1] = prev[targetPage - 1] ?? null;
                    next[targetPage] = last;
                    return next;
                });
                setCurrentPage(targetPage);
                setHasPreviousPage(targetPage > 1);
                setHasNextPage(documentSnapshots.size === ITEMS_PER_PAGE);

            } else {
                setEmployees([]);
                setFirstVisible(null);
                setLastVisible(null);
                setHasNextPage(false);
                setHasPreviousPage(targetPage > 1);
                setCurrentPage(targetPage);
            }
        } catch (err: any) {
            let message = err.message || "Failed to fetch employees.";
            if (err.code === 'permission-denied') message = "Permission denied. Check Firestore security rules.";
            if (err.code === 'failed-precondition') message = "A required database index is missing. Check browser console for a link to create it.";
            setError(message);
        } finally {
            setIsLoading(false);
        }
    }, [buildBaseQuery, currentPage, pageCursors, debouncedSearchTerm]);

    useEffect(() => {
        if (userRole !== null) {
            setPageCursors([null]);
            setCurrentPage(1);
            fetchData('first');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearchTerm, client, status, district, userRole]);
    
    const handleNextPage = () => {
        if (hasNextPage) {
            fetchData('next');
        }
    };
    
    const handlePrevPage = () => {
        if (currentPage > 1) {
            fetchData('prev');
        }
    };


    const handleConfirmDelete = async () => {
        if (!employeeToDelete) return;
        setIsDeleting(true);
        try {
            await deleteDoc(doc(db, "employees", employeeToDelete.id));
            toast({ title: "Employee Deleted", description: `${employeeToDelete.fullName} has been removed.` });
            fetchData('first'); // Refetch current page after delete
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
                        <Input id="search-input" type="search" placeholder="Search by Name, ID, or Phone..." value={searchTerm} onChange={handleSearchInputChange} className="pl-10" />
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
                    {/* Mobile list (shown on small screens) */}
                    <div className="block md:hidden space-y-3">
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-3 p-3 border rounded-lg">
                                    <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
                                        <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
                                    </div>
                                </div>
                            ))
                        ) : error ? (
                            <div className="text-center text-destructive py-6">{error}</div>
                        ) : employees.length === 0 ? (
                            <div className="text-center py-6">No employees found for the current filters.</div>
                        ) : (
                            employees.map((emp) => {
                                const pendingItems = getPendingDetails(emp);
                                return (
                                    <div key={emp.id} className="p-3 border rounded-lg flex items-center gap-3">
                                        <Avatar className="h-10 w-10 shrink-0">
                                            <AvatarImage src={emp.profilePictureUrl} data-ai-hint="employee avatar" />
                                            <AvatarFallback>{emp.fullName?.split(' ').map(n => n[0]).join('') || 'U'}</AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="truncate font-medium">{emp.fullName}</div>
                                                <Badge variant={getStatusBadgeVariant(emp.status)} className="shrink-0">{emp.status}</Badge>
                                            </div>
                                            <div className="text-xs text-muted-foreground truncate">{emp.clientName} • {emp.employeeId}</div>
                                            {pendingItems.length === 0 ? (
                                                <div className="mt-1 text-xs text-green-600">Complete</div>
                                            ) : (
                                                <div className="mt-1 text-xs text-amber-600">{pendingItems.length} Pending</div>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-2 items-end">
                                            <Button size="sm" onClick={() => router.push(`/employees/${emp.id}?${searchParams.toString()}`)}>View</Button>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>

                    {/* Desktop table (md and up) */}
                    <div className="hidden md:block overflow-x-auto">
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
                        <span className="text-sm text-muted-foreground">
                            Page {currentPage}
                        </span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handlePrevPage} disabled={isLoading || !hasPreviousPage}>
                                <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleNextPage} disabled={isLoading || !hasNextPage}>
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
                            <AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                               {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </div>
    );
}

    

    
