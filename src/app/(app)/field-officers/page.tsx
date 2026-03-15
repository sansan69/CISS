
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from '@/lib/firebase'; 
import { collection, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc, getDocs, addDoc, where, serverTimestamp } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2, Edit, Loader2, UserPlus, ShieldCheck, AlertCircle as AlertIcon, Wrench } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { authorizedFetch } from '@/lib/api-client';
import { KERALA_DISTRICTS } from '@/lib/constants';
import { resolveAppUser } from '@/lib/auth/roles';


interface FieldOfficer {
  id: string;
  uid: string;
  name: string;
  email: string;
  assignedDistricts: string[];
  createdAt?: any;
}

// Simplified list of auth users for dropdown (in a real app, this might be more complex)
interface AuthUser {
  uid: string;
  email: string;
  name?: string;
  customClaims?: Record<string, unknown>;
}

interface ClaimRepairHealth {
  totalMismatches: number;
  items: {
    uid: string;
    email?: string;
    expectedRole: string;
    currentRole: string | null;
    source: string;
  }[];
}


const OfficerForm: React.FC<{ 
    officer?: FieldOfficer; 
    onSave: (officerData: any, isEditing: boolean) => Promise<void>; 
    isSaving: boolean; 
    onClose: () => void;
    unavailableDistricts: string[];
    allAuthUsers: AuthUser[];
    assignedOfficerUIDs: string[];
}> = ({ officer, onSave, isSaving, onClose, unavailableDistricts, allAuthUsers, assignedOfficerUIDs }) => {
    
    const isEditing = !!officer;
    
    const [selectedUser, setSelectedUser] = useState<AuthUser | undefined>(() => 
        isEditing ? allAuthUsers.find(u => u.uid === officer.uid) : undefined
    );
    const [name, setName] = useState(officer?.name || '');
    const [assignedDistricts, setAssignedDistricts] = useState<string[]>(officer?.assignedDistricts || []);
    
    const [nameError, setNameError] = useState<string | null>(null);
    const [emailInput, setEmailInput] = useState<string>("");
    const [passwordInput, setPasswordInput] = useState<string>("");
    const [isVerifyingUser, setIsVerifyingUser] = useState(false);
    const { toast } = useToast();
    
    const availableDistricts = useMemo(() => {
        if (isEditing) {
            return KERALA_DISTRICTS.filter(d => !unavailableDistricts.includes(d) || assignedDistricts.includes(d));
        }
        return KERALA_DISTRICTS.filter(d => !unavailableDistricts.includes(d));
    }, [unavailableDistricts, isEditing, assignedDistricts]);
    
    const availableUsers = useMemo(() => {
        if (isEditing) return allAuthUsers; // Show all users when editing
        // When adding, show only users not already assigned as officers
        return allAuthUsers.filter(u => !assignedOfficerUIDs.includes(u.uid));
    }, [allAuthUsers, assignedOfficerUIDs, isEditing]);


    const validate = () => {
        let isValid = true;
        setNameError(null);

        if (!name.trim()) {
            setNameError('Officer name cannot be empty.');
            isValid = false;
        }

        if (!isEditing && !selectedUser && !(emailInput && passwordInput)) {
            isValid = false;
        }
        
        return isValid;
    };

    const handleSave = async () => {
        if (!validate()) return;
        
        let userForOfficer = selectedUser;
        
        if (!isEditing && !userForOfficer && emailInput && passwordInput) {
            setIsVerifyingUser(true);
            try {
                const response = await authorizedFetch('/api/admin/field-officers', {
                    method: 'POST',
                    body: JSON.stringify({
                        email: emailInput.trim(),
                        password: passwordInput,
                        name: name.trim(),
                        assignedDistricts,
                    }),
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(data.error || 'Could not create the field officer.');
                }
                toast({ title: 'Auth User Created', description: 'User has been added to Firebase Authentication.' });
                onClose();
                return;
            } catch (e: any) {
                console.error('Auth user creation failed:', e);
                toast({ variant: 'destructive', title: 'Creation Failed', description: e.message || 'Could not create auth user.' });
                setIsVerifyingUser(false);
                return;
            } finally {
                setIsVerifyingUser(false);
            }
        }
        
        const officerData = {
          name: name.trim(),
          assignedDistricts,
          email: userForOfficer?.email,
          uid: userForOfficer?.uid,
          ...(isEditing && { id: officer?.id })
        };
        
        onSave(officerData, isEditing);
    };

    const handleVerifyCredentials = async () => {
        if (!emailInput || !passwordInput) {
            toast({ variant: "destructive", title: "Missing Email", description: "Enter the email for the existing user account." });
            return;
        }
        setIsVerifyingUser(true);
        try {
            const matchedUser = allAuthUsers.find((user) => user.email?.toLowerCase() === emailInput.trim().toLowerCase());
            if (!matchedUser) {
                throw new Error('No Firebase Auth user exists for that email yet.');
            }
            const resolvedName = matchedUser.name || name || (matchedUser.email ? matchedUser.email.split('@')[0] : '');
            setSelectedUser({ uid: matchedUser.uid, email: matchedUser.email, name: resolvedName });
            if (!name) setName(resolvedName);
            toast({ title: "User Loaded", description: "Existing auth user found. You can assign districts now." });
        } catch (e: any) {
            console.error('Credential verification failed:', e);
            toast({ variant: 'destructive', title: 'Lookup Failed', description: e.message || 'Could not find that auth user.' });
        } finally {
            setIsVerifyingUser(false);
        }
    };

    return (
        <div className="grid gap-4 py-4">
            <div className="grid gap-2">
                <Label htmlFor="user-select">Select User</Label>
                 <select
                    id="user-select"
                    value={selectedUser?.uid || ''}
                    onChange={(e) => {
                        const user = availableUsers.find(u => u.uid === e.target.value);
                        setSelectedUser(user);
                        if (user?.name) setName(user.name);
                    }}
                    className="w-full p-2 border rounded-md bg-background"
                    disabled={isEditing}
                >
                    <option value="" disabled>{isEditing ? selectedUser?.email : "Select a user account"}</option>
                    {!isEditing && availableUsers.map(u => (
                         <option key={u.uid} value={u.uid}>{u.email}</option>
                    ))}
                </select>
                {isEditing && <p className="text-xs text-muted-foreground">User account cannot be changed after creation.</p>}
            </div>
            {!isEditing && (
                <div className="grid gap-2">
                    <Label>Or enter new/existing user credentials</Label>
                    <div className="grid grid-cols-1 gap-2">
                        <Input type="email" placeholder="user@example.com" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} />
                        <Input type="password" placeholder="Password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} />
                        <div className="flex justify-end">
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" onClick={handleVerifyCredentials} disabled={isVerifyingUser || isSaving}>
                                    {isVerifyingUser && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Verify & Load
                                </Button>
                                <Button type="button" onClick={handleSave} disabled={isVerifyingUser || isSaving}>
                                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create Auth User & Officer
                                </Button>
                            </div>
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">We use a secure secondary session to verify or create the user in Firebase Authentication. Credentials are not stored.</p>
                </div>
            )}
            <div className="grid gap-2">
                <Label htmlFor="name">Officer Display Name</Label>
                <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., John Doe"
                    className={nameError ? 'border-destructive' : ''}
                />
                {nameError && <p className="text-sm text-destructive">{nameError}</p>}
            </div>
            <div className="grid gap-2">
                <Label>Assign Districts</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-4 border rounded-md max-h-64 overflow-y-auto">
                    {availableDistricts.length > 0 ? availableDistricts.map(district => (
                        <div key={district} className="flex items-center space-x-2">
                            <Checkbox
                                id={district}
                                checked={assignedDistricts.includes(district)}
                                onCheckedChange={(checked) => setAssignedDistricts(prev => checked ? [...prev, district] : prev.filter(d => d !== district))}
                            />
                            <label htmlFor={district} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                {district}
                            </label>
                        </div>
                    )) : <p className="text-sm text-muted-foreground col-span-full">All districts are currently assigned.</p>}
                </div>
            </div>
            <DialogFooter>
                <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isEditing ? 'Update Officer' : 'Create Officer'}
                </Button>
            </DialogFooter>
        </div>
    );
};


