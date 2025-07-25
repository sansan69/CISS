
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { type Employee } from '@/types/employee';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { MoreHorizontal, Search, Filter, UserPlus, Edit, Trash2, Eye, UserCheck, UserX, LogOutIcon, CalendarDays, Loader2, AlertCircle, DatabaseZap, ScanSearch, CheckCircle, AlertTriangle as WarningIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { db, storage } from '@/lib/firebase';
import { ref, deleteObject } from "firebase/storage";
import { collection, query, orderBy, limit, getDocs, startAfter, where, doc, updateDoc, serverTimestamp, Timestamp, endBefore, limitToLast, type QueryDocumentSnapshot, type DocumentData, deleteField, deleteDoc, type Query, writeBatch } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription as ShadDialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import { Progress } from '@/components/ui/progress';

const ITEMS_PER_PAGE = 10;

interface ClientOption {
  id: string;
  name: string;
}

const keralaDistricts = [
  'all', "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha",
  "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad",
  "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod"
];

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
    if (!employee.bankAccountNumber) pending.push("Bank Account Number");
    if (!employee.ifscCode) pending.push("IFSC Code");
    if (!employee.bankName) pending.push("Bank Name");
    if (!employee.epfUanNumber) pending.push("EPF/UAN Number");
    if (!employee.esicNumber) pending.push("ESIC Number");
    if (!employee.bankPassbookStatementUrl) pending.push("Bank Document");
    if (!employee.policeClearanceCertificateUrl) pending.push("Police Clearance Cert.");

    return pending;
};

const safeFormatDate = (dateValue: any, formatString: string) => {
    if (!dateValue) return 'N/A';
    try {
        const date = dateValue.toDate ? dateValue.toDate() : new Date(dateValue);
        if (isNaN(date.getTime())) {
            return "Invalid Date";
        }
        return format(date, formatString);
    } catch (e) {
        console.error("Date formatting error:", e);
        return "Invalid Date";
    }
};

