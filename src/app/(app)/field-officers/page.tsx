
"use client";

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
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
  assignedDistricts: string[];
  createdAt?: any;
}

const keralaDistricts = [
  "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha",
  "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad",
  "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod"
];


const OfficerForm: React.FC<{ officer?: FieldOfficer; onSave: (name: string, districts: string[]) => Promise<void>; isSaving: boolean; }> = ({ officer, onSave, isSaving }) => {
    const [name, setName] = useState(officer?.name || '');
    const [assignedDistricts, setAssignedDistricts] = useState<string[]>(officer?.assignedDistricts || []);
    const [nameError, setNameError] = useState('');

    const handleDistrictChange = (district: string, checked: boolean) => {
        setAssignedDistricts(prev => 
            checked ? [...prev, district] : prev.filter(d => d !== district)
        );
    };

    const handleSave = () => {
        if (!name.trim()) {
            setNameError('Officer name cannot be empty.');
            return;
        }
        setNameError('');
        onSave(name, assignedDistricts);
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

  const handleSaveOfficer = async (name: string, assignedDistricts: string[]) => {
    setIsSubmitting(true);
    try {
        if (editingOfficer) {
            // Update existing officer
            const officerDocRef = doc(db, 'fieldOfficers', editingOfficer.id);
            await updateDoc(officerDocRef, {
                name: name.trim(),
                assignedDistricts: assignedDistricts,
                updatedAt: serverTimestamp(),
            });
            toast({ title: "Officer Updated", description: `"${name.trim()}" has been successfully updated.` });
        } else {
            // Add new officer
            await addDoc(collection(db, 'fieldOfficers'), {
                name: name.trim(),
                assignedDistricts: assignedDistricts,
                createdAt: serverTimestamp(),
            });
            toast({ title: "Officer Added", description: `"${name.trim()}" has been successfully added.` });
        }
        setIsFormOpen(false);
        setEditingOfficer(undefined);

    } catch (error) {
      console.error("Error saving officer: ", error);
      toast({ variant: "destructive", title: "Save Failed", description: "Could not save the officer. Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteOfficer = async () => {
    if (!deletingOfficer) return;

    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, 'fieldOfficers', deletingOfficer.id));
      toast({ title: "Officer Deleted", description: `"${deletingOfficer.name}" has been successfully deleted.` });
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
            Add your field officers and assign them to specific districts. This information can be used later for assignments and reporting.
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
                {editingOfficer ? `Update the details for ${editingOfficer.name}.` : 'Enter the details for the new officer.'}
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
                    This action cannot be undone. This will permanently delete the field officer "{deletingOfficer?.name}".
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

    