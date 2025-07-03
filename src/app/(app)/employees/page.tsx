
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
import { collection, query, orderBy, limit, getDocs, startAfter, where, doc, updateDoc, serverTimestamp, Timestamp, getCountFromServer, endBefore, limitToLast, type QueryDocumentSnapshot, type DocumentData, deleteField, deleteDoc, Query } from 'firebase/firestore';
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
  const [firstVisibleDoc, setFirstVisibleDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  
  const [isTableLoading, setIsTableLoading] = useState(false);
  const [hasMoreNext, setHasMoreNext] = useState(true);
  const hasMorePrev = currentPage > 1;

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
    let q: Query<DocumentData> = query(collection(db, "employees"));

    if (filterClient !== 'all') {
      q = query(q, where('clientName', '==', filterClient));
    }
    if (filterStatus !== 'all') {
      q = query(q, where('status', '==', filterStatus));
    }
    if (filterDistrict !== 'all') {
      q = query(q, where('district', '==', filterDistrict));
    }
    
    if (searchTerm.trim() !== '') {
        const searchTermUpper = searchTerm.trim().toUpperCase();
        q = query(q, 
          where('employeeId', '>=', searchTermUpper), 
          where('employeeId', '<=', searchTermUpper + '\uf8ff')
        );
    }
    
    if (searchTerm.trim() !== '') {
        q = query(q, orderBy('employeeId', 'asc'));
    }
    q = query(q, orderBy('createdAt', 'desc')); 

    return q;
  }, [filterClient, filterStatus, filterDistrict, searchTerm]);

  const fetchEmployees = useCallback(async (direction?: 'next' | 'prev') => {
    // For the very first load, use the main loader. For subsequent loads, use the table loader.
    if (isLoading) {
        setIsTableLoading(true);
    } else {
        setIsTableLoading(true);
    }
    setError(null);

    try {
      const baseQuery = buildBaseQuery();
      let finalQuery: Query<DocumentData>;

      if (direction === 'next' && lastVisibleDoc) {
          finalQuery = query(baseQuery, startAfter(lastVisibleDoc), limit(ITEMS_PER_PAGE));
      } else if (direction === 'prev' && firstVisibleDoc) {
          finalQuery = query(baseQuery, endBefore(firstVisibleDoc), limitToLast(ITEMS_PER_PAGE));
      } else { // This handles the initial load and filter resets
          finalQuery = query(baseQuery, limit(ITEMS_PER_PAGE));
      }

      const documentSnapshots = await getDocs(finalQuery);
      
      const fetchedEmployees = documentSnapshots.docs.map(docSnap => {
        const data = docSnap.data();
        return {
            id: docSnap.id,
            ...data,
            joiningDate: data.joiningDate instanceof Timestamp ? data.joiningDate.toDate().toISOString() : data.joiningDate,
            dateOfBirth: data.dateOfBirth instanceof Timestamp ? data.dateOfBirth.toDate().toISOString() : data.dateOfBirth,
            exitDate: data.exitDate instanceof Timestamp ? data.exitDate.toDate().toISOString() : data.exitDate,
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt,
            updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : data.updatedAt,
        } as Employee;
      });
      
      setEmployees(fetchedEmployees);
      
      const currentFirstDoc = documentSnapshots.docs[0] || null;
      const currentLastDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1] || null;

      setFirstVisibleDoc(currentFirstDoc);
      setLastVisibleDoc(currentLastDoc);
      
      if (currentLastDoc) {
          const nextCheckQuery = query(baseQuery, startAfter(currentLastDoc), limit(1));
          const nextSnapshot = await getDocs(nextCheckQuery);
          setHasMoreNext(!nextSnapshot.empty);
      } else {
          setHasMoreNext(false);
      }
      
    } catch (err: any) {
      console.error("Error fetching employees:", err);
      let message = err.message || "Failed to fetch employees.";
      if (err.code === 'permission-denied') {
        message = "Permission denied. Please check your Firestore security rules to ensure authenticated users can list employees.";
      } else if (err.code === 'failed-precondition') {
        message = "A required database index is missing. This is expected when using new filter combinations for the first time. Please check the browser's developer console for a link to create the index in your Firebase project.";
      }
      setError(message);
      toast({ variant: "destructive", title: "Data Fetch Error", description: message, duration: 9000 });
    } finally {
      setIsLoading(false);
      setIsTableLoading(false);
    }
  }, [toast, buildBaseQuery, lastVisibleDoc, firstVisibleDoc, isLoading]); 

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);
  
  // This effect resets pagination and fetches data when filters change
  useEffect(() => {
    setCurrentPage(1); 
    setLastVisibleDoc(null); 
    setFirstVisibleDoc(null);
    fetchEmployees(); 
    // We want this to run ONLY when filters change. fetchEmployees is a dependency
    // but the state resets ensure it acts as a 'reset' call.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, filterClient, filterStatus, filterDistrict]);


  const handleNextPage = () => {
    if (hasMoreNext) {
      setCurrentPage(prev => prev + 1);
      fetchEmployees('next');
    }
  };

  const handlePreviousPage = () => {
    if (hasMorePrev) {
      setCurrentPage(prev => prev - 1);
      fetchEmployees('prev');
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
      
      setEmployees(prevEmployees => 
        prevEmployees.map(emp => 
          emp.id === selectedEmployeeForStatusChange.id 
          ? {...emp, status: newStatus, exitDate: newStatus === 'Exited' && exitDate ? exitDate.toISOString() : undefined, updatedAt: new Date().toISOString() } 
          : emp
        )
      );
      
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
            toast({
              variant: "destructive",
              title: "File Deletion Warning",
              description: `Could not delete file ${fileUrl.split('/').pop()?.split('?')[0]}. You may need to remove it manually from Firebase Storage.`,
              duration: 7000,
            });
          }
        }
      }
      toast({ title: "Employee Deleted", description: `${employeeToDelete.fullName} has been removed from the directory.` });
      
      fetchEmployees();
      
      setIsDeleteDialogOpen(false);
      setEmployeeToDelete(null);
    } catch (err) {
      console.error("Error deleting employee:", err);
      toast({ variant: "destructive", title: "Error", description: "Could not delete employee." });
    } finally {
      setIsDeleting(false);
    }
  };
  

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
        <Button onClick={() => fetchEmployees()} className="mt-4">Try Again</Button>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
            <Select value={filterDistrict} onValueChange={setFilterDistrict}>
                <SelectTrigger>
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
                ) : employees.length === 0 ? (
                    <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                        No employees found.
                    </TableCell>
                    </TableRow>
                ) : (
                    employees.map((emp) => (
                    <TableRow 
                      key={emp.id} 
                      className="cursor-pointer"
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
                    disabled={isTableLoading || !hasMorePrev}
                >
                    {isTableLoading && !hasMorePrev ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : null}
                    Previous
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNextPage}
                    disabled={isTableLoading || !hasMoreNext}
                >
                    {isTableLoading && hasMoreNext ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : null}
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
