
"use client";

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, deleteDoc, doc, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2, Loader2, AlertCircle, ChevronLeft, Edit, UserPlus, Link as LinkIcon, Unlink } from 'lucide-react';
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
import Link from 'next/link';
import { authorizedFetch } from '@/lib/api-client';
import { PageHeader } from '@/components/layout/page-header';

interface Client {
  id: string;
  name: string;
  createdAt?: any; // Firestore Timestamp
}

export default function ClientManagementPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editedName, setEditedName] = useState('');
  const [manageClient, setManageClient] = useState<Client | null>(null);
  const [linkedUsers, setLinkedUsers] = useState<Record<string, { id: string; uid: string; email: string; name?: string }[]>>({});
  const [linkEmail, setLinkEmail] = useState('');
  const [linkPassword, setLinkPassword] = useState('');
  const [linkName, setLinkName] = useState('');
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
      const response = await authorizedFetch('/api/admin/clients', {
        method: 'POST',
        body: JSON.stringify({ name: newClientName.trim() }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not add the client.');
      }
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
      const response = await authorizedFetch(`/api/admin/clients/${clientId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not delete the client.');
      }
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

  const handleOpenEdit = (client: Client) => {
    setEditingClient(client);
    setEditedName(client.name);
  };

  const handleUpdateClient = async () => {
    if (!editingClient) return;
    if (!editedName.trim()) {
      toast({ variant: 'destructive', title: 'Invalid Name', description: 'Client name cannot be empty.' });
      return;
    }
    if (clients.some(c => c.id !== editingClient.id && c.name.toLowerCase() === editedName.trim().toLowerCase())) {
      toast({ variant: 'destructive', title: 'Duplicate Name', description: 'Another client already has this name.' });
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await authorizedFetch(`/api/admin/clients/${editingClient.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editedName.trim() }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not update the client.');
      }
      toast({ title: 'Client Updated', description: 'Name changed successfully.' });
      setEditingClient(null);
      setEditedName('');
    } catch (e) {
      console.error('Error updating client:', e);
      toast({ variant: 'destructive', title: 'Update Failed', description: 'Could not update client. Try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openManageUsers = (client: Client) => {
    setManageClient(client);
    setLinkEmail('');
    setLinkPassword('');
    setLinkName('');
    // Listen to mappings for this client
    const q = query(collection(db, 'clientUsers'), where('clientId', '==', client.id));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setLinkedUsers(prev => ({ ...prev, [client.id]: list }));
    });
    // Clean up when dialog closes
    const stop = () => unsub();
    // simple hack: store stop on window to be cleaned when closing
    (window as any).__clientUsersUnsub = stop;
  };

  const closeManageUsers = () => {
    setManageClient(null);
    const stop = (window as any).__clientUsersUnsub;
    if (typeof stop === 'function') try { stop(); } catch { /* noop */ }
  };

  const verifyAndLinkUser = async () => {
    if (!manageClient) return;
    if (!linkEmail) {
      toast({ variant: 'destructive', title: 'Missing Email', description: 'Enter the user email to link.' });
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await authorizedFetch('/api/admin/client-users', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'existing',
          clientId: manageClient.id,
          clientName: manageClient.name,
          email: linkEmail.trim(),
          name: linkName.trim(),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not link the user.');
      }
      toast({ title: 'Linked', description: 'User linked to client.' });
      setLinkEmail(''); setLinkPassword(''); setLinkName('');
    } catch (e: any) {
      console.error('Verify & Link failed:', e);
      toast({ variant: 'destructive', title: 'Link Failed', description: e.message || 'Could not find or link that user.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const createAndLinkUser = async () => {
    if (!manageClient) return;
    if (!linkEmail || !linkPassword) {
      toast({ variant: 'destructive', title: 'Missing Credentials', description: 'Enter email and password.' });
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await authorizedFetch('/api/admin/client-users', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'create',
          clientId: manageClient.id,
          clientName: manageClient.name,
          email: linkEmail.trim(),
          password: linkPassword,
          name: linkName.trim(),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not create the client user.');
      }
      toast({ title: 'User Created & Linked', description: 'Client credentials created and linked.' });
      setLinkEmail(''); setLinkPassword(''); setLinkName('');
    } catch (e: any) {
      console.error('Create & Link failed:', e);
      toast({ variant: 'destructive', title: 'Creation Failed', description: e.message || 'Could not create auth user.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const unlinkUser = async (mappingId: string) => {
    setIsSubmitting(true);
    try {
      const response = await authorizedFetch(`/api/admin/client-users/${mappingId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not remove the link.');
      }
      toast({ title: 'Unlinked', description: 'User access removed from client.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Unlink Failed', description: e.message || 'Could not remove link.' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Client Management"
        description="Maintain the client master used across enrollment, filtering, linked users, and future payroll configuration."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Settings", href: "/settings" },
          { label: "Client Management" },
        ]}
        actions={
          <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
            <Link href="/settings">
              <ChevronLeft className="mr-2 h-4 w-4" />
              <span>Back to Settings</span>
            </Link>
          </Button>
        }
      />


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
                <li key={client.id} className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-medium break-words">{client.name}</span>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => handleOpenEdit(client)}>
                      <Edit className="h-4 w-4 mr-1" /> Rename
                    </Button>
                    <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => openManageUsers(client)}>
                      <LinkIcon className="h-4 w-4 mr-1" /> Manage Logins
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm" className="w-full sm:w-auto" disabled={isSubmitting}>
                          <Trash2 className="h-4 w-4 sm:mr-0 mr-1" />
                          <span className="sm:hidden">Delete Client</span>
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
                  </div>
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

      {/* Rename Dialog */}
      <AlertDialog open={!!editingClient} onOpenChange={(open) => !open && setEditingClient(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename Client</AlertDialogTitle>
            <AlertDialogDescription>
              Update the name for <span className="font-semibold">{editingClient?.name}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="editedName">Client Name</Label>
            <Input id="editedName" value={editedName} onChange={(e) => setEditedName(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleUpdateClient} disabled={isSubmitting || !editedName.trim()}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Manage Logins Dialog */}
      <AlertDialog open={!!manageClient} onOpenChange={(open) => { if (!open) closeManageUsers(); }}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Manage Client Logins</AlertDialogTitle>
            <AlertDialogDescription>
              Link or create Firebase Authentication users who can access data for <span className="font-semibold">{manageClient?.name}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Existing Linked Users</Label>
              {manageClient && (linkedUsers[manageClient.id]?.length ? (
                <ul className="space-y-2">
                  {linkedUsers[manageClient.id]!.map(u => (
                    <li key={u.id} className="flex flex-col gap-3 rounded-md border p-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium">{u.name || u.email}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                      <Button variant="destructive" size="sm" className="w-full sm:w-auto" onClick={() => unlinkUser(u.id)} disabled={isSubmitting}>
                        <Unlink className="h-4 w-4 mr-1" /> Remove Access
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No linked users yet.</p>
              ))}
            </div>

            <div className="grid gap-2">
              <Label>Link or Create User</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Input type="email" placeholder="user@example.com" value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} />
                <Input type="password" placeholder="Password" value={linkPassword} onChange={(e) => setLinkPassword(e.target.value)} />
                <Input type="text" placeholder="Display name (optional)" value={linkName} onChange={(e) => setLinkName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" className="w-full sm:w-auto" onClick={verifyAndLinkUser} disabled={isSubmitting}><UserPlus className="h-4 w-4 mr-1" /> Verify & Link</Button>
                <Button className="w-full sm:w-auto" onClick={createAndLinkUser} disabled={isSubmitting}><UserPlus className="h-4 w-4 mr-1" /> Create & Link</Button>
              </div>
              <p className="text-xs text-muted-foreground">We use a secure secondary session to verify/create the user. Credentials are not stored.</p>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
