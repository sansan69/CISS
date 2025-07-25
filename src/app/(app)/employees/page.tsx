
"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { type Employee } from '@/types/employee';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { MoreHorizontal, Search, Filter, UserPlus, Edit, Trash2, Eye, UserCheck, UserX, LogOutIcon, CalendarDays, Loader2, AlertCircle, DatabaseZap, ScanSearch, CheckCircle, AlertTriangle as WarningIcon, FileWarning } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { db, storage } from '@/lib/firebase';
import { ref, deleteObject } from "firebase/storage";
import { collection, query, orderBy, limit, getDocs, startAfter, where, doc, updateDoc, serverTimestamp, Timestamp, getCountFromServer, endBefore, limitToLast, type QueryDocumentSnapshot, type DocumentData, deleteField, deleteDoc, Query, collectionGroup, writeBatch } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription as ShadDialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import { Progress } from '@/components/ui/progress';

const ITEMS_PER_PAGE = 10;
const SESSION_STORAGE_KEY = 'employeeDirectoryState';


interface ClientOption {
  id: string;
  name: string;
}

const keralaDistricts = [
  'all', "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", 
  "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", 
  "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod"
];

// Helper to get pending items for an employee profile
const getPendingDetails = (employee: Employee): string[] => {
    const pending: string[] = [];
    const legacy = employee as any;

    // Essential Documents
    if (!employee.profilePictureUrl) pending.push("Profile Picture");
    if (!employee.signatureUrl) pending.push("Signature");
    if (!employee.identityProofUrlFront && !legacy.idProofDocumentUrlFront && !legacy.idProofDocumentUrl) pending.push("Identity Proof (Front)");
    if (!employee.identityProofUrlBack && !legacy.idProofDocumentUrlBack) pending.push("Identity Proof (Back)");
    if (!employee.addressProofUrlFront) pending.push("Address Proof (Front)");
    if (!employee.addressProofUrlBack) pending.push("Address Proof (Back)");

    // Essential Details
    if (!employee.panNumber) pending.push("PAN Number");
    if (!employee.bankAccountNumber) pending.push("Bank Account Number");
    if (!employee.ifscCode) pending.push("IFSC Code");
    if (!employee.bankName) pending.push("Bank Name");

    // Optional but good to have
    if (!employee.epfUanNumber) pending.push("EPF/UAN Number");
    if (!employee.esicNumber) pending.push("ESIC Number");
    if (!employee.bankPassbookStatementUrl) pending.push("Bank Document");
    if (!employee.policeClearanceCertificateUrl) pending.push("Police Clearance Cert.");
    
    return pending;
};


