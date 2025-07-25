
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { type Employee } from '@/types/employee';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { MoreHorizontal, Search, UserPlus, Edit, Trash2, Eye, UserCheck, UserX, LogOutIcon, Loader2, AlertCircle, CheckCircle, AlertTriangle as WarningIcon, CalendarIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { db, storage } from '@/lib/firebase';
import { ref, deleteObject } from "firebase/storage";
import { collection, query, orderBy, limit, getDocs, startAfter, where, doc, updateDoc, serverTimestamp, Timestamp, endBefore, limitToLast, type QueryDocumentSnapshot, type DocumentData, deleteField, deleteDoc, type Query, writeBatch } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import { DateRange } from 'react-day-picker';
import { PopoverClose } from '@radix-ui/react-popover';

const ITEMS_PER_PAGE = 10;
interface ClientOption { id: string; name: string; }

const keralaDistricts = [ "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod" ];
const statuses = ['Active', 'Inactive', 'OnLeave', 'Exited'];

const getPendingDetails = (employee: Employee): string[] => {
    const pending: string[] = [];
    const legacy = employee as any;
    if (!employee.profilePictureUrl) pending.push("Profile Picture");
    if (!employee.signatureUrl) pending.push("Signature");
    if (!employee.identityProofUrlFront && !legacy.idProofDocumentUrlFront && !legacy.idProofDocumentUrl) pending.push("Identity Proof (Front)");
    if (!employee.identityProofUrlBack && !legacy.idProofDocumentUrlBack) pending.push("Identity Proof (Back)");
    if (!employee.addressProofUrlFront) pending.push("Address Proof (Front)");
    if (!employee.addressProofUrlBack) pending.push("Address Proof (Back)");
    if (!employee.panNumber) pending.push("PAN Number");
    if (!employee.bankAccountNumber || !employee.ifscCode || !employee.bankName) pending.push("Bank Details");
    if (!employee.epfUanNumber) pending.push("EPF/UAN Number");
    if (!employee.esicNumber) pending.push("ESIC Number");
    if (!employee.bankPassbookStatementUrl) pending.push("Bank Document");
    if (!employee.policeClearanceCertificateUrl) pending.push("Police Clearance Cert.");
    return pending;
};

export default function EmployeeDirectoryPage() {
    const { toast } = useToast();
    const router = useRouter();

    const [employees, setEmployees] = useState<Employee[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [filters, setFilters] = useState({
        searchTerm: '',
        client: 'all',
        status: 'all',
        district: 'all',
        joiningDate: undefined as DateRange | undefined,
    });
    
    const [clients, setClients] = useState<ClientOption[]>([]);
    
    const [page, setPage] = useState(1);
    const [pageCursors, setPageCursors] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
    
    const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
    const [selectedEmployeeForStatusChange, setSelectedEmployeeForStatusChange] = useState<Employee | null>(null);
    const [newStatus, setNewStatus] = useState<Employee['status'] | ''>('');
    const [exitDate, setExitDate] = useState<Date | undefined>(undefined);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const memoizedQuery = useMemo(() => {
        let q: Query = collection(db, "employees");
        if (filters.searchTerm.trim() !== '') q = query(q, where('searchableFields', 'array-contains', filters.searchTerm.trim().toUpperCase()));
        if (filters.client !== 'all') q = query(q, where('clientName', '==', filters.client));
        if (filters.status !== 'all') q = query(q, where('status', '==', filters.status));
        if (filters.district !== 'all') q = query(q, where('district', '==', filters.district));
        if (filters.joiningDate?.from) q = query(q, where('joiningDate', '>=', Timestamp.fromDate(filters.joiningDate.from)));
        if (filters.joiningDate?.to) q = query(q, where('joiningDate', '<=', Timestamp.fromDate(filters.joiningDate.to)));

        if (filters.searchTerm.trim() === '') q = query(q, orderBy('createdAt', 'desc'));
        
        return q;
    }, [filters]);

    const fetchData = useCallback(async (newPage: number) => {
        setIsLoading(true);
        setError(null);
        setPage(newPage);

        try {
            let paginatedQuery = memoizedQuery;
            const cursor = pageCursors[newPage - 1];

            if (cursor) {
                paginatedQuery = query(paginatedQuery, startAfter(cursor));
            }
            
            paginatedQuery = query(paginatedQuery, limit(ITEMS_PER_PAGE));
            const documentSnapshots = await getDocs(paginatedQuery);

            if (!documentSnapshots.empty) {
                const fetchedEmployees = documentSnapshots.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Employee));
                setEmployees(fetchedEmployees);
                const lastVisible = documentSnapshots.docs[documentSnapshots.docs.length - 1];
                if (pageCursors.length <= newPage) {
                    setPageCursors(prev => [...prev, lastVisible]);
                }
            } else {
                setEmployees([]);
                if (newPage > 1) toast({ title: "You are on the last page" });
            }
        } catch (err: any) {
            let message = err.message || "Failed to fetch employees.";
            if (err.code === 'permission-denied') message = "Permission denied. Check Firestore security rules.";
            if (err.code === 'failed-precondition') message = "A required database index is missing. Please check the browser's developer console for a link to create it.";
            setError(message);
        } finally {
            setIsLoading(false);
        }
    }, [memoizedQuery, pageCursors, toast]);

    const handleFilterChange = (key: keyof typeof filters, value: any) => {
        setFilters(prev => ({ ...prev, [key]: value }));
        // Reset pagination on filter change
        setPage(1);
        setPageCursors([null]);
    };

    useEffect(() => {
        fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [memoizedQuery]);

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

    const handleConfirmDelete = async () => {
        if (!employeeToDelete) return;
        setIsDeleting(true);
        try {
            await deleteDoc(doc(db, "employees", employeeToDelete.id));
            toast({ title: "Employee Deleted", description: `${employeeToDelete.fullName} has been removed.` });
            fetchData(1); // Refresh data
        } catch (err) {
            toast({ variant: "destructive", title: "Error", description: "Could not delete employee." });
        } finally {
            setIsDeleting(false);
            setIsDeleteDialogOpen(false);
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
          setIsStatusModalOpen(false);
        } catch (err) {
          toast({ variant: "destructive", title: "Error", description: "Could not update employee status." });
        } finally {
          setIsUpdatingStatus(false);
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
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Employee Directory</h1>
                    <p className="text-muted-foreground">Manage and view all employee profiles.</p>
                </div>
                <Button asChild><Link href="/employees/enroll"><UserPlus className="mr-2 h-4 w-4" /> Enroll New</Link></Button>
            </div>

            <Card>
                <CardHeader><CardTitle>Filters & Search</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                    <div className="xl:col-span-2">
                        <Label htmlFor="search-input">Search by Name/ID/Phone</Label>
                        <Input id="search-input" type="search" placeholder="Search..." value={filters.searchTerm} onChange={(e) => handleFilterChange('searchTerm', e.target.value)} />
                    </div>
                    <div>
                        <Label htmlFor="client-filter">Client</Label>
                        <Select value={filters.client} onValueChange={(val) => handleFilterChange('client', val)}><SelectTrigger id="client-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Clients</SelectItem>{clients.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent></Select>
                    </div>
                     <div>
                        <Label htmlFor="district-filter">District</Label>
                        <Select value={filters.district} onValueChange={(val) => handleFilterChange('district', val)}><SelectTrigger id="district-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Districts</SelectItem>{keralaDistricts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select>
                    </div>
                    <div>
                        <Label htmlFor="status-filter">Status</Label>
                        <Select value={filters.status} onValueChange={(val) => handleFilterChange('status', val)}><SelectTrigger id="status-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Statuses</SelectItem>{statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>Employee List</CardTitle></CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex justify-center items-center h-64"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>
                    ) : error ? (
                        <div className="text-center py-10"><AlertCircle className="mx-auto h-12 w-12 text-destructive" /><p className="mt-4 text-lg text-destructive">{error}</p><Button onClick={() => fetchData(1)} className="mt-4">Try Again</Button></div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead className="hidden md:table-cell">Employee ID</TableHead><TableHead>Status</TableHead><TableHead>Profile Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {employees.length === 0 ? (<TableRow><TableCell colSpan={5} className="text-center h-24">No employees found.</TableCell></TableRow>) : (
                                        employees.map((emp) => {
                                            const pendingItems = getPendingDetails(emp);
                                            return (
                                                <TableRow key={emp.id}><TableCell><div className="flex items-center gap-3"><Avatar><AvatarImage src={emp.profilePictureUrl} /><AvatarFallback>{emp.fullName?.split(' ').map(n => n[0]).join('') || 'U'}</AvatarFallback></Avatar><div><div className="font-medium">{emp.fullName}</div><div className="text-sm text-muted-foreground">{emp.clientName}</div></div></div></TableCell><TableCell className="hidden md:table-cell">{emp.employeeId}</TableCell><TableCell><Badge variant={getStatusBadgeVariant(emp.status)}>{emp.status}</Badge></TableCell><TableCell>
                                                    {pendingItems.length === 0 ? (<div className="flex items-center gap-2 text-green-600"><CheckCircle className="h-5 w-5" /> <span className="hidden lg:inline">Complete</span></div>) : (
                                                        <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className="flex items-center gap-2 text-amber-600"><WarningIcon className="h-5 w-5" /> <span className="hidden lg:inline">{pendingItems.length} Pending</span></Button></PopoverTrigger><PopoverContent className="w-64"><div className="space-y-2"><h4 className="font-medium">Pending Items</h4><ul className="list-disc list-inside text-sm space-y-1">{pendingItems.slice(0, 5).map(item => <li key={item}>{item}</li>)}{pendingItems.length > 5 && <li className='font-medium'>...and {pendingItems.length - 5} more.</li>}</ul></div></PopoverContent></Popover>
                                                    )}
                                                </TableCell><TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><Link href={`/employees/${emp.id}`}><Eye className="mr-2 h-4 w-4" /> View</Link></DropdownMenuItem><DropdownMenuItem asChild><Link href={`/employees/${emp.id}?edit=true`}><Edit className="mr-2 h-4 w-4" /> Edit</Link></DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => { setSelectedEmployeeForStatusChange(emp); setNewStatus('Active'); setIsStatusModalOpen(true); }}>Set Active</DropdownMenuItem><DropdownMenuItem onClick={() => { setSelectedEmployeeForStatusChange(emp); setNewStatus('Exited'); setIsStatusModalOpen(true); }}>Set Exited</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onClick={() => { setEmployeeToDelete(emp); setIsDeleteDialogOpen(true); }}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow>
                                            )
                                        })
                                    )}
                                </TableBody></Table>
                        </div>
                    )}
                </CardContent>
                <CardFooter><div className="flex justify-between items-center w-full"><span className="text-sm text-muted-foreground">Page {page}</span><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => fetchData(page - 1)} disabled={isLoading || page === 1}>Previous</Button><Button variant="outline" size="sm" onClick={() => fetchData(page + 1)} disabled={isLoading || employees.length < ITEMS_PER_PAGE}>Next</Button></div></div></CardFooter>
            </Card>

            {selectedEmployeeForStatusChange && (
                <AlertDialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Update Status for {selectedEmployeeForStatusChange.fullName}</AlertDialogTitle><AlertDialogDescription><span>Changing status to <Badge variant={getStatusBadgeVariant(newStatus as Employee['status'])}>{newStatus}</Badge>. {newStatus === 'Exited' && " Please provide the exit date."}</span></AlertDialogDescription></AlertDialogHeader>{newStatus === 'Exited' && (<div className="grid gap-2 py-2"><Label htmlFor="exitDate">Date of Exit</Label><Popover><PopoverTrigger asChild><Button id="exitDate" variant={"outline"}><CalendarIcon className="mr-2 h-4 w-4" />{exitDate ? format(exitDate, "dd-MM-yyyy") : <span>Pick a date</span>}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={exitDate} onSelect={setExitDate} disabled={(date) => date > new Date()} initialFocus /></PopoverContent></Popover></div>)}<AlertDialogFooter><AlertDialogCancel disabled={isUpdatingStatus}>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleConfirmStatusUpdate} disabled={isUpdatingStatus || (newStatus === 'Exited' && !exitDate)}>{isUpdatingStatus && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
            )}

            {employeeToDelete && (
                <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm Deletion</AlertDialogTitle><AlertDialogDescription>Are you sure you want to delete {employeeToDelete.fullName}? This action cannot be undone and all associated files will be removed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
            )}
        </div>
    );
}

    