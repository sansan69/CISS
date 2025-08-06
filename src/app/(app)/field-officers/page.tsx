
"use client";

import React, { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase'; 
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, addDoc, deleteDoc, doc, updateDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2, Edit, Loader2, UserPlus, Users } from 'lucide-react';
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
  DialogTrigger,
  DialogClose
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';


interface FieldOfficer {
  id: string;
  name: string;
  email?: string;
  assignedDistricts: string[];
  createdAt?: any;
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
    const [errors, setErrors] = useState<{name?: string, email?: string, password?: string}>({});

    const handleDistrictChange = (district: string, checked: boolean) => {
        setAssignedDistricts(prev => 
            checked ? [...prev, district] : prev.filter(d => d !== district)
        );
    };

    const validate = () => {
        const newErrors: {name?: string, email?: string, password?: string} = {};
        if (!name.trim()) newErrors.name = 'Officer name cannot be empty.';
        if (!officer) { // Only validate email/password for new officers
            if (!email.trim()) {
                 newErrors.email = 'Email is required for new officers.';
            } else if (!/\S+@\S+\.\S+/.test(email)) {
                newErrors.email = 'Email address is invalid.';
            }
            if (!password.trim()) {
                newErrors.password = 'Password is required for new officers.';
            } else if (password.length < 6) {
                newErrors.password = 'Password must be at least 6 characters long.';
            }
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSave = () => {
        if (!validate()) return;
        
        const officerData = officer 
            ? { name, assignedDistricts } 
            : { name, email, password, assignedDistricts };
        
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
                    className={errors.name ? 'border-destructive' : ''}
                />
                {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>
             {!officer && ( // Only show for new officers
                <>
                    <div className="grid gap-2">
                        <Label htmlFor="email">Login Email</Label>
                        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="officer@example.com" className={errors.email ? 'border-destructive' : ''}/>
                        {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                    </div>
                     <div className="grid gap-2">
                        <Label htmlFor="password">Password</Label>
                        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Must be at least 6 characters" className={errors.password ? 'border-destructive' : ''}/>
                         {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
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
                                onCheckedChange={(checked) => handleDistrictChange(district, !!checked)}
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
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
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
  
  const { toast } = useToast();
  const functions = getFunctions(auth.app);

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

  const handleSaveOfficer = async (officerData: any) => {
    setIsSubmitting(true);
    try {
        if (editingOfficer) {
            // Update existing officer in Firestore (no auth changes for now)
            const officerDocRef = doc(db, 'fieldOfficers', editingOfficer.id);
            await updateDoc(officerDocRef, {
                name: officerData.name.trim(),
                assignedDistricts: officerData.assignedDistricts,
                updatedAt: serverTimestamp(),
            });
            toast({ title: "Officer Updated", description: `"${officerData.name.trim()}" has been successfully updated.` });
        } else {
            // Add new officer by calling the cloud function
            const createFieldOfficer = httpsCallable(functions, 'createFieldOfficer');
            const result = await createFieldOfficer(officerData);
            console.log('Cloud function result:', result.data);
            toast({ title: "Officer Added", description: `"${officerData.name.trim()}" has been successfully added with login credentials.` });
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
    // Note: This only deletes the Firestore record, not the Auth user.
    // A more complete solution would involve a Cloud Function to delete both.
    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, 'fieldOfficers', deletingOfficer.id));
      toast({ title: "Officer Deleted", description: `"${deletingOfficer.name}" has been successfully deleted from the list.` });
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

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold tracking-tight">Field Officer Management</h1>
            <Button onClick={openAddDialog}><UserPlus className="mr-2 h-4 w-4" /> Add New Officer</Button>
        </div>

        <Alert>
          <Users className="h-4 w-4" />
          <AlertTitle>Manage Your Field Team</AlertTitle>
          <AlertDescription>
            Add your field officers, create their login credentials, and assign them to specific districts.
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
                    <div>
                      <h3 className="font-semibold text-lg">{officer.name}</h3>
                       {officer.email && <p className="text-sm text-muted-foreground">{officer.email}</p>}
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
                {editingOfficer ? `Update the details for ${editingOfficer.name}.` : 'Enter the details and create login credentials for the new officer.'}
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
                    This action will delete the field officer "{deletingOfficer?.name}" from the list. It will NOT delete their login account. That must be done from the Firebase Console.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteOfficer} disabled={isSubmitting} className="bg-destructive hover:bg-destructive/90">
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirm Delete
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
