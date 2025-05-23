
"use client";

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2, Loader2, AlertCircle } from 'lucide-react';
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface Client {
  id: string;
  name: string;
  createdAt?: any; // Firestore Timestamp
}

export default function ClientManagementPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setIsLoading(true);
    const clientsQuery = query(collection(db, 'clients'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(clientsQuery, (snapshot) => {
      const fetchedClients = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Client));
      setClients(fetchedClients);
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching clients: ", error);
      toast({
        variant: "destructive",
        title: "Error Fetching Clients",
        description: "Could not load client data. Please try again later.",
      });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);

  const handleAddClient = async () => {
    if (!newClientName.trim()) {
      toast({
        variant: "destructive",
        title: "Invalid Name",
        description: "Client name cannot be empty.",
      });
      return;
    }
    if (clients.some(client => client.name.toLowerCase() === newClientName.trim().toLowerCase())) {
      toast({
        variant: "destructive",
        title: "Client Exists",
        description: "A client with this name already exists.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'clients'), {
        name: newClientName.trim(),
        createdAt: serverTimestamp(),
      });
      toast({
        title: "Client Added",
        description: `Client "${newClientName.trim()}" has been successfully added.`,
      });
      setNewClientName('');
    } catch (error) {
      console.error("Error adding client: ", error);
      toast({
        variant: "destructive",
        title: "Error Adding Client",
        description: "Could not add the client. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClient = async (clientId: string, clientName: string) => {
    setIsSubmitting(true); // Use same state for general operations
    try {
      await deleteDoc(doc(db, 'clients', clientId));
      toast({
        title: "Client Deleted",
        description: `Client "${clientName}" has been successfully deleted.`,
      });
    } catch (error) {
      console.error("Error deleting client: ", error);
      toast({
        variant: "destructive",
        title: "Error Deleting Client",
        description: "Could not delete the client. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Client Management</h1>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Important Notes</AlertTitle>
        <AlertDescription>
          Manage the list of client companies. This list will be used in employee enrollment and filtering.
          Deleting a client here will remove it from the selection options, but will not automatically update existing employee records associated with that client name.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Add New Client</CardTitle>
          <CardDescription>Enter the name of the new client company.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-2 items-end">
            <div className="flex-grow">
              <Label htmlFor="newClientName">Client Name</Label>
              <Input
                id="newClientName"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Enter client company name"
                disabled={isSubmitting}
              />
            </div>
            <Button onClick={handleAddClient} disabled={isSubmitting || !newClientName.trim()} className="w-full sm:w-auto">
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
              Add Client
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing Clients</CardTitle>
          <CardDescription>List of currently managed client companies.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-2 text-muted-foreground">Loading clients...</p>
            </div>
          ) : clients.length === 0 ? (
            <p className="text-muted-foreground">No clients added yet. Use the form above to add your first client.</p>
          ) : (
            <ul className="space-y-3">
              {clients.map((client) => (
                <li key={client.id} className="flex items-center justify-between p-3 border rounded-md shadow-sm bg-muted/20">
                  <span className="font-medium">{client.name}</span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm" disabled={isSubmitting}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete the client "{client.name}"? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeleteClient(client.id, client.name)} disabled={isSubmitting}>
                          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Confirm Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        {clients.length > 0 && (
          <CardFooter>
            <p className="text-sm text-muted-foreground">Total clients: {clients.length}</p>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