export default function FieldOfficerManagementPage() {
  const [officers, setOfficers] = useState<FieldOfficer[]>([]);
  const [allAuthUsers, setAllAuthUsers] = useState<AuthUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOfficer, setEditingOfficer] = useState<FieldOfficer | undefined>(undefined);
  const [deletingOfficer, setDeletingOfficer] = useState<FieldOfficer | null>(null);
  
  const [authStatus, setAuthStatus] = useState<'loading' | 'admin' | 'other'>('loading');
  const [claimRepairHealth, setClaimRepairHealth] = useState<ClaimRepairHealth | null>(null);
  const [isRepairingClaims, setIsRepairingClaims] = useState(false);

  const { toast } = useToast();
  
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (!user) {
            setAuthStatus('other');
            return;
        }
        resolveAppUser(user)
            .then((appUser) => setAuthStatus(appUser.role === 'admin' ? 'admin' : 'other'))
            .catch(() => setAuthStatus('other'));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (authStatus !== 'admin') {
        if(authStatus !== 'loading') setIsLoading(false);
        return;
    }
    
    setIsLoading(true);
    
    // In a real production app with many users, this would not be efficient.
    // For this app's scale, fetching all users is acceptable.
    // A cloud function would be needed to list users efficiently and securely.
    // Simulating that fetch here.
    const fetchAllData = async () => {
        try {
            const [response, claimsResponse] = await Promise.all([
              authorizedFetch('/api/admin/auth-users'),
              authorizedFetch('/api/admin/claims/repair'),
            ]);
            const data = await response.json().catch(() => ({}));
            const claimsData = await claimsResponse.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'Could not load auth users.');
            }
            setAllAuthUsers(data.users || []);
            if (claimsResponse.ok) {
              setClaimRepairHealth(claimsData);
            }
        } catch (error) {
             console.error("Error fetching auth users (simulation): ", error);
             toast({ variant: "destructive", title: "Error", description: "Could not load user list." });
        }
    }

    fetchAllData();

    const officersQuery = query(collection(db, 'fieldOfficers'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(officersQuery, (snapshot) => {
      const fetchedOfficers = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as FieldOfficer));
      setOfficers(fetchedOfficers);
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching field officers: ", error);
      toast({
        variant: "destructive",
        title: "Error Fetching Data",
        description: "Could not load field officers.",
      });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [toast, authStatus]);
  
    const allAssignedDistricts = useMemo(() => {
        const otherOfficers = editingOfficer ? officers.filter(o => o.id !== editingOfficer.id) : officers;
        return otherOfficers.flatMap(officer => officer.assignedDistricts);
    }, [officers, editingOfficer]);

    const assignedOfficerUIDs = useMemo(() => officers.map(o => o.uid), [officers]);

  const handleSaveOfficer = async (officerData: any, isEditing: boolean) => {
    setIsSubmitting(true);
    
    try {
      if (isEditing) { // Update existing officer
        const response = await authorizedFetch(`/api/admin/field-officers/${officerData.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
                name: officerData.name,
                assignedDistricts: officerData.assignedDistricts,
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Could not update the officer.');
        }
        toast({ title: "Officer Updated", description: `"${officerData.name}" has been successfully updated.` });
      } else { // Create new officer
        const response = await authorizedFetch('/api/admin/field-officers', {
            method: 'POST',
            body: JSON.stringify({
                uid: officerData.uid,
                email: officerData.email,
                name: officerData.name,
                assignedDistricts: officerData.assignedDistricts,
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Could not create the officer.');
        }
        toast({ title: "Officer Role Assigned", description: `"${officerData.name}" is now a Field Officer.` });
      }
      closeFormDialog();
    } catch (error: any) {
      console.error("Error saving officer: ", error);
      let message = error.message || "Could not save the officer. Please try again.";
      toast({ variant: "destructive", title: "Save Failed", description: message });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleDeleteOfficer = async () => {
    if (!deletingOfficer) return;
    setIsSubmitting(true);
    
    try {
        const response = await authorizedFetch(`/api/admin/field-officers/${deletingOfficer.id}`, {
            method: 'DELETE',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Could not revoke the officer role.');
        }
      toast({
        title: "Officer Role Revoked",
        description: `"${deletingOfficer.name}" is no longer a field officer. Their login still exists.`,
      });
    } catch (error: any) {
      console.error("Error deleting officer:", error);
      toast({
        variant: "destructive",
        title: "Deletion Failed",
        description: error.message || "Could not delete the officer. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
      setDeletingOfficer(null);
    }
  };


  const openAddDialog = () => {
    setEditingOfficer(undefined);
    setIsFormOpen(true);
  }

  const openEditDialog = (officer: FieldOfficer) => {
    setEditingOfficer(officer);
    setIsFormOpen(true);
  }
  
  const closeFormDialog = () => {
      if(isSubmitting) return;
      setIsFormOpen(false);
      setEditingOfficer(undefined);
  }

  const handleRepairClaims = async () => {
    setIsRepairingClaims(true);
    try {
      const response = await authorizedFetch('/api/admin/claims/repair', {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Could not repair role claims.');
      }
      toast({
        title: 'Role claims repaired',
        description: `${data.repaired || 0} user accounts were refreshed.`,
      });
      setClaimRepairHealth({
        totalMismatches: 0,
        items: [],
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Repair failed',
        description: error.message || 'Could not repair missing role claims.',
      });
    } finally {
      setIsRepairingClaims(false);
    }
  }

  if (authStatus === 'loading' || isLoading) {
       return (
        <div className="flex justify-center items-center h-40">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
       )
  }

  if (authStatus !== 'admin') {
    return (
        <Alert variant="destructive">
            <AlertIcon className="h-4 w-4" />
            <AlertTitle>Permission Denied</AlertTitle>
            <AlertDescription>You do not have permission to manage field officers.</AlertDescription>
        </Alert>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold tracking-tight">Field Officer Management</h1>
            <Button onClick={openAddDialog}><UserPlus className="mr-2 h-4 w-4" /> Add New Officer</Button>
        </div>

        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Manage Your Field Team</AlertTitle>
          <AlertDescription>
            Assign the "Field Officer" role to existing users. You must first create a user in the Firebase Authentication console. Then, assign them here and specify which districts they can manage.
          </AlertDescription>
        </Alert>

        {claimRepairHealth && (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Role Claim Health</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <div>
                {claimRepairHealth.totalMismatches === 0
                  ? 'All mapped admins, field officers, and client users currently have the expected Firebase custom claims.'
                  : `${claimRepairHealth.totalMismatches} mapped accounts are missing their expected Firebase role claims.`}
              </div>
              {claimRepairHealth.totalMismatches > 0 && (
                <div className="flex flex-wrap gap-2">
                  {claimRepairHealth.items.slice(0, 5).map((item) => (
                    <Badge key={item.uid} variant="secondary">
                      {(item.email || item.uid)} {'->'} {item.expectedRole}
                    </Badge>
                  ))}
                  {claimRepairHealth.items.length > 5 && (
                    <Badge variant="outline">+{claimRepairHealth.items.length - 5} more</Badge>
                  )}
                </div>
              )}
              <div>
                <Button type="button" variant="outline" onClick={handleRepairClaims} disabled={isRepairingClaims}>
                  {isRepairingClaims ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}
                  Repair Missing Claims
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Field Officer List</CardTitle>
            <CardDescription>A list of all registered field officers and their assigned districts.</CardDescription>
          </CardHeader>
          <CardContent>
            {officers.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-muted-foreground">No field officers found.</p>
                <Button onClick={openAddDialog} variant="secondary" className="mt-4">Add your first officer</Button>
              </div>
            ) : (
              <div className="space-y-4">
                {officers.map((officer) => (
                  <div key={officer.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg shadow-sm">
                    <div className="flex-1 mb-3 sm:mb-0">
                      <h3 className="font-semibold text-lg">{officer.name}</h3>
                      <p className="text-sm text-muted-foreground">{officer.email}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {officer.assignedDistricts.length > 0 ? (
                            officer.assignedDistricts.map(d => <Badge key={d} variant="secondary">{d}</Badge>)
                        ) : (
                            <Badge variant="outline">No districts assigned</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 self-start sm:self-center">
                        <Button variant="outline" size="sm" onClick={() => openEditDialog(officer)}>
                            <Edit className="mr-1 h-4 w-4" /> Edit
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setDeletingOfficer(officer)}>
                            <Trash2 className="mr-1 h-4 w-4" /> Delete
                        </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          {officers.length > 0 && (
            <CardFooter>
              <p className="text-sm text-muted-foreground">Total field officers: {officers.length}</p>
            </CardFooter>
          )}
        </Card>
      </div>

    {/* Add/Edit Dialog */}
    <Dialog open={isFormOpen} onOpenChange={closeFormDialog}>
        <DialogContent className="sm:max-w-[425px]" onInteractOutside={(e) => { if(isSubmitting) e.preventDefault(); }} onEscapeKeyDown={(e) => { if(isSubmitting) e.preventDefault(); }}>
            <DialogHeader>
            <DialogTitle>{editingOfficer ? 'Edit Field Officer' : 'Add New Field Officer'}</DialogTitle>
            <DialogDescription>
                {editingOfficer ? `Update the details for ${editingOfficer.name}.` : 'Select a user and assign them districts to make them a Field Officer.'}
            </DialogDescription>
            </DialogHeader>
            <OfficerForm 
                officer={editingOfficer}
                onSave={handleSaveOfficer}
                isSaving={isSubmitting}
                onClose={closeFormDialog}
                unavailableDistricts={allAssignedDistricts}
                allAuthUsers={allAuthUsers}
                assignedOfficerUIDs={assignedOfficerUIDs}
            />
        </DialogContent>
    </Dialog>


    {/* Delete Confirmation Dialog */}
    <AlertDialog open={!!deletingOfficer} onOpenChange={(isOpen) => !isOpen && setDeletingOfficer(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you sure you want to delete this officer record?</AlertDialogTitle>
                <AlertDialogDescription>
                    This will revoke their Field Officer permissions. Their user account will NOT be deleted. 
                    <br/><br/>
                    <span className="font-bold">This action cannot be undone.</span>
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteOfficer} disabled={isSubmitting} className="bg-destructive hover:bg-destructive/90">
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirm & Delete Officer Record
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