export default function EmployeeDirectoryPage() {
  const { toast } = useToast();
  const router = useRouter();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterClient, setFilterClient] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDistrict, setFilterDistrict] = useState('all');

  const [clients, setClients] = useState<ClientOption[]>([]);
  const statuses = ['all', 'Active', 'Inactive', 'OnLeave', 'Exited'];

  const [page, setPage] = useState(1);
  const [firstDocs, setFirstDocs] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);


  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);

  const [isScanningDuplicates, setIsScanningDuplicates] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<Record<string, Employee[]>>({});
  const [showDuplicatesDialog, setShowDuplicatesDialog] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState<string[]>([]);
  const [isDeletingDuplicates, setIsDeletingDuplicates] = useState(false);

  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [selectedEmployeeForStatusChange, setSelectedEmployeeForStatusChange] = useState<Employee | null>(null);
  const [newStatus, setNewStatus] = useState<Employee['status'] | ''>('');
  const [exitDate, setExitDate] = useState<Date | undefined>(undefined);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);


  const buildQuery = useCallback(() => {
    let q: Query = collection(db, "employees");

    if (searchTerm.trim() !== '') {
        q = query(q, where('searchableFields', 'array-contains', searchTerm.trim().toUpperCase()));
    }

    if (filterClient !== 'all') q = query(q, where('clientName', '==', filterClient));
    if (filterStatus !== 'all') q = query(q, where('status', '==', filterStatus));
    if (filterDistrict !== 'all') q = query(q, where('district', '==', filterDistrict));

    if (searchTerm.trim() === '') {
       q = query(q, orderBy('createdAt', 'desc'));
    }

    return q;
  }, [filterClient, filterStatus, filterDistrict, searchTerm]);


  const fetchData = useCallback(async (direction: 'next' | 'prev' | 'reset' = 'reset') => {
    setIsLoading(true);
    setError(null);

    try {
        let q = buildQuery();
        let newPage = page;
        
        if (direction === 'next') {
            newPage = page + 1;
            q = query(q, startAfter(lastDoc), limit(ITEMS_PER_PAGE));
        } else if (direction === 'prev' && page > 1) {
            newPage = page - 1;
            const prevPageFirstDoc = firstDocs[newPage -1];
            q = query(q, startAfter(prevPageFirstDoc), limit(ITEMS_PER_PAGE));
        } else { // reset
            newPage = 1;
            setFirstDocs([null]);
            q = query(q, limit(ITEMS_PER_PAGE));
        }
        
        const documentSnapshots = await getDocs(q);

        if (!documentSnapshots.empty) {
            const fetchedEmployees = documentSnapshots.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Employee));
            setEmployees(fetchedEmployees);
            
            const newFirstDoc = documentSnapshots.docs[0];
            const newLastDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1];

            setLastDoc(newLastDoc);
            
            if (direction === 'next') {
                setFirstDocs(prev => [...prev, newFirstDoc]);
            }
        } else {
             if (direction === 'next') {
                toast({ title: "You are on the last page" });
                newPage = page; // don't increment page if no results
            } else if (direction === 'reset') {
                setEmployees([]);
                toast({ title: "No employees found matching your criteria." });
            }
        }
        setPage(newPage);

    } catch (err: any) {
        let message = err.message || "Failed to fetch employees.";
        if (err.code === 'permission-denied') message = "Permission denied. Check Firestore security rules.";
        if (err.code === 'failed-precondition') message = "A required database index is missing. Please check the browser's developer console for a link to create the required index in Firebase.";
        setError(message);
        toast({ variant: "destructive", title: "Data Fetch Error", description: message, duration: 9000 });
    } finally {
        setIsLoading(false);
    }
  }, [buildQuery, page, lastDoc, firstDocs, toast]);


  const handleFilterOrSearch = () => {
      setPage(1);
      setLastDoc(null);
      setFirstDocs([null]);
      fetchData('reset');
  }

  useEffect(() => {
    const handler = setTimeout(() => {
        handleFilterOrSearch();
    }, 500);
    return () => clearTimeout(handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, filterClient, filterStatus, filterDistrict]);


  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        const clientsSnapshot = await getDocs(query(collection(db, 'clients'), orderBy('name')));
        setClients([{ id: 'all', name: 'All Clients' }, ...clientsSnapshot.docs.map(docSnap => ({ id: docSnap.id, name: docSnap.data().name as string }))]);
      } catch (err: any) {
        toast({ variant: "destructive", title: "Error", description: "Could not fetch client list." });
      }
      setIsLoading(false);
    };
    fetchInitialData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openStatusModal = (employee: Employee, status: Employee['status']) => {
    setSelectedEmployeeForStatusChange(employee);
    setNewStatus(status);
    if (status === 'Exited') setExitDate(employee.exitDate ? new Date(employee.exitDate) : new Date());
    else setExitDate(undefined);
    setIsStatusModalOpen(true);
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

  const openDeleteDialog = (employee: Employee) => {
    setEmployeeToDelete(employee);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!employeeToDelete) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, "employees", employeeToDelete.id));
      const filesToDelete = [
        employeeToDelete.profilePictureUrl, employeeToDelete.identityProofUrlFront,
        employeeToDelete.identityProofUrlBack, employeeToDelete.addressProofUrlFront,
        employeeToDelete.addressProofUrlBack, employeeToDelete.signatureUrl,
        employeeToDelete.bankPassbookStatementUrl, employeeToDelete.policeClearanceCertificateUrl,
      ];
      for (const fileUrl of filesToDelete) {
        if (fileUrl && fileUrl.startsWith("https://firebasestorage.googleapis.com/")) {
          try {
            await deleteObject(ref(storage, fileUrl));
          } catch (fileError: any) {
            console.warn(`Failed to delete file ${fileUrl}:`, fileError.message);
          }
        }
      }
      toast({ title: "Employee Deleted", description: `${employeeToDelete.fullName} has been removed.` });
      handleFilterOrSearch();
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "Could not delete employee." });
    } finally {
      setIsDeleting(false);
      setIsDeleteDialogOpen(false);
    }
  };

  const runBatchUpdate = async (title: string, queryToRun: Query<DocumentData>, updateLogic: (docData: Employee) => Record<string, any>) => {
    setIsUpdating(true);
    setUpdateProgress(0);
    toast({ title: `Starting: ${title}`, description: "Fetching all relevant records..." });
    try {
        const snapshot = await getDocs(queryToRun);
        const totalDocs = snapshot.size;
        if (totalDocs === 0) {
            toast({ title: "No Records to Update" });
            return;
        }
        const BATCH_SIZE = 400;
        for (let i = 0; i < totalDocs; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = snapshot.docs.slice(i, i + BATCH_SIZE);
            for (const docSnapshot of chunk) {
                const updates = updateLogic({id: docSnapshot.id, ...docSnapshot.data()} as Employee);
                if (Object.keys(updates).length > 0) batch.update(docSnapshot.ref, updates);
            }
            await batch.commit();
            setUpdateProgress(((i + chunk.length) / totalDocs) * 100);
        }
        toast({ title: "Update Complete!", description: `Successfully updated ${totalDocs} records.` });
        handleFilterOrSearch();
    } catch (error) {
        toast({ variant: "destructive", title: "Update Failed", description: `An error occurred during the update.` });
    } finally {
        setIsUpdating(false);
    }
  };

  const handleUpdateSearchFields = () => runBatchUpdate("Search Fields", collection(db, "employees"), emp => ({
      searchableFields: Array.from(new Set([
          ...(emp.fullName || '').toUpperCase().split(' ').filter(Boolean),
          (emp.firstName || '').toUpperCase(), (emp.lastName || '').toUpperCase(),
          (emp.employeeId || '').toUpperCase(), emp.phoneNumber
      ].filter(Boolean)))
  }));

  const handleMigrateIdProofs = () => runBatchUpdate("ID Proof Migration", query(collection(db, "employees"), where("idProofType", "!=", null)), emp => {
      if (emp.identityProofType) return {};
      return {
          identityProofType: emp.idProofType, identityProofNumber: emp.idProofNumber,
          identityProofUrlFront: emp.idProofDocumentUrlFront || emp.idProofDocumentUrl,
          identityProofUrlBack: emp.idProofDocumentUrlBack,
          idProofType: deleteField(), idProofNumber: deleteField(),
          idProofDocumentUrl: deleteField(), idProofDocumentUrlFront: deleteField(), idProofDocumentUrlBack: deleteField(),
      };
  });

  const handleScanForDuplicates = async () => {
    setIsScanningDuplicates(true);
    toast({ title: "Scanning for duplicates..." });
    try {
      const snapshot = await getDocs(collection(db, "employees"));
      const allEmployees = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Employee));
      const duplicates: Record<string, Employee[]> = {};
      allEmployees.forEach(emp => {
        if (emp.phoneNumber) {
          if (!duplicates[emp.phoneNumber]) duplicates[emp.phoneNumber] = [];
          duplicates[emp.phoneNumber].push(emp);
        }
      });
      const finalGroups = Object.fromEntries(Object.entries(duplicates).filter(([_, group]) => group.length > 1));
      setDuplicateGroups(finalGroups);
      if (Object.keys(finalGroups).length > 0) setShowDuplicatesDialog(true);
      else toast({ title: "No Duplicates Found" });
    } catch (error) {
      toast({ variant: "destructive", title: "Scan Failed" });
    } finally {
      setIsScanningDuplicates(false);
    }
  };

  const handleDeleteSelectedDuplicates = async () => {
    if (selectedForDeletion.length === 0) return;
    setIsDeletingDuplicates(true);
    const batch = writeBatch(db);
    selectedForDeletion.forEach(id => batch.delete(doc(db, "employees", id)));
    try {
      await batch.commit();
      toast({ title: "Duplicates Deleted", description: `${selectedForDeletion.length} record(s) removed.` });
      setShowDuplicatesDialog(false);
      setSelectedForDeletion([]);
      handleFilterOrSearch();
    } catch (error) {
      toast({ variant: "destructive", title: "Deletion Failed" });
    } finally {
      setIsDeletingDuplicates(false);
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
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Employee Directory</h1>
        <div className="flex items-center gap-2">
            <Button asChild>
                <Link href="/employees/enroll">
                    <UserPlus className="mr-2 h-4 w-4" /> Enroll New
                </Link>
            </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
            <CardTitle>Filters &amp; Search</CardTitle>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
              <div className="sm:col-span-2 lg:col-span-1">
                  <Label htmlFor="search-input">Search by Name/ID/Phone</Label>
                  <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input id="search-input" type="search" placeholder="Search..." className="pl-8 w-full" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                  </div>
              </div>
              <div>
                <Label htmlFor="client-filter">Client</Label>
                <Select value={filterClient} onValueChange={setFilterClient}>
                    <SelectTrigger id="client-filter"><Filter className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
                    <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.name === 'All Clients' ? 'all' : c.name}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="district-filter">District</Label>
                <Select value={filterDistrict} onValueChange={setFilterDistrict}>
                    <SelectTrigger id="district-filter"><Filter className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
                    <SelectContent>{keralaDistricts.map(d => <SelectItem key={d} value={d}>{d === 'all' ? 'All Districts' : d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="status-filter">Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger id="status-filter"><Filter className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
                    <SelectContent>{statuses.map(s => <SelectItem key={s} value={s}>{s === 'all' ? 'All Statuses' : s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle>Employee List</CardTitle>
        </CardHeader>
        <CardContent>
            {isLoading && employees.length === 0 ? (
                <div className="flex justify-center items-center h-64"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>
            ) : error ? (
                <div className="text-center py-10">
                    <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
                    <p className="mt-4 text-lg text-destructive">{error}</p>
                    <Button onClick={() => handleFilterOrSearch()} className="mt-4">Try Again</Button>
                </div>
            ) : (
                <>
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead className="hidden md:table-cell">Employee ID</TableHead><TableHead>Status</TableHead><TableHead>Profile Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                        {employees.length === 0 ? (
                            <TableRow><TableCell colSpan={5} className="text-center h-24">No employees found matching your criteria.</TableCell></TableRow>
                        ) : (
                            employees.map((emp) => {
                            const pendingItems = getPendingDetails(emp);
                            return (
                                <TableRow key={emp.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                        <Avatar><AvatarImage src={emp.profilePictureUrl} /><AvatarFallback>{emp.fullName?.split(' ').map(n => n[0]).join('') || 'U'}</AvatarFallback></Avatar>
                                        <div><div className="font-medium">{emp.fullName}</div><div className="text-sm text-muted-foreground">{emp.clientName}</div></div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell">{emp.employeeId}</TableCell>
                                    <TableCell><Badge variant={getStatusBadgeVariant(emp.status)}>{emp.status}</Badge></TableCell>
                                    <TableCell>
                                        {pendingItems.length === 0 ? (
                                            <div className="flex items-center gap-2 text-green-600"><CheckCircle className="h-5 w-5" /> <span className="hidden lg:inline">Complete</span></div>
                                        ) : (
                                            <Popover>
                                                <PopoverTrigger asChild><Button variant="ghost" size="sm" className="flex items-center gap-2 text-amber-600"><WarningIcon className="h-5 w-5" /> <span className="hidden lg:inline">{pendingItems.length} Pending</span></Button></PopoverTrigger>
                                                <PopoverContent className="w-64"><div className="space-y-2"><h4 className="font-medium">Pending Items</h4><ul className="list-disc list-inside text-sm space-y-1">{pendingItems.map(item => <li key={item}>{item}</li>)}</ul></div></PopoverContent>
                                            </Popover>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem asChild><Link href={`/employees/${emp.id}`}><Eye className="mr-2 h-4 w-4" /> View Profile</Link></DropdownMenuItem>
                                            <DropdownMenuItem asChild><Link href={`/employees/${emp.id}?edit=true`}><Edit className="mr-2 h-4 w-4" /> Edit</Link></DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            {emp.status !== 'Active' && <DropdownMenuItem onClick={() => openStatusModal(emp, 'Active')}><UserCheck className="mr-2 h-4 w-4" /> Set Active</DropdownMenuItem>}
                                            {emp.status !== 'Inactive' && emp.status !== 'Exited' && <DropdownMenuItem onClick={() => openStatusModal(emp, 'Inactive')}><UserX className="mr-2 h-4 w-4" /> Set Inactive</DropdownMenuItem>}
                                            {emp.status !== 'Exited' && <DropdownMenuItem onClick={() => openStatusModal(emp, 'Exited')}><LogOutIcon className="mr-2 h-4 w-4" /> Set Exited</DropdownMenuItem>}
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem className="text-destructive" onClick={() => openDeleteDialog(emp)}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                                        </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            )
                            })}
                        </TableBody>
                    </Table>
                </div>
                <div className="flex justify-between items-center mt-4">
                    <span className="text-sm text-muted-foreground">Page {page}</span>
                    <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => fetchData('prev')} disabled={isLoading || page === 1}>Previous</Button>
                    <Button variant="outline" size="sm" onClick={() => fetchData('next')} disabled={isLoading}>Next</Button>
                    </div>
                </div>
                </>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle>Data Maintenance</CardTitle>
            <CardDescription>Use these tools to update existing records for new features.</CardDescription>
        </CardHeader>
        <CardContent>
            {isUpdating && <div className="flex flex-col gap-2"><p>Updating records...</p><Progress value={updateProgress} /></div>}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-4">
             <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="secondary" disabled={isUpdating || isScanningDuplicates}><DatabaseZap className="mr-2 h-4 w-4" />Update Search Fields</Button></AlertDialogTrigger>
                <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm Search Update</AlertDialogTitle><AlertDialogDescription>This will process all employee records to update search fields. This is safe but may incur costs.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleUpdateSearchFields}>Confirm</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="secondary" disabled={isUpdating || isScanningDuplicates}><DatabaseZap className="mr-2 h-4 w-4" />Migrate Old ID Proofs</Button></AlertDialogTrigger>
                <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm ID Proof Migration</AlertDialogTitle><AlertDialogDescription>This will migrate old ID proof fields to the new format for all records. This is a one-time operation.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleMigrateIdProofs}>Confirm</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
            </AlertDialog>
             <Button variant="destructive" onClick={handleScanForDuplicates} disabled={isUpdating || isScanningDuplicates}>{isScanningDuplicates ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />}Scan for Duplicates</Button>
        </CardFooter>
      </Card>

      {selectedEmployeeForStatusChange && (
        <AlertDialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
            <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Update Status for {selectedEmployeeForStatusChange.fullName}</AlertDialogTitle><AlertDialogDescription><span>Changing status to <Badge variant={getStatusBadgeVariant(newStatus as Employee['status'])}>{newStatus}</Badge>. {newStatus === 'Exited' && " Please provide the exit date."}</span></AlertDialogDescription></AlertDialogHeader>
                {newStatus === 'Exited' && (<div className="grid gap-2 py-2"><Label htmlFor="exitDate">Date of Exit</Label><Popover><PopoverTrigger asChild><Button id="exitDate" variant={"outline"}><CalendarDays className="mr-2 h-4 w-4" />{exitDate ? format(exitDate, "dd-MM-yyyy") : <span>Pick a date</span>}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={exitDate} onSelect={setExitDate} disabled={(date) => date > new Date()} initialFocus /></PopoverContent></Popover></div>)}
                <AlertDialogFooter><AlertDialogCancel disabled={isUpdatingStatus}>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleConfirmStatusUpdate} disabled={isUpdatingStatus || (newStatus === 'Exited' && !exitDate)}>{isUpdatingStatus && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
      )}

      {employeeToDelete && (
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm Deletion</AlertDialogTitle><AlertDialogDescription>Are you sure you want to delete {employeeToDelete.fullName}? This action cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={isDeleting} onClick={() => setEmployeeToDelete(null)}>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting} className={buttonVariants({ variant: "destructive" })}>{isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog>
      )}

      <Dialog open={showDuplicatesDialog} onOpenChange={setShowDuplicatesDialog}>
        <DialogContent className="max-w-4xl">
            <DialogHeader><DialogTitle>Duplicate Records Found</DialogTitle><ShadDialogDescription>The following employees appear to be duplicates. Select records to delete.</ShadDialogDescription></DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto p-4 space-y-6">
                {Object.entries(duplicateGroups).map(([key, group]) => (
                    <div key={key} className="p-4 border rounded-lg"><h3 className="font-semibold mb-2 border-b pb-2">Duplicate on: <span className="font-mono">{key}</span></h3><div className="space-y-2">
                        {group.map(emp => (<div key={emp.id} className="flex items-center gap-4 p-2 rounded-md"><Checkbox id={`del-${emp.id}`} checked={selectedForDeletion.includes(emp.id)} onCheckedChange={() => setSelectedForDeletion(p => p.includes(emp.id) ? p.filter(i => i !== emp.id) : [...p, emp.id])} /><Label htmlFor={`del-${emp.id}`} className="flex-1"><div className="flex items-center gap-3"><Avatar><AvatarImage src={emp.profilePictureUrl} /><AvatarFallback>{emp.fullName?.[0]}</AvatarFallback></Avatar><div><p className="font-medium">{emp.fullName} ({emp.employeeId})</p><p className="text-xs text-muted-foreground">{emp.clientName} | Created: {safeFormatDate(emp.createdAt, 'dd MMM yyyy')}</p></div></div></Label></div>))}
                    </div></div>
                ))}
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setShowDuplicatesDialog(false)}>Cancel</Button><Button variant="destructive" onClick={handleDeleteSelectedDuplicates} disabled={isDeletingDuplicates || selectedForDeletion.length === 0}>{isDeletingDuplicates ? <Loader2 className="mr-2" /> : <Trash2 className="mr-2" />}Delete Selected ({selectedForDeletion.length})</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