// Helper to safely format dates that might be Timestamps or strings
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
  
  const [isTableLoading, setIsTableLoading] = useState(false);
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDocHistory, setPageDocHistory] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);


  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [selectedEmployeeForStatusChange, setSelectedEmployeeForStatusChange] = useState<Employee | null>(null);
  const [newStatus, setNewStatus] = useState<Employee['status'] | ''>('');
  const [exitDate, setExitDate] = useState<Date | undefined>(undefined);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);

  // State for duplicate scanning
  const [isScanningDuplicates, setIsScanningDuplicates] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<Record<string, Employee[]>>({});
  const [showDuplicatesDialog, setShowDuplicatesDialog] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState<string[]>([]);
  const [isDeletingDuplicates, setIsDeletingDuplicates] = useState(false);

  const buildBaseQuery = useCallback(() => {
    let q: Query = collection(db, "employees");
    
    if (filterClient !== 'all') q = query(q, where('clientName', '==', filterClient));
    if (filterStatus !== 'all') q = query(q, where('status', '==', filterStatus));
    if (filterDistrict !== 'all') q = query(q, where('district', '==', filterDistrict));
    
    if (searchTerm.trim() !== '') {
        q = query(q, where('searchableFields', 'array-contains', searchTerm.trim().toUpperCase()));
    } else {
        q = query(q, orderBy('createdAt', 'desc'));
    }

    return q;
  }, [filterClient, filterStatus, filterDistrict, searchTerm]);

  const fetchPage = useCallback(async (page: number, direction: 'next' | 'prev' | 'initial') => {
    setIsTableLoading(true);
    setError(null);
    try {
        const baseQuery = buildBaseQuery();
        let finalQuery: Query<DocumentData>;

        if (direction === 'initial') {
            finalQuery = query(baseQuery, limit(ITEMS_PER_PAGE));
        } else if (direction === 'next') {
            const lastVisible = pageDocHistory[page - 1];
            finalQuery = query(baseQuery, startAfter(lastVisible), limit(ITEMS_PER_PAGE));
        } else { // prev
            const firstVisible = pageDocHistory[page - 1];
            finalQuery = query(baseQuery, endBefore(firstVisible), limitToLast(ITEMS_PER_PAGE));
        }

        const documentSnapshots = await getDocs(finalQuery);
        const fetchedEmployees = documentSnapshots.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data(),
        } as Employee));
        
        if (fetchedEmployees.length === 0 && direction !== 'initial') {
            toast({ variant: 'default', title: "No More Records", description: "You've reached the end of the list."});
            setIsTableLoading(false);
            return;
        }

        setEmployees(fetchedEmployees);
        setCurrentPage(page);

        // Update page history
        const firstDoc = documentSnapshots.docs[0] || null;
        const lastDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1] || null;

        setPageDocHistory(prev => {
            const newHistory = [...prev];
            if (direction === 'next') {
                newHistory[page] = lastDoc;
            } else if (direction === 'initial') {
                 return [null, lastDoc];
            }
            return newHistory;
        });

        const stateToSave = { searchTerm, filterClient, filterStatus, filterDistrict };
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateToSave));

    } catch (err: any) {
        console.error("Error fetching employees:", err);
        let message = err.message || "Failed to fetch employees.";
        if (err.code === 'permission-denied') message = "Permission denied. Check Firestore security rules.";
        if (err.code === 'failed-precondition') message = "A required database index is missing. Please check the browser's developer console for a link to create the required index in your Firebase project.";
        setError(message);
        toast({ variant: "destructive", title: "Data Fetch Error", description: message, duration: 9000 });
    } finally {
        setIsLoading(false);
        setIsTableLoading(false);
    }
  }, [buildBaseQuery, pageDocHistory, toast, filterClient, filterStatus, filterDistrict, searchTerm]);

  useEffect(() => {
    const fetchClients = async () => {
        try {
            const clientsSnapshot = await getDocs(query(collection(db, 'clients'), orderBy('name')));
            const fetchedClients = clientsSnapshot.docs.map(docSnap => ({ id: docSnap.id, name: docSnap.data().name as string }));
            setClients([{ id: 'all', name: 'All Clients' }, ...fetchedClients]);
        } catch (err: any) {
            toast({ variant: "destructive", title: "Error", description: "Could not fetch client list." });
        }
    };
    fetchClients();
  }, [toast]);
  
  useEffect(() => {
    const savedStateJSON = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (savedStateJSON) {
        try {
            const savedState = JSON.parse(savedStateJSON);
            setSearchTerm(savedState.searchTerm || '');
            setFilterClient(savedState.filterClient || 'all');
            setFilterStatus(savedState.filterStatus || 'all');
            setFilterDistrict(savedState.filterDistrict || 'all');
        } catch(e) {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
        }
    }
    // This effect should only run once on mount.
    // The dependency array is intentionally empty.
  }, []);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      fetchPage(1, 'initial');
    }, 500);

    return () => clearTimeout(debounceTimer);
    // This effect runs when filters change
  }, [searchTerm, filterClient, filterStatus, filterDistrict]);


  const handleNextPage = () => {
    fetchPage(currentPage + 1, 'next');
  };

  const handlePreviousPage = () => {
    // Navigate back to the previous page's data using its last known doc.
    const prevPage = currentPage - 1;
    if (prevPage > 0) {
      router.back(); // Simplest way to handle browser history
      fetchPage(prevPage, 'prev'); // Re-fetch for that state. This might need more refinement based on exact UX needs.
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
      
      setEmployees(prev => prev.map(emp => emp.id === selectedEmployeeForStatusChange.id ? { ...emp, status: newStatus, exitDate: newStatus === 'Exited' ? exitDate : undefined } : emp));
      
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
        employeeToDelete.identityProofUrlFront,
        employeeToDelete.identityProofUrlBack,
        employeeToDelete.addressProofUrlFront,
        employeeToDelete.addressProofUrlBack,
        employeeToDelete.signatureUrl,
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
            console.warn(`Failed to delete file ${fileUrl}:`, fileError.message);
          }
        }
      }
      toast({ title: "Employee Deleted", description: `${employeeToDelete.fullName} has been removed from the directory.` });
      
      fetchPage(1, 'initial');
      
      setIsDeleteDialogOpen(false);
      setEmployeeToDelete(null);
    } catch (err) {
      console.error("Error deleting employee:", err);
      toast({ variant: "destructive", title: "Error", description: "Could not delete employee." });
    } finally {
      setIsDeleting(false);
    }
  };

  const runBatchUpdate = async (
    updateTitle: string,
    queryToRun: Query<DocumentData>,
    updateLogic: (docData: Employee) => Record<string, any>
  ) => {
    setIsUpdating(true);
    setUpdateProgress(0);
    toast({ title: `Starting: ${updateTitle}`, description: "Fetching all relevant employee records. This may take a moment..." });

    try {
        const snapshot = await getDocs(queryToRun);
        const totalDocs = snapshot.size;
        let processedCount = 0;

        if (totalDocs === 0) {
            toast({ title: "No Records to Update", description: "No employees matched the criteria for this update." });
            setIsUpdating(false);
            return;
        }

        const BATCH_SIZE = 400;
        for (let i = 0; i < totalDocs; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = snapshot.docs.slice(i, i + BATCH_SIZE);

            for (const docSnapshot of chunk) {
                const employeeData = {id: docSnapshot.id, ...docSnapshot.data()} as Employee;
                const updates = updateLogic(employeeData);
                if (Object.keys(updates).length > 0) {
                    batch.update(docSnapshot.ref, updates);
                }
            }

            await batch.commit();
            processedCount += chunk.length;
            setUpdateProgress((processedCount / totalDocs) * 100);
        }
        
        toast({ title: "Update Complete!", description: `Successfully updated ${totalDocs} employee records for ${updateTitle}.`, duration: 5000 });
        fetchPage(1, 'initial');

    } catch (error) {
        console.error(`Error during ${updateTitle}:`, error);
        toast({ variant: "destructive", title: "Update Failed", description: `An error occurred while running the update for ${updateTitle}.` });
    } finally {
        setIsUpdating(false);
    }
  };


  const handleUpdateSearchFields = () => {
    const allEmployeesQuery = query(collection(db, "employees"));
    runBatchUpdate("Search Fields", allEmployeesQuery, (employeeData) => {
        const nameParts = (employeeData.fullName || '').toUpperCase().split(' ').filter(Boolean);
        const searchableFields = Array.from(new Set([
          ...nameParts,
          (employeeData.firstName || '').toUpperCase(),
          (employeeData.lastName || '').toUpperCase(),
          (employeeData.employeeId || '').toUpperCase(),
          employeeData.phoneNumber,
        ].filter(Boolean) as string[]));

        return { searchableFields };
    });
  };

  const handleMigrateIdProofs = () => {
    const oldRecordsQuery = query(
        collection(db, "employees"), 
        where("idProofType", "!=", null)
    );
    runBatchUpdate("ID Proof Migration", oldRecordsQuery, (employeeData) => {
        if (employeeData.identityProofType) {
            return {};
        }

        const updates: Record<string, any> = {
            identityProofType: employeeData.idProofType,
            identityProofNumber: employeeData.idProofNumber,
            identityProofUrlFront: employeeData.idProofDocumentUrlFront || employeeData.idProofDocumentUrl, 
            identityProofUrlBack: employeeData.idProofDocumentUrlBack,
            idProofType: deleteField(),
            idProofNumber: deleteField(),
            idProofDocumentUrl: deleteField(),
            idProofDocumentUrlFront: deleteField(),
            idProofDocumentUrlBack: deleteField(),
        };

        return updates;
    });
  };

  const handleScanForDuplicates = async () => {
    setIsScanningDuplicates(true);
    toast({ title: "Scanning for duplicates...", description: "This might take a moment for large datasets." });
  
    try {
      const allEmployeesSnapshot = await getDocs(collection(db, "employees"));
      const allEmployees = allEmployeesSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Employee));
  
      const duplicates: Record<string, Employee[]> = {};
  
      const checkAndAdd = (key: string, employee: Employee) => {
        if (!duplicates[key]) {
          duplicates[key] = [];
        }
        duplicates[key].push(employee);
      };
  
      allEmployees.forEach(emp => {
        if (emp.phoneNumber) checkAndAdd(`phone-${emp.phoneNumber}`, emp);
        if (emp.emailAddress) checkAndAdd(`email-${emp.emailAddress.toLowerCase()}`, emp);
      });
  
      const finalGroups = Object.fromEntries(
        Object.entries(duplicates).filter(([_, group]) => group.length > 1)
      );
  
      setDuplicateGroups(finalGroups);
      if (Object.keys(finalGroups).length > 0) {
        setShowDuplicatesDialog(true);
      } else {
        toast({ title: "No Duplicates Found", description: "The scan completed and no duplicates were identified." });
      }
    } catch (error) {
      console.error("Error scanning for duplicates:", error);
      toast({ variant: "destructive", title: "Scan Failed", description: "Could not complete the duplicate scan." });
    } finally {
      setIsScanningDuplicates(false);
    }
  };
  
  const handleToggleDeletion = (id: string) => {
    setSelectedForDeletion(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleDeleteSelectedDuplicates = async () => {
    if (selectedForDeletion.length === 0) {
      toast({ variant: "destructive", title: "No Selection", description: "Please select at least one record to delete." });
      return;
    }
  
    setIsDeletingDuplicates(true);
    const batch = writeBatch(db);
  
    const employeesToDelete = Object.values(duplicateGroups).flat().filter(e => selectedForDeletion.includes(e.id));
  
    for (const emp of employeesToDelete) {
      batch.delete(doc(db, "employees", emp.id));
    }
  
    try {
      await batch.commit();
  
      // Now handle file deletions after successful DB deletion
      for (const emp of employeesToDelete) {
          const filesToDelete = [ emp.profilePictureUrl, emp.identityProofUrlFront, emp.identityProofUrlBack, emp.addressProofUrlFront, emp.addressProofUrlBack, emp.signatureUrl, emp.bankPassbookStatementUrl, emp.policeClearanceCertificateUrl ];
          for (const url of filesToDelete) {
              if (url) {
                  try {
                      await deleteObject(ref(storage, url));
                  } catch (fileError) {
                      console.warn(`Failed to delete file for deleted employee ${emp.id}: ${url}`, fileError);
                  }
              }
          }
      }
  
      toast({ title: "Duplicates Deleted", description: `${selectedForDeletion.length} record(s) have been removed.` });
      setShowDuplicatesDialog(false);
      setSelectedForDeletion([]);
      // Refresh the main table and the duplicate scan
      fetchPage(1, 'initial');
    } catch (error) {
      console.error("Error deleting duplicates:", error);
      toast({ variant: "destructive", title: "Deletion Failed", description: "Could not delete the selected records." });
    } finally {
      setIsDeletingDuplicates(false);
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
        <Button onClick={() => fetchPage(1, 'initial')} className="mt-4">Try Again</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Employee Directory</h1>
        <div className="flex items-center gap-2">
           <Button variant="outline" asChild>
              <Link href="/employees/ai-assistant">
                AI Assistant
              </Link>
           </Button>
            <Button asChild>
                <Link href="/employees/enroll">
                    <UserPlus className="mr-2 h-4 w-4" /> Enroll New Employee
                </Link>
            </Button>
        </div>
      </div>

      <Card className="shadow">
        <CardHeader>
            <CardTitle>Filters &amp; Search</CardTitle>
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
                    <TableHead>Status</TableHead>
                    <TableHead>Profile Status</TableHead>
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
                        No employees found matching your criteria.
                    </TableCell>
                    </TableRow>
                ) : (
                    employees.map((emp) => {
                     const pendingItems = getPendingDetails(emp);
                     return (
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
                                <div className="text-sm text-muted-foreground hidden sm:block">{emp.clientName}</div>
                            </div>
                            </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{emp.employeeId}</TableCell>
                        <TableCell>
                            <Badge variant={getStatusBadgeVariant(emp.status)}>{emp.status}</Badge>
                        </TableCell>
                        <TableCell>
                            {pendingItems.length === 0 ? (
                                <div className="flex items-center gap-2 text-green-600">
                                    <CheckCircle className="h-5 w-5" />
                                    <span className="hidden lg:inline">Complete</span>
                                </div>
                            ) : (
                                <Popover>
                                    <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                                        <Button variant="ghost" size="sm" className="flex items-center gap-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50 h-auto p-1">
                                            <WarningIcon className="h-5 w-5" />
                                            <span className="hidden lg:inline">{pendingItems.length} Pending</span>
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-64" onClick={(e) => e.stopPropagation()}>
                                        <div className="space-y-2">
                                            <h4 className="font-medium leading-none">Pending Items</h4>
                                            <p className="text-sm text-muted-foreground">The following items are missing from this profile:</p>
                                            <ul className="list-disc list-inside text-sm space-y-1 pt-2">
                                                {pendingItems.map(item => <li key={item}>{item}</li>)}
                                            </ul>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            )}
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
                     )
                    })}
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
                    onClick={() => fetchPage(currentPage - 1, 'prev')}
                    disabled={isTableLoading || currentPage === 1}
                >
                    Previous
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchPage(currentPage + 1, 'next')}
                    disabled={isTableLoading || employees.length &lt; ITEMS_PER_PAGE}
                >
                    Next
                </Button>
                </div>
            </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
            <CardTitle>Data Maintenance</CardTitle>
            <CardDescription>
                Use these one-time tools to update existing employee records for new features. Run them if you notice issues with older records.
            </CardDescription>
        </CardHeader>
        <CardContent>
            {isUpdating ? (
                <div className="flex flex-col gap-2">
                    <p>Updating employee data... Do not close this page.</p>
                    <Progress value={updateProgress} />
                    <p className="text-sm text-muted-foreground text-center">{Math.round(updateProgress)}%</p>
                </div>
            ) : (
                 <p className="text-sm text-muted-foreground">
                    If search isn't working for older employees or if ID proofs are not showing correctly, use the tools below.
                 </p>
            )}

        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row gap-4 items-start">
             <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="secondary" disabled={isUpdating || isScanningDuplicates}>
                        <DatabaseZap className="mr-2 h-4 w-4" />
                        Update Search Fields
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Search Update</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will process all employee records to add/update search fields. This action is safe but may incur Firestore costs. Proceed?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleUpdateSearchFields}>Confirm &amp; Update</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="secondary" disabled={isUpdating || isScanningDuplicates}>
                        <DatabaseZap className="mr-2 h-4 w-4" />
                        Migrate Old ID Proofs
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm ID Proof Migration</AlertDialogTitle>
                        <AlertDialogDescription>
                           This will copy existing ID proof documents to the new "Identity Proof" fields for all old records. It will not affect employees who have already been updated. This is a one-time migration. Proceed?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleMigrateIdProofs}>Confirm &amp; Migrate</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
             <Button variant="destructive" onClick={handleScanForDuplicates} disabled={isUpdating || isScanningDuplicates}>
                {isScanningDuplicates ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />}
                Scan for Duplicates
            </Button>
        </CardFooter>
      </Card>

      {selectedEmployeeForStatusChange &amp;&amp; (
        <AlertDialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                <AlertDialogTitle>Update Status for {selectedEmployeeForStatusChange.fullName}</AlertDialogTitle>
                <AlertDialogDescription>
                  <span>
                    You are about to change the status to <Badge variant={getStatusBadgeVariant(newStatus as Employee['status'])}>{newStatus}</Badge>.
                    {newStatus === 'Exited' &amp;&amp; " Please provide the date of exit."}
                  </span>
                </AlertDialogDescription>
                </AlertDialogHeader>
                {newStatus === 'Exited' &amp;&amp; (
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
                        {exitDate ? format(exitDate, "dd-MM-yyyy") : <span>Pick a date</span>}
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
                <AlertDialogAction onClick={handleConfirmStatusUpdate} disabled={isUpdatingStatus || (newStatus === 'Exited' &amp;&amp; !exitDate)}>
                  <span className="flex items-center justify-center">
                    {isUpdatingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirm Update
                  </span>
                </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
      )}

      {employeeToDelete &amp;&amp; (
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

      <Dialog open={showDuplicatesDialog} onOpenChange={setShowDuplicatesDialog}>
        <DialogContent className="max-w-4xl">
            <DialogHeader>
                <DialogTitle>Duplicate Records Found</DialogTitle>
                <ShadDialogDescription>
                    The following groups of employees appear to be duplicates based on matching phone numbers or emails. Please select the records you wish to delete.
                </ShadDialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto p-4 space-y-6">
                {Object.keys(duplicateGroups).length > 0 ? Object.entries(duplicateGroups).map(([key, group]) => (
                    <div key={key} className="p-4 border rounded-lg">
                        <h3 className="font-semibold mb-2 border-b pb-2">Duplicate Key: <span className="text-primary font-mono">{key.split('-')[1]}</span> ({group.length} records)</h3>
                        <div className="space-y-2">
                            {group.map(emp => (
                                <div key={emp.id} className="flex items-center gap-4 p-2 rounded-md hover:bg-muted/50">
                                    <Checkbox
                                        id={`delete-${emp.id}`}
                                        checked={selectedForDeletion.includes(emp.id)}
                                        onCheckedChange={() => handleToggleDeletion(emp.id)}
                                    />
                                    <Label htmlFor={`delete-${emp.id}`} className="flex-1 cursor-pointer">
                                        <div className="flex items-center gap-3">
                                            <Avatar>
                                                <AvatarImage src={emp.profilePictureUrl} />
                                                <AvatarFallback>{emp.fullName?.[0]}</AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="font-medium">{emp.fullName} ({emp.employeeId})</p>
                                                <p className="text-xs text-muted-foreground">{emp.clientName} | {emp.emailAddress}</p>
                                                <p className="text-xs text-muted-foreground">Created: {safeFormatDate(emp.createdAt, 'dd MMM yyyy')}</p>
                                            </div>
                                        </div>
                                    </Label>
                                </div>
                            ))}
                        </div>
                    </div>
                )) : <p className="text-muted-foreground text-center">No duplicates found.</p>}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setShowDuplicatesDialog(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleDeleteSelectedDuplicates} disabled={isDeletingDuplicates || selectedForDeletion.length === 0}>
                    {isDeletingDuplicates ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4"/>}
                    Delete Selected ({selectedForDeletion.length})
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
    