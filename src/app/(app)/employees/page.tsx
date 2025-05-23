
"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Employee } from '@/types/employee';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MoreHorizontal, Search, Filter, UserPlus, Edit, Trash2, Eye, UserCheck, UserX, LogOutIcon, CalendarDays, Loader2, AlertCircle } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, limit, getDocs, startAfter, where, doc, updateDoc, serverTimestamp, Timestamp, getCountFromServer, endBefore, limitToLast, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Label } from '@/components/ui/label';

const ITEMS_PER_PAGE = 10;

interface ClientOption {
  id: string;
  name: string;
}

export default function EmployeeDirectoryPage() {
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterClient, setFilterClient] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [statuses, setStatuses] = useState(['all', 'Active', 'Inactive', 'OnLeave', 'Exited']);

  const [currentPage, setCurrentPage] = useState(1);
  const [lastVisibleDoc, setLastVisibleDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [firstVisibleDoc, setFirstVisibleDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [isFetchingNext, setIsFetchingNext] = useState(false);
  const [isFetchingPrev, setIsFetchingPrev] = useState(false);
  const [hasMoreNext, setHasMoreNext] = useState(true);
  const [hasMorePrev, setHasMorePrev] = useState(false);

  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [selectedEmployeeForStatusChange, setSelectedEmployeeForStatusChange] = useState<Employee | null>(null);
  const [newStatus, setNewStatus] = useState<Employee['status'] | ''>('');
  const [exitDate, setExitDate] = useState<Date | undefined>(undefined);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);


  const fetchClients = useCallback(async () => {
    try {
      const clientsSnapshot = await getDocs(query(collection(db, 'clients'), orderBy('name')));
      const fetchedClients = clientsSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name as string }));
      setClients([{ id: 'all', name: 'All Clients' }, ...fetchedClients]);
    } catch (err) {
      console.error("Error fetching clients:", err);
      toast({ variant: "destructive", title: "Error", description: "Could not fetch client list." });
    }
  }, [toast]);

  const buildQuery = useCallback((direction?: 'next' | 'prev') => {
    let q = query(collection(db, 'employees'));

    // Filtering
    if (filterClient !== 'all') {
      q = query(q, where('clientName', '==', filterClient));
    }
    if (filterStatus !== 'all') {
      q = query(q, where('status', '==', filterStatus));
    }
    
    // Searching (Basic - can be improved with full-text search or search array field)
    // Firestore SDK does not support direct OR queries on different fields easily or case-insensitive partial search efficiently without specific data structuring.
    // This search is limited. For robust search, consider a dedicated search service or denormalizing searchable fields.
    if (searchTerm.trim() !== '') {
      // This example will only search by exact employeeId or fullName if structured for it.
      // A common workaround is to store a `keywords` array in each document.
      // For simplicity here, we'll filter client-side after a broader fetch if search is active, or limit search.
      // Let's try searching by employeeId for now as an example.
      q = query(q, where('employeeId', '>=', searchTerm.trim()), where('employeeId', '<=', searchTerm.trim() + '\uf8ff'));
      // To search by fullName, you'd need a similar range query on a `fullName` field.
      // Or, if you want to match anywhere in the name, it's harder.
      // q = query(q, where('fullName', '>=', searchTerm.trim()), where('fullName', '<=', searchTerm.trim() + '\uf8ff'));
    }
    
    // Ordering (Important for consistent pagination)
    q = query(q, orderBy('createdAt', 'desc')); // Primary sort key

    // Pagination
    if (direction === 'next' && lastVisibleDoc) {
      q = query(q, startAfter(lastVisibleDoc), limit(ITEMS_PER_PAGE));
    } else if (direction === 'prev' && firstVisibleDoc) {
      q = query(q, endBefore(firstVisibleDoc), limitToLast(ITEMS_PER_PAGE));
    } else {
      q = query(q, limit(ITEMS_PER_PAGE));
    }
    return q;
  }, [filterClient, filterStatus, searchTerm, lastVisibleDoc, firstVisibleDoc]);


  const fetchEmployees = useCallback(async (direction?: 'next' | 'prev') => {
    if (direction === 'next') setIsFetchingNext(true);
    else if (direction === 'prev') setIsFetchingPrev(true);
    else setIsLoading(true);
    
    setError(null);

    try {
      const q = buildQuery(direction);
      const documentSnapshots = await getDocs(q);
      
      const fetchedEmployees = documentSnapshots.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // Ensure date fields are handled (e.g. convert Timestamps if needed for display)
        joiningDate: (doc.data().joiningDate as Timestamp)?.toDate ? (doc.data().joiningDate as Timestamp).toDate().toISOString() : doc.data().joiningDate,
        dateOfBirth: (doc.data().dateOfBirth as Timestamp)?.toDate ? (doc.data().dateOfBirth as Timestamp).toDate().toISOString() : doc.data().dateOfBirth,
        exitDate: (doc.data().exitDate as Timestamp)?.toDate ? (doc.data().exitDate as Timestamp).toDate().toISOString() : doc.data().exitDate,
        createdAt: (doc.data().createdAt as Timestamp)?.toDate ? (doc.data().createdAt as Timestamp).toDate().toISOString() : doc.data().createdAt,
        updatedAt: (doc.data().updatedAt as Timestamp)?.toDate ? (doc.data().updatedAt as Timestamp).toDate().toISOString() : doc.data().updatedAt,
      } as Employee));

      setEmployees(fetchedEmployees);
      
      if (documentSnapshots.docs.length > 0) {
        if (direction !== 'prev') setFirstVisibleDoc(documentSnapshots.docs[0]);
        if (direction !== 'next') setLastVisibleDoc(documentSnapshots.docs[documentSnapshots.docs.length - 1]);
      }

      setHasMoreNext(fetchedEmployees.length === ITEMS_PER_PAGE);
      // setHasMorePrev logic would need to know if we are on page > 1
      setHasMorePrev(currentPage > 1);


    } catch (err: any) {
      console.error("Error fetching employees:", err);
      setError(err.message || "Failed to fetch employees.");
      toast({ variant: "destructive", title: "Error", description: "Could not fetch employees." });
    } finally {
      setIsLoading(false);
      setIsFetchingNext(false);
      setIsFetchingPrev(false);
    }
  }, [toast, buildQuery, currentPage]);

  useEffect(() => {
    fetchClients();
    fetchEmployees();
  }, [fetchClients, fetchEmployees]); // Initial fetch

 useEffect(() => {
    // Debounced fetch or direct fetch on filter/search change
    // For simplicity, direct fetch. Consider debounce for search term.
    setCurrentPage(1); // Reset to first page on filter change
    setLastVisibleDoc(null);
    setFirstVisibleDoc(null);
    fetchEmployees();
  }, [searchTerm, filterClient, filterStatus]); // Removed fetchEmployees from here to avoid loop, it's called inside itself now.

  const handleNextPage = () => {
    if (hasMoreNext) {
      setCurrentPage(prev => prev + 1);
      fetchEmployees('next');
    }
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(prev => prev - 1);
      fetchEmployees('prev'); // This might need a more complex cursor logic for true "previous"
    }
  };


  const getStatusBadgeVariant = (status: Employee['status']) => {
    switch (status) {
      case 'Active': return 'default';
      case 'Inactive': return 'secondary';
      case 'OnLeave': return 'outline'; // Consider a different color
      case 'Exited': return 'destructive';
      default: return 'outline';
    }
  };

  const openStatusModal = (employee: Employee, status: Employee['status']) => {
    setSelectedEmployeeForStatusChange(employee);
    setNewStatus(status);
    if (status === 'Exited') {
      setExitDate(employee.exitDate ? new Date(employee.exitDate) : new Date()); // Default to today or existing
    } else {
      setExitDate(undefined);
    }
    setIsStatusModalOpen(true);
  };

  const handleConfirmStatusUpdate = async () => {
    if (!selectedEmployeeForStatusChange || !newStatus) return;

    setIsUpdatingStatus(true);
    try {
      const employeeDocRef = doc(db, "employees", selectedEmployeeForStatusChange.id);
      const updateData: any = {
        status: newStatus,
        updatedAt: serverTimestamp(),
      };

      if (newStatus === 'Exited') {
        if (!exitDate) {
          toast({ variant: "destructive", title: "Error", description: "Exit date is required for 'Exited' status." });
          setIsUpdatingStatus(false);
          return;
        }
        updateData.exitDate = Timestamp.fromDate(exitDate);
      } else {
        // If changing status from Exited to something else, or just updating to Active/Inactive, clear exitDate
        updateData.exitDate = null; // Or use deleteField() if you prefer to remove it
      }

      await updateDoc(employeeDocRef, updateData);
      toast({ title: "Status Updated", description: `${selectedEmployeeForStatusChange.fullName}'s status updated to ${newStatus}.` });
      
      // Refresh employees list
      fetchEmployees(); // This will fetch the current page again
      setIsStatusModalOpen(false);
      setSelectedEmployeeForStatusChange(null);
      setNewStatus('');
      setExitDate(undefined);

    } catch (err) {
      console.error("Error updating status:", err);
      toast({ variant: "destructive", title: "Error", description: "Could not update employee status." });
    } finally {
      setIsUpdatingStatus(false);
    }
  };
  

  if (isLoading && employees.length === 0) { // Show full page loader only on initial load
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-200px)]">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-lg text-muted-foreground">Loading employees...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10">
        <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
        <p className="mt-4 text-lg text-destructive">{error}</p>
        <Button onClick={() => fetchEmployees()} className="mt-4">Try Again</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Employee Directory</h1>
        <Link href="/enroll" passHref>
          <Button>
            <UserPlus className="mr-2 h-4 w-4" /> Enroll New Employee
          </Button>
        </Link>
      </div>

      <div className="p-4 bg-card rounded-lg shadow">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by Employee ID..."
              className="pl-8 w-full"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={filterClient} onValueChange={setFilterClient}>
            <SelectTrigger>
              <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
              <SelectValue placeholder="Filter by Client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map(client => (
                <SelectItem key={client.id} value={client.name === 'All Clients' ? 'all' : client.name}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger>
               <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
              <SelectValue placeholder="Filter by Status" />
            </SelectTrigger>
            <SelectContent>
              {statuses.map(status => (
                <SelectItem key={status} value={status}>{status === 'all' ? 'All Statuses' : status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Employee ID</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && employees.length > 0 && ( // Show loader for table updates
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && employees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24">
                    No employees found.
                  </TableCell>
                </TableRow>
              ) : (
                employees.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={emp.profilePictureUrl} alt={emp.fullName} data-ai-hint="profile avatar" />
                        <AvatarFallback>{emp.fullName?.split(' ').map(n => n[0]).join('').toUpperCase() || 'U'}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{emp.fullName}</div>
                        <div className="text-sm text-muted-foreground">{emp.emailAddress}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{emp.employeeId}</TableCell>
                  <TableCell>{emp.clientName}</TableCell>
                  <TableCell>{emp.phoneNumber}</TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(emp.status)}>{emp.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/employees/${emp.id}`}>
                            <Eye className="mr-2 h-4 w-4" /> View Profile
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled>
                          <Edit className="mr-2 h-4 w-4" /> Edit (soon)
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {emp.status !== 'Active' && (
                          <DropdownMenuItem onClick={() => openStatusModal(emp, 'Active')}>
                            <UserCheck className="mr-2 h-4 w-4" /> Set Active
                          </DropdownMenuItem>
                        )}
                        {emp.status !== 'Inactive' && (
                          <DropdownMenuItem onClick={() => openStatusModal(emp, 'Inactive')}>
                            <UserX className="mr-2 h-4 w-4" /> Set Inactive
                          </DropdownMenuItem>
                        )}
                        {emp.status !== 'Exited' && (
                           <DropdownMenuItem onClick={() => openStatusModal(emp, 'Exited')}>
                            <LogOutIcon className="mr-2 h-4 w-4" /> Set Exited
                          </DropdownMenuItem>
                        )}
                         <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive-foreground focus:bg-destructive" disabled>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete (soon)
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )))}
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-between items-center mt-4">
            <span className="text-sm text-muted-foreground">
              Page {currentPage}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviousPage}
                disabled={isFetchingPrev || currentPage === 1 || !hasMorePrev}
              >
                {isFetchingPrev ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : null}
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={isFetchingNext || !hasMoreNext}
              >
                 {isFetchingNext ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : null}
                Next
              </Button>
            </div>
          </div>
      </div>

      {/* Status Update Modal/Dialog */}
      {selectedEmployeeForStatusChange && (
        <AlertDialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                <AlertDialogTitle>Update Status for {selectedEmployeeForStatusChange.fullName}</AlertDialogTitle>
                <AlertDialogDescription>
                    You are about to change the status to <Badge variant={getStatusBadgeVariant(newStatus as Employee['status'])}>{newStatus}</Badge>.
                    {newStatus === 'Exited' && " Please provide the date of exit."}
                </AlertDialogDescription>
                </AlertDialogHeader>
                {newStatus === 'Exited' && (
                <div className="grid gap-2 py-2">
                    <Label htmlFor="exitDate">Date of Exit</Label>
                    <Popover>
                    <PopoverTrigger asChild>
                        <Button
                        id="exitDate"
                        variant={"outline"}
                        className="w-full justify-start text-left font-normal"
                        >
                        <CalendarDays className="mr-2 h-4 w-4" />
                        {exitDate ? format(exitDate, "PPP") : <span>Pick a date</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                        mode="single"
                        selected={exitDate}
                        onSelect={setExitDate}
                        disabled={(date) => date > new Date()} // Cannot select future date
                        initialFocus
                        />
                    </PopoverContent>
                    </Popover>
                </div>
                )}
                <AlertDialogFooter>
                <AlertDialogCancel disabled={isUpdatingStatus}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmStatusUpdate} disabled={isUpdatingStatus || (newStatus === 'Exited' && !exitDate)}>
                    {isUpdatingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirm Update
                </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
