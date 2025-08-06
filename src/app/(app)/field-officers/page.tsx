
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db, auth } from '@/lib/firebase'; 
import { collection, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from "firebase/functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2, Edit, Loader2, UserPlus, ShieldCheck, AlertCircle as AlertIcon } from 'lucide-react';
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


interface FieldOfficer {
  id: string;
  uid: string;
  name: string;
  email: string;
  assignedDistricts: string[];
  createdAt?: any;
}

const keralaDistricts = [
  "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha",
  "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad",
  "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod"
];


const OfficerForm: React.FC<{ 
    officer?: FieldOfficer; 
    onSave: (officerData: any) => Promise<void>; 
    isSaving: boolean; 
    onClose: () => void;
    unavailableDistricts: string[];
}> = ({ officer, onSave, isSaving, onClose, unavailableDistricts }) => {
    const [name, setName] = useState(officer?.name || '');
    const [email, setEmail] = useState(officer?.email || '');
    const [password, setPassword] = useState('');
    const [assignedDistricts, setAssignedDistricts] = useState<string[]>(officer?.assignedDistricts || []);
    
    const [nameError, setNameError] = useState<string | null>(null);
    const [emailError, setEmailError] = useState<string | null>(null);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    
    const isEditing = !!officer;

    const availableDistricts = useMemo(() => {
        if (isEditing) {
            // In edit mode, the user can see their own districts plus any unassigned ones
            return keralaDistricts.filter(d => !unavailableDistricts.includes(d) || assignedDistricts.includes(d));
        }
        // In add mode, they can only see unassigned districts
        return keralaDistricts.filter(d => !unavailableDistricts.includes(d));
    }, [unavailableDistricts, isEditing, assignedDistricts]);


    const validate = () => {
        let isValid = true;
        setNameError(null);
        setEmailError(null);
        setPasswordError(null);

        if (!name.trim()) {
            setNameError('Officer name cannot be empty.');
            isValid = false;
        }

        if (!isEditing) {
            if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
                setEmailError('Please enter a valid email address.');
                isValid = false;
            }
            if (password.length < 6) {
                setPasswordError('Password must be at least 6 characters long.');
                isValid = false;
            }
        }
        
        return isValid;
    };

    const handleSave = () => {
        if (!validate()) return;
        
        const officerData = {
          name: name.trim(),
          assignedDistricts,
          ...(!isEditing && { email: email.trim(), password }),
          ...(isEditing && { uid: officer.uid, id: officer.id })
        };
        
        onSave(officerData);
    };

    return (
        <div className="grid gap-4 py-4">
            <div className="grid gap-2">
                <Label htmlFor="name">Officer Name</Label>
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
                <Label htmlFor="email">Login Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="officer@email.com" className={emailError ? 'border-destructive' : ''} disabled={isEditing} />
                {isEditing && <p className="text-xs text-muted-foreground">Email cannot be changed after creation.</p>}
                {emailError && <p className="text-sm text-destructive">{emailError}</p>}
            </div>
            {!isEditing && (
              <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" className={passwordError ? 'border-destructive' : ''} />
                  {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
              </div>
            )}
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
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOfficer, setEditingOfficer] = useState<FieldOfficer | undefined>(undefined);
  const [deletingOfficer, setDeletingOfficer] = useState<FieldOfficer | null>(null);
  
  const [authStatus, setAuthStatus] = useState<'loading' | 'admin' | 'other'>('loading');

  const { toast } = useToast();
  
  const checkAdminStatus = useCallback((user: User | null) => {
    if (user) {
      if (user.email === 'admin@cisskerala.app') {
        setAuthStatus('admin');
      } else {
        setAuthStatus('other');
      }
    } else {
      setAuthStatus('other');
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
        checkAdminStatus(user);
    });
    return () => unsubscribe();
  }, [checkAdminStatus]);

  useEffect(() => {
    if (authStatus !== 'admin') {
        if(authStatus !== 'loading') setIsLoading(false);
        return;
    }
    setIsLoading(true);
    const officersQuery = query(collection(db, 'fieldOfficers'), orderBy('createdAt', 'desc'));
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
        description: "Could not load field officers. Please try again later.",
      });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [toast, authStatus]);
  
    const allAssignedDistricts = useMemo(() => {
        const otherOfficers = editingOfficer ? officers.filter(o => o.id !== editingOfficer.id) : officers;
        return otherOfficers.flatMap(officer => officer.assignedDistricts);
    }, [officers, editingOfficer]);

  const handleSaveOfficer = async (officerData: any) => {
    setIsSubmitting(true);
    const functions = getFunctions(auth.app);
    
    try {
      if (officerData.id) { // Update existing officer
        const updateOfficer = httpsCallable(functions, 'updateFieldOfficer');
        await updateOfficer({ 
            uid: officerData.uid, 
            name: officerData.name, 
            assignedDistricts: officerData.assignedDistricts 
        });
        toast({ title: "Officer Updated", description: `"${officerData.name}" has been successfully updated.` });
      } else { // Create new officer
        const createOfficer = httpsCallable(functions, 'createFieldOfficer');
        await createOfficer({
            email: officerData.email,
            password: officerData.password,
            name: officerData.name,
            assignedDistricts: officerData.assignedDistricts,
        });
        toast({ title: "Officer Created", description: `Login credentials sent to "${officerData.email}".` });
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
    const functions = getFunctions(auth.app);

    try {
      const deleteOfficer = httpsCallable(functions, 'deleteFieldOfficer');
      await deleteOfficer({ uid: deletingOfficer.uid });
      toast({
        title: "Officer Deleted",
        description: `Login and records for "${deletingOfficer.name}" have been permanently deleted.`,
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

  if (authStatus === 'loading') {
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
            Add new Field Officers with their own logins. Assign them to specific districts to control which employees and sites they can see and manage.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Field Officer List</CardTitle>
            <CardDescription>A list of all registered field officers and their assigned districts.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
                <div className="flex justify-center items-center h-20">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : officers.length === 0 ? (
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
                {editingOfficer ? `Update the details for ${editingOfficer.name}.` : 'Enter the details to create a new officer and their login.'}
            </DialogDescription>
            </DialogHeader>
            <OfficerForm 
                officer={editingOfficer}
                onSave={handleSaveOfficer}
                isSaving={isSubmitting}
                onClose={closeFormDialog}
                unavailableDistricts={allAssignedDistricts}
            />
        </DialogContent>
    </Dialog>


    {/* Delete Confirmation Dialog */}
    <AlertDialog open={!!deletingOfficer} onOpenChange={(isOpen) => !isOpen && setDeletingOfficer(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you sure you want to delete this officer?</AlertDialogTitle>
                <AlertDialogDescription>
                    This will permanently delete the officer's login account and their record from the database. 
                    <br/><br/>
                    <span className="font-bold">This action cannot be undone.</span>
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteOfficer} disabled={isSubmitting} className="bg-destructive hover:bg-destructive/90">
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirm & Delete Officer
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
