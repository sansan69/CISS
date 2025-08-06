
"use client";

import React, { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase'; 
import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, addDoc, deleteDoc, doc, updateDoc, onSnapshot, query, orderBy, serverTimestamp, getDocs, where } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2, Edit, Loader2, UserPlus, Users, Eye, ShieldCheck, AlertCircle as AlertIcon } from 'lucide-react';
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
  DialogClose
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { onAuthStateChanged, type User } from 'firebase/auth';


interface FieldOfficer {
  id: string;
  name: string;
  email: string;
  assignedDistricts: string[];
  createdAt?: any;
  uid?: string;
}

const keralaDistricts = [
  "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha",
  "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad",
  "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod"
];


const OfficerForm: React.FC<{ officer?: FieldOfficer; onSave: (officerData: any) => Promise<void>; isSaving: boolean; }> = ({ officer, onSave, isSaving }) => {
    const [name, setName] = useState(officer?.name || '');
    const [email, setEmail] = useState(officer?.email || '');
    const [password, setPassword] = useState('');
    const [assignedDistricts, setAssignedDistricts] = useState<string[]>(officer?.assignedDistricts || []);
    
    const [nameError, setNameError] = useState<string | null>(null);
    const [emailError, setEmailError] = useState<string | null>(null);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    
    const isEditing = !!officer;

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
          ...(!isEditing && { email: email.trim(), password })
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
            {!isEditing && (
              <>
                <div className="grid gap-2">
                    <Label htmlFor="email">Login Email</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="officer@email.com" className={emailError ? 'border-destructive' : ''} />
                    {emailError && <p className="text-sm text-destructive">{emailError}</p>}
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" className={passwordError ? 'border-destructive' : ''} />
                    {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
                </div>
              </>
            )}
            <div className="grid gap-2">
                <Label>Assign Districts</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-4 border rounded-md max-h-64 overflow-y-auto">
                    {keralaDistricts.map(district => (
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
                    ))}
                </div>
            </div>
            <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="secondary">Cancel</Button>
                </DialogClose>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Officer
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
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const tokenResult = await user.getIdTokenResult();
        setIsSuperAdmin(tokenResult.claims.superAdmin === true);
      } else {
        setIsSuperAdmin(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setIsLoading(true);
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
        description: "Could not load field officers. Please try again later.",
      });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);

  const handleSaveOfficer = async (officerData: {name: string, email?: string, password?: string, assignedDistricts: string[]}) => {
    setIsSubmitting(true);
    try {
        if (editingOfficer) {
            // Update existing officer's name and districts
            const officerDocRef = doc(db, 'fieldOfficers', editingOfficer.id);
            await updateDoc(officerDocRef, {
                name: officerData.name,
                assignedDistricts: officerData.assignedDistricts,
                updatedAt: serverTimestamp(),
            });
            toast({ title: "Officer Updated", description: `"${officerData.name}" has been successfully updated.` });
        } else {
            // Add new officer by calling the Cloud Function
            const functions = getFunctions();
            const createFieldOfficer = httpsCallable(functions, 'createFieldOfficer');
            await createFieldOfficer(officerData);
            toast({ title: "Officer Added", description: `"${officerData.name}" has been successfully created.` });
        }
        setIsFormOpen(false);
        setEditingOfficer(undefined);

    } catch (error: any) {
      console.error("Error saving officer: ", error);
      toast({ variant: "destructive", title: "Save Failed", description: error.message || "Could not save the officer. Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteOfficer = async () => {
    if (!deletingOfficer) return;
    setIsSubmitting(true);
    try {
      // Note: This only deletes the Firestore record. The Auth user still exists.
      // A proper implementation would require another Cloud Function to delete the Auth user.
      await deleteDoc(doc(db, 'fieldOfficers', deletingOfficer.id));
      toast({ title: "Officer Record Deleted", description: `"${deletingOfficer.name}"'s record has been deleted.` });
    } catch (error) {
      console.error("Error deleting officer: ", error);
      toast({ variant: "destructive", title: "Error Deleting Officer", description: "Could not delete the officer. Please try again." });
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

  if (!isSuperAdmin) {
    return (
        <Alert variant="destructive">
            <AlertIcon className="h-4 w-4" />
            <AlertTitle>Permission Denied</AlertTitle>
            <AlertDescription>You must be a super admin to manage field officers.</AlertDescription>
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
            Add your field officers and assign them to specific districts. This will create a login for them and restrict their data access to only their assigned areas.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Field Officer List</CardTitle>
            <CardDescription>A list of all registered field officers and their assigned districts.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center h-40">
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
                    <div className="flex-1">
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
                    <div className="flex gap-2 mt-3 sm:mt-0">
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
    <Dialog open={isFormOpen} onOpenChange={(open) => { if (!open) { setIsFormOpen(false); setEditingOfficer(undefined); }}}>
        <DialogContent className="sm:max-w-[425px]">
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
            />
        </DialogContent>
    </Dialog>


    {/* Delete Confirmation Dialog */}
    <AlertDialog open={!!deletingOfficer} onOpenChange={() => setDeletingOfficer(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This action will delete the field officer's record from this list. It will NOT delete their login credentials. This must be done manually in the Firebase console for security reasons.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteOfficer} disabled={isSubmitting} className="bg-destructive hover:bg-destructive/90">
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirm Delete
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
