
"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { type Employee } from '@/types/employee';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'; // Added Card imports
import { MoreHorizontal, Search, Filter, UserPlus, Edit, Trash2, Eye, UserCheck, UserX, LogOutIcon, CalendarDays, Loader2, AlertCircle } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { db, storage } from '@/lib/firebase';
import { ref, deleteObject } from "firebase/storage";
import { collection, query, orderBy, limit, getDocs, startAfter, where, doc, updateDoc, serverTimestamp, Timestamp, getCountFromServer, endBefore, limitToLast, type QueryDocumentSnapshot, type DocumentData, deleteField, deleteDoc, Query, collectionGroup } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';

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

  const [currentPage, setCurrentPage] = useState(1);
  const [lastVisibleDoc, setLastVisibleDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [pageHistory, setPageHistory] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);

  const [isTableLoading, setIsTableLoading] = useState(false);
  
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [selectedEmployeeForStatusChange, setSelectedEmployeeForStatusChange] = useState<Employee | null>(null);
  const [newStatus, setNewStatus] = useState<Employee['status'] | ''>('');
  const [exitDate, setExitDate] = useState<Date | undefined>(undefined);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);


  const fetchClients = useCallback(async () => {
    try {
      const clientsSnapshot = await getDocs(query(collection(db, 'clients'), orderBy('name')));
      const fetchedClients = clientsSnapshot.docs.map(docSnap => ({ id: docSnap.id, name: docSnap.data().name as string }));
      setClients([{ id: 'all', name: 'All Clients' }, ...fetchedClients]);
    } catch (err: any) {
      console.error("Error fetching clients:", err);
      let message = "Could not fetch client list.";
      if (err.code === 'permission-denied') {
        message = "Permission denied. Check Firestore rules to allow client list access.";
      }
      toast({ variant: "destructive", title: "Error", description: message });
    }
  }, [toast]);
  
  const buildBaseQuery = useCallback(() => {
    let q: Query<DocumentData> = collection(db, "employees");
    
    // Apply equality filters first
    if (filterClient !== 'all') {
      q = query(q, where('clientName', '==', filterClient));
    }
    if (filterStatus !== 'all') {
      q = query(q, where('status', '==', filterStatus));
    }
    if (filterDistrict !== 'all') {
      q = query(q, where('district', '==', filterDistrict));
    }
    
    return q;
  }, [filterClient, filterStatus, filterDistrict]);

  const fetchEmployees = useCallback(async (page: number, startAfterDoc: QueryDocumentSnapshot<DocumentData> | null) => {
    setIsTableLoading(true);
    setError(null);

    try {
        let finalQuery: Query<DocumentData>;
        let baseQuery = buildBaseQuery();

        if (searchTerm.trim() !== '') {
            const term = searchTerm.trim().toUpperCase();
            finalQuery = query(
              baseQuery, 
              where('searchableFields', 'array-contains', term),
              // We cannot use orderBy on a different field than the array-contains, 
              // so we accept Firestore's default ordering for search results.
              // Client-side sorting can be added if a specific order is needed for search.
            );
            // Search fetches all results that match and relies on client-side pagination.
        } else {
            // Standard pagination and filtering, ordered by creation date
            baseQuery = query(baseQuery, orderBy('createdAt', 'desc'));
            if (startAfterDoc) {
                finalQuery = query(baseQuery, startAfter(startAfterDoc), limit(ITEMS_PER_PAGE));
            } else {
                finalQuery = query(baseQuery, limit(ITEMS_PER_PAGE));
            }
        }
        
        const documentSnapshots = await getDocs(finalQuery);
      
        const fetchedEmployees = documentSnapshots.docs.map(docSnap => {
            const data = docSnap.data();
            return {
                id: docSnap.id,
                ...data,
                // Convert Timestamps to ISO strings for serialization
                joiningDate: data.joiningDate instanceof Timestamp ? data.joiningDate.toDate().toISOString() : data.joiningDate,
                dateOfBirth: data.dateOfBirth instanceof Timestamp ? data.dateOfBirth.toDate().toISOString() : data.dateOfBirth,
                exitDate: data.exitDate instanceof Timestamp ? data.exitDate.toDate().toISOString() : (data.exitDate || null),
                createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt,
                updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : data.updatedAt,
            } as Employee;
        });

        setEmployees(fetchedEmployees);
        
        // Handle pagination state
        if (searchTerm.trim() === '') {
          const newLastVisible = documentSnapshots.docs[documentSnapshots.docs.length - 1] || null;
          setLastVisibleDoc(newLastVisible);
        } else {
          // For search, pagination is handled client-side, so we clear the Firestore cursor
          setLastVisibleDoc(null);
        }

    } catch (err: any) {
      console.error("Error fetching employees:", err);
      let message = err.message || "Failed to fetch employees.";
      if (err.code === 'permission-denied') {
        message = "Permission denied. Please check your Firestore security rules to ensure authenticated users can list employees.";
      } else if (err.code === 'failed-precondition') {
        message = "A required database index is missing. This is expected when using new filter combinations. Please check the browser's developer console for a link to create the required index in your Firebase project. This change might take a few minutes to apply.";
      }
      setError(message);
      toast({ variant: "destructive", title: "Data Fetch Error", description: message, duration: 9000 });
    } finally {
      setIsLoading(false);
      setIsTableLoading(false);
    }
  }, [toast, buildBaseQuery, searchTerm]);

    useEffect(() => {
        fetchClients();
    }, [fetchClients]);

    useEffect(() => {
        const debounceTimer = setTimeout(() => {
            setCurrentPage(1);
            setPageHistory([null]);
            setLastVisibleDoc(null);
            fetchEmployees(1, null);
        }, 500); // Debounce search/filter changes by 500ms

        return () => clearTimeout(debounceTimer);
    }, [searchTerm, filterClient, filterStatus, filterDistrict, fetchEmployees]);
  

  const handleNextPage = () => {
    if (!lastVisibleDoc && searchTerm.trim() === '') return;

    const nextPage = currentPage + 1;
    if (searchTerm.trim() !== '') {
        setCurrentPage(nextPage);
    } else {
       setPageHistory(prev => [...prev, lastVisibleDoc]);
       fetchEmployees(nextPage, lastVisibleDoc);
       setCurrentPage(nextPage);
    }
  };

  const handlePreviousPage = () => {
      if (currentPage === 1) return;
      const prevPage = currentPage - 1;
      
      if (searchTerm.trim() !== '') {
        setCurrentPage(prevPage);
      } else {
        const prevHistory = pageHistory.slice(0, -1);
        const startAfterDoc = prevHistory[prevPage -1] ?? null;
        
        setPageHistory(prevHistory);
        fetchEmployees(prevPage, startAfterDoc);
        setCurrentPage(prevPage);
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

  const openStatusModal = (employee: Employee, status: Employee['status']) => {
    setSelectedEmployeeForStatusChange(employee);
    setNewStatus(status);
    if (status === 'Exited') {
      setExitDate(employee.exitDate ? new Date(employee.exitDate) : new Date()); 
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
        updateData.exitDate = deleteField(); 
      }

      await updateDoc(employeeDocRef, updateData);
      toast({ title: "Status Updated", description: `${selectedEmployeeForStatusChange.fullName}'s status updated to ${newStatus}.` });
      
      // Refetch current page data
      const currentStartDoc = pageHistory[currentPage - 1] ?? null;
      fetchEmployees(currentPage, currentStartDoc);
      
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
        employeeToDelete.profilePictureUrl,
        employeeToDelete.idProofDocumentUrl, // Legacy field
        employeeToDelete.idProofDocumentUrlFront,
        employeeToDelete.idProofDocumentUrlBack,
        employeeToDelete.bankPassbookStatementUrl,
        employeeToDelete.policeClearanceCertificateUrl,
      ];

      for (const fileUrl of filesToDelete) {
        if (fileUrl) {
          try {
            if (fileUrl.startsWith("https://firebasestorage.googleapis.com/")) {
                const storageRef = ref(storage, fileUrl);
                await deleteObject(storageRef);
            }
          } catch (fileError: any) {
            console.error(`Failed to delete file ${fileUrl}:`, fileError);
            if (fileError.code !== 'storage/object-not-found') {
              toast({
                variant: "destructive",
                title: "File Deletion Warning",
                description: `Could not delete file ${fileUrl.split('/').pop()?.split('?')[0]}. You may need to remove it manually from Firebase Storage.`,
                duration: 7000,
              });
            }
          }
        }
      }
      toast({ title: "Employee Deleted", description: `${employeeToDelete.fullName} has been removed from the directory.` });
      
      // Reset and fetch first page
      setCurrentPage(1);
      setPageHistory([null]);
      setLastVisibleDoc(null);
      fetchEmployees(1, null);
      
      setIsDeleteDialogOpen(false);
      setEmployeeToDelete(null);
    } catch (err) {
      console.error("Error deleting employee:", err);
      toast({ variant: "destructive", title: "Error", description: "Could not delete employee." });
    } finally {
      setIsDeleting(false);
    }
  };
  
  const displayedEmployees = useMemo(() => {
    if (searchTerm.trim() !== '') {
      // Client-side pagination for search results
      return employees.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
    }
    // Firestore pagination for non-search results
    return employees;
  }, [employees, currentPage, searchTerm]);

  const canShowNext = useMemo(() => {
    if (searchTerm.trim() !== '') {
      return (currentPage * ITEMS_PER_PAGE) < employees.length;
    }
    // For Firestore pagination, this logic holds: if we received a full page, there might be more.
    return employees.length >= ITEMS_PER_PAGE;
  }, [employees, currentPage, searchTerm]);


  if (isLoading) { 
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-200px)]">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-lg text-muted-foreground">Loading employees...</p>
      </div>
    );
  }

  if (error && employees.length === 0) {
    return (
      <div className="text-center py-10">
        <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
        <p className="mt-4 text-lg text-destructive">{error}</p>
        <Button onClick={() => fetchEmployees(1, null)} className="mt-4">Try Again</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Employee Directory</h1>
        <Link href="/employees/enroll" passHref>
          <Button>
            <UserPlus className="mr-2 h-4 w-4" /> Enroll New Employee
          </Button>
        </Link>
      </div>

      <Card className="shadow">
        <CardHeader>
            <CardTitle>Filters & Search</CardTitle>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
              <div className="sm:col-span-2 lg:col-span-1">
                  <Label htmlFor="search-input">Search by Name/ID/Phone</Label>
                  <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="search-input"
                        type="search"
                        placeholder="Search..."
                        className="pl-8 w-full"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                  </div>
              </div>
              <div>
                <Label htmlFor="client-filter">Client</Label>
                <Select value={filterClient} onValueChange={setFilterClient}>
                    <SelectTrigger id="client-filter">
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
              </div>
              <div>
                <Label htmlFor="district-filter">District</Label>
                <Select value={filterDistrict} onValueChange={setFilterDistrict}>
                    <SelectTrigger id="district-filter">
                    <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                    <SelectValue placeholder="Filter by District" />
                    </SelectTrigger>
                    <SelectContent>
                    {keralaDistricts.map(district => (
                        <SelectItem key={district} value={district}>
                        {district === 'all' ? 'All Districts' : district}
                        </SelectItem>
                    ))}
                    </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="status-filter">Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger id="status-filter">
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
            </div>
        </CardContent>
      </Card>

      <Card className="shadow">
        <CardHeader>
            <CardTitle>Employee List</CardTitle>
        </CardHeader>
        <CardContent>
            <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="hidden md:table-cell">Employee ID</TableHead>
                    <TableHead className="hidden lg:table-cell">Client</TableHead>
                    <TableHead className="hidden sm:table-cell">Mobile</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                </TableRow>
                </TableHeader>
                <TableBody>
                {isTableLoading ? ( 
                    <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                    </TableCell>
                    </TableRow>
                ) : displayedEmployees.length === 0 ? (
                    <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                        No employees found matching your criteria.
                    </TableCell>
                    </TableRow>
                ) : (
                    displayedEmployees.map((emp) => (
                    <TableRow 
                      key={emp.id} 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/employees/${emp.id}`)}
                    >
                    <TableCell>
                        <div className="flex items-center gap-3">
                        <Avatar>
                            <AvatarImage src={emp.profilePictureUrl} alt={emp.fullName || 'Employee avatar'} data-ai-hint="profile avatar"/>
                            <AvatarFallback>{emp.fullName?.split(' ').map(n => n[0]).join('').toUpperCase() || 'U'}</AvatarFallback>
                        </Avatar>
                        <div>
                            <div className="font-medium">{emp.fullName}</div>
                            <div className="text-sm text-muted-foreground sm:hidden">{emp.phoneNumber}</div>
                            <div className="text-sm text-muted-foreground hidden sm:block">{emp.emailAddress}</div>
                        </div>
                        </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{emp.employeeId}</TableCell>
                    <TableCell className="hidden lg:table-cell">{emp.clientName}</TableCell>
                    <TableCell className="hidden sm:table-cell">{emp.phoneNumber}</TableCell>
                    <TableCell>
                        <Badge variant={getStatusBadgeVariant(emp.status)}>{emp.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div onClick={(e) => e.stopPropagation()}>
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
                              <DropdownMenuItem asChild>
                              <Link href={`/employees/${emp.id}?edit=true`}> 
                                  <Edit className="mr-2 h-4 w-4" /> Edit
                              </Link>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {emp.status !== 'Active' && (
                              <DropdownMenuItem onClick={() => openStatusModal(emp, 'Active')}>
                                  <UserCheck className="mr-2 h-4 w-4" /> Set Active
                              </DropdownMenuItem>
                              )}
                              {emp.status !== 'Inactive' && emp.status !== 'Exited' && ( 
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
                              <DropdownMenuItem className="text-destructive focus:text-destructive-foreground focus:bg-destructive" onClick={() => openDeleteDialog(emp)}>
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                              </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
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
                    disabled={isTableLoading || currentPage === 1}
                >
                    Previous
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNextPage}
                    disabled={isTableLoading || !canShowNext}
                >
                    Next
                </Button>
                </div>
            </div>
        </CardContent>
      </Card>

      {selectedEmployeeForStatusChange && (
        <AlertDialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                <AlertDialogTitle>Update Status for {selectedEmployeeForStatusChange.fullName}</AlertDialogTitle>
                <AlertDialogDescription>
                  <span>
                    You are about to change the status to <Badge variant={getStatusBadgeVariant(newStatus as Employee['status'])}>{newStatus}</Badge>.
                    {newStatus === 'Exited' && " Please provide the date of exit."}
                  </span>
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
                        disabled={(date) => date > new Date()} 
                        initialFocus
                        />
                    </PopoverContent>
                    </Popover>
                </div>
                )}
                <AlertDialogFooter>
                <AlertDialogCancel disabled={isUpdatingStatus}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmStatusUpdate} disabled={isUpdatingStatus || (newStatus === 'Exited' && !exitDate)}>
                  <span className="flex items-center justify-center">
                    {isUpdatingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirm Update
                  </span>
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
                    <AlertDialogDescription>
                        Are you sure you want to delete the employee "{employeeToDelete.fullName}" (ID: {employeeToDelete.employeeId})?
                        This action will permanently remove their record and attempt to delete associated files. This cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting} onClick={() => setEmployeeToDelete(null)}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting} className={buttonVariants({ variant: "destructive" })}>
                      <span className="flex items-center justify-center">
                        {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Confirm Delete
                      </span>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

    