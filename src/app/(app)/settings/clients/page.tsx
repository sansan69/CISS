"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  getDocs,
} from "firebase/firestore";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, Building2, MapPin, ChevronRight, Loader2 } from "lucide-react";
import { authorizedFetch } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { siteBelongsToClient } from "@/lib/sites/site-directory";
import { buildClientPortalUrl, slugifyPortalSubdomain } from "@/lib/client-portal";

interface ClientRow {
  id: string;
  name: string;
  siteCount?: number;
  locationCount?: number;
  portalSubdomain?: string;
  portalEnabled?: boolean;
  portalUrl?: string | null;
}

export default function ClientsPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPortalSubdomain, setNewPortalSubdomain] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "clients"), orderBy("name", "asc"));
    const unsub = onSnapshot(q, async (snap) => {
      const rows: ClientRow[] = snap.docs.map((d) => ({
        id: d.id,
        name: (d.data().name as string) || d.data().clientName || "",
        portalSubdomain: typeof d.data().portalSubdomain === "string" ? d.data().portalSubdomain : "",
        portalEnabled: d.data().portalEnabled !== false,
        portalUrl: buildClientPortalUrl(typeof d.data().portalSubdomain === "string" ? d.data().portalSubdomain : ""),
      }));

      // Fetch site + location counts in parallel for all clients
      const [allSitesSnap, allLocationsSnap] = await Promise.all([
        getDocs(collection(db, "sites")),
        getDocs(collection(db, "clientLocations")),
      ]);
      const withCounts = await Promise.all(
        rows.map(async (client) => {
          const siteCount = allSitesSnap.docs.filter((doc) => {
            const data = doc.data() as { clientId?: string; clientName?: string };
            return siteBelongsToClient(data, client.id, client.name);
          }).length;
          const locationCount = allLocationsSnap.docs.filter((doc) => {
            const data = doc.data() as { clientId?: string; clientName?: string };
            return siteBelongsToClient(data as any, client.id, client.name);
          }).length;
          return {
            ...client,
            siteCount,
            locationCount,
          };
        })
      );

      setClients(withCounts);
      setIsLoading(false);
    });
    return () => unsub();
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setIsSaving(true);
    try {
      const res = await authorizedFetch("/api/admin/clients", {
        method: "POST",
        body: JSON.stringify({ name, portalSubdomain: newPortalSubdomain || name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create client");
      toast({ title: "Client created", description: `${name} has been added.` });
      setDialogOpen(false);
      setNewName("");
      setNewPortalSubdomain("");
      // Navigate to the new client's dashboard
      if (data.id) router.push(`/settings/clients/${data.id}`);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Settings"
        title="Clients & Sites"
        description="Manage client organisations and their duty sites."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Settings", href: "/settings" },
          { label: "Clients & Sites" },
        ]}
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Client
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No clients yet. Create one to get started.
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New Client
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => (
            <Card
              key={client.id}
              className="cursor-pointer hover:shadow-md transition-shadow group"
              onClick={() => router.push(`/settings/clients/${client.id}`)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-snug">
                    {client.name}
                  </CardTitle>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </CardHeader>
              <CardContent className="flex gap-3 pt-0">
                <Badge variant="secondary" className="gap-1 text-xs">
                  <MapPin className="h-3 w-3" />
                  {client.siteCount ?? 0} site{client.siteCount !== 1 ? "s" : ""}
                </Badge>
                <Badge variant="outline" className="gap-1 text-xs">
                  <Building2 className="h-3 w-3" />
                  {client.locationCount ?? 0} office
                  {client.locationCount !== 1 ? "s" : ""}
                </Badge>
                {client.portalSubdomain ? (
                  <Badge variant={client.portalEnabled ? "default" : "secondary"} className="gap-1 text-xs">
                    {client.portalSubdomain}.cisskerala.site
                  </Badge>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label>Client Name *</Label>
              <Input
                placeholder="e.g. TCS Kochi"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Portal Subdomain *</Label>
              <Input
                placeholder="e.g. logiware"
                value={newPortalSubdomain}
                onChange={(e) => setNewPortalSubdomain(slugifyPortalSubdomain(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Portal URL: {buildClientPortalUrl(newPortalSubdomain || newName) || "https://client.cisskerala.site"}
              </p>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isSaving || !newName.trim()}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create & Open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
