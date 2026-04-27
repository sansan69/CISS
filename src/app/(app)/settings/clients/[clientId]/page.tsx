"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  GeoPoint,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { LocationEditorCard } from "@/components/location/location-editor-card";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  MapPin,
  Building2,
  Users,
  Loader2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { authorizedFetch } from "@/lib/api-client";
import { buildClientPortalUrl, slugifyPortalSubdomain } from "@/lib/client-portal";
import type { BatchGeocodeResult } from "@/app/api/admin/sites/batch-geocode/route";
import { useToast } from "@/hooks/use-toast";
import { KERALA_DISTRICTS, DEFAULT_GEOFENCE_RADIUS_METERS } from "@/lib/constants";
import { buildFirestoreCreateAudit, buildFirestoreUpdateAudit } from "@/lib/firestore-audit";
import { coordinateStatusLabels, formatCoordinate } from "@/lib/location-utils";
import { extractSiteCoordinates, hasUsableSiteGps } from "@/lib/site-gps-repair";
import { siteBelongsToClient, sortSitesByName } from "@/lib/sites/site-directory";
import type { CoordinateSource, CoordinateStatus, GeoPointLike, SiteType } from "@/types/location";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientDoc {
  id: string;
  name: string;
  portalSubdomain?: string;
  portalEnabled?: boolean;
  uniformAllowanceMonthly?: number;
  fieldAllowanceMonthly?: number;
  nationalHolidayList?: string[];
}

interface SiteDoc {
  id: string;
  siteName: string;
  siteAddress?: string;
  district?: string;
  geofenceRadiusMeters?: number;
  strictGeofence?: boolean;
  coordinateStatus?: string;
  coordinateSource?: CoordinateSource | string | null;
  placeAccuracy?: string | null;
  geolocation?: {
    latitude?: number;
    longitude?: number;
    lat?: number;
    lng?: number;
    _latitude?: number;
    _longitude?: number;
  };
  latString?: string;
  lngString?: string;
  siteType?: SiteType | string | null;
  createdAt?: any;
}

interface LocationDoc {
  id: string;
  locationName: string;
  address?: string;
  district?: string;
  geofenceRadiusMeters?: number;
  strictGeofence?: boolean;
  coordinateStatus?: string;
  coordinateSource?: CoordinateSource | string | null;
  placeAccuracy?: string | null;
  geolocation?: {
    latitude?: number;
    longitude?: number;
    lat?: number;
    lng?: number;
    _latitude?: number;
    _longitude?: number;
  };
  latString?: string;
  lngString?: string;
  siteType?: SiteType | string | null;
  createdAt?: any;
}

interface ClientUser {
  id: string;
  email: string;
  name?: string;
  uid?: string;
}

// ─── Blank form states ─────────────────────────────────────────────────────

const BLANK_SITE = {
  siteName: "",
  siteAddress: "",
  district: "",
  geofenceRadiusMeters: DEFAULT_GEOFENCE_RADIUS_METERS,
  strictGeofence: true,
  siteType: "site" as SiteType,
  geolocation: undefined as GeoPointLike | undefined,
  latString: "",
  lngString: "",
  coordinateStatus: "missing" as CoordinateStatus,
  coordinateSource: undefined as CoordinateSource | undefined,
  placeAccuracy: null as string | null,
};

const BLANK_LOCATION = {
  locationName: "",
  address: "",
  district: "",
  geofenceRadiusMeters: DEFAULT_GEOFENCE_RADIUS_METERS,
  strictGeofence: true,
  siteType: "main" as SiteType,
  geolocation: undefined as GeoPointLike | undefined,
  latString: "",
  lngString: "",
  coordinateStatus: "missing" as CoordinateStatus,
  coordinateSource: undefined as CoordinateSource | undefined,
  placeAccuracy: null as string | null,
};

const SITE_TYPE_OPTIONS: Array<{ value: SiteType; label: string }> = [
  { value: "site", label: "Site" },
  { value: "branch", label: "Branch" },
  { value: "main", label: "Main Office" },
];

const LOCATION_TYPE_OPTIONS: Array<{ value: SiteType; label: string }> = [
  { value: "main", label: "Main Office" },
  { value: "branch", label: "Branch Office" },
];

const SITE_TYPE_LABELS: Record<string, string> = {
  site: "Site",
  branch: "Branch",
  main: "Main Office",
};

function normalizeGeoPoint(
  record: Pick<SiteDoc | LocationDoc, "geolocation" | "latString" | "lngString">,
) {
  const coordinates = extractSiteCoordinates(record);
  if (!coordinates) return undefined;
  return {
    latitude: coordinates.lat,
    longitude: coordinates.lng,
  } satisfies GeoPointLike;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClientDashboardPage() {
  const params = useParams();
  const clientId = params.clientId as string;
  const router = useRouter();
  const { toast } = useToast();

  // ── Client ──
  const [client, setClient] = useState<ClientDoc | null>(null);
  const [clientLoading, setClientLoading] = useState(true);

  // ── Sites ──
  const [sites, setSites] = useState<SiteDoc[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);

  // ── Locations ──
  const [locations, setLocations] = useState<LocationDoc[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);

  // ── Users ──
  const [users, setUsers] = useState<ClientUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  // ── Dialogs ──
  const [siteDialog, setSiteDialog] = useState<"create" | "edit" | null>(null);
  const [editingSite, setEditingSite] = useState<SiteDoc | null>(null);
  const [siteForm, setSiteForm] = useState(BLANK_SITE);
  const [savingSite, setSavingSite] = useState(false);
  const [deleteSiteTarget, setDeleteSiteTarget] = useState<SiteDoc | null>(null);

  const [locationDialog, setLocationDialog] = useState<"create" | "edit" | null>(null);
  const [editingLocation, setEditingLocation] = useState<LocationDoc | null>(null);
  const [locationForm, setLocationForm] = useState(BLANK_LOCATION);
  const [savingLocation, setSavingLocation] = useState(false);
  const [deleteLocationTarget, setDeleteLocationTarget] = useState<LocationDoc | null>(null);

  const [clientEditDialog, setClientEditDialog] = useState(false);
  const [clientForm, setClientForm] = useState({ name: "", portalSubdomain: "", portalEnabled: true });
  const [savingClient, setSavingClient] = useState(false);
  const [deleteClientDialog, setDeleteClientDialog] = useState(false);
  const [runningGpsRepair, setRunningGpsRepair] = useState(false);

  // ── Subscriptions ──

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "clients", clientId), (snap) => {
      if (!snap.exists()) {
        router.replace("/settings/clients");
        return;
      }
      const d = snap.data();
      setClient({ id: snap.id, name: d.name || d.clientName || "", ...d } as ClientDoc);
      setClientLoading(false);
    });
    return () => unsub();
  }, [clientId, router]);

  useEffect(() => {
    if (!client?.name) return;

    const unsub = onSnapshot(
      collection(db, "sites"),
      (snap) => {
        const nextSites = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as SiteDoc))
          .filter((site) => siteBelongsToClient(site as any, clientId, client.name));
        setSites(sortSitesByName(nextSites as any));
        setSitesLoading(false);
      },
      () => {
        setSites([]);
        setSitesLoading(false);
      },
    );
    return () => unsub();
  }, [client?.name, clientId]);

  useEffect(() => {
    if (!client?.name) return;

    const unsub = onSnapshot(
      collection(db, "clientLocations"),
      (snap) => {
        const nextLocations = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as LocationDoc))
          .filter((location) => siteBelongsToClient(location as any, clientId, client.name));
        setLocations(nextLocations.sort((a, b) => a.locationName.localeCompare(b.locationName)));
        setLocationsLoading(false);
      },
      () => {
        setLocations([]);
        setLocationsLoading(false);
      },
    );
    return () => unsub();
  }, [client?.name, clientId]);

  useEffect(() => {
    const q = query(
      collection(db, "clientUsers"),
      where("clientId", "==", clientId)
    );
    const unsub = onSnapshot(q, (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClientUser)));
      setUsersLoading(false);
    });
    return () => unsub();
  }, [clientId]);

  // ── Client CRUD ──

  const openClientEdit = () => {
    if (!client) return;
    setClientForm({
      name: client.name,
      portalSubdomain: client.portalSubdomain || "",
      portalEnabled: client.portalEnabled !== false,
    });
    setClientEditDialog(true);
  };

  const handleSaveClient = async () => {
    if (!clientForm.name.trim()) return;
    setSavingClient(true);
    try {
      const res = await authorizedFetch(`/api/admin/clients/${clientId}`, {
        method: "PATCH",
        body: JSON.stringify(clientForm),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast({ title: "Client updated" });
      setClientEditDialog(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setSavingClient(false);
    }
  };

  const handleDeleteClient = async () => {
    try {
      const res = await authorizedFetch(`/api/admin/clients/${clientId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to delete");
      }
      toast({ title: "Client deleted" });
      router.replace("/settings/clients");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Cannot delete client", description: err.message });
    }
  };

  // ── Site CRUD ──

  const openCreateSite = () => {
    setSiteForm(BLANK_SITE);
    setEditingSite(null);
    setSiteDialog("create");
  };

  const openEditSite = (site: SiteDoc) => {
    setEditingSite(site);
    setSiteForm({
      siteName: site.siteName,
      siteAddress: site.siteAddress || "",
      district: site.district || "",
      geofenceRadiusMeters: site.geofenceRadiusMeters ?? DEFAULT_GEOFENCE_RADIUS_METERS,
      strictGeofence: site.strictGeofence !== false,
      siteType: (site.siteType as SiteType | undefined) ?? "site",
      geolocation: normalizeGeoPoint(site),
      latString: site.latString || "",
      lngString: site.lngString || "",
      coordinateStatus: (site.coordinateStatus as CoordinateStatus | undefined) ?? "missing",
      coordinateSource: (site.coordinateSource as CoordinateSource | undefined) ?? undefined,
      placeAccuracy: site.placeAccuracy ?? null,
    });
    setSiteDialog("edit");
  };

  const buildCoordinatePayload = (form: {
    geolocation?: GeoPointLike;
    latString?: string;
    lngString?: string;
    coordinateStatus?: CoordinateStatus;
    coordinateSource?: CoordinateSource;
    placeAccuracy?: string | null;
  }) => {
    if (!form.geolocation) {
      return {
        geolocation: null,
        latString: "",
        lngString: "",
        coordinateStatus: "missing" as CoordinateStatus,
        coordinateSource: null,
        placeAccuracy: null,
      };
    }

    return {
      geolocation: new GeoPoint(form.geolocation.latitude, form.geolocation.longitude),
      latString: form.latString || formatCoordinate(form.geolocation.latitude),
      lngString: form.lngString || formatCoordinate(form.geolocation.longitude),
      coordinateStatus: form.coordinateStatus ?? "verified",
      coordinateSource: form.coordinateSource ?? "manual",
      placeAccuracy: form.placeAccuracy ?? null,
    };
  };

  const handleSaveSite = async () => {
    if (!siteForm.siteName.trim() || !siteForm.district.trim()) return;
    setSavingSite(true);
    try {
      const coordinatePatch = buildCoordinatePayload(siteForm);
      if (siteDialog === "create") {
        await addDoc(collection(db, "sites"), {
          clientId,
          clientName: client?.name ?? "",
          siteName: siteForm.siteName.trim(),
          siteAddress: siteForm.siteAddress.trim(),
          district: siteForm.district.trim(),
          geofenceRadiusMeters: siteForm.geofenceRadiusMeters,
          strictGeofence: siteForm.strictGeofence,
          siteType: siteForm.siteType,
          shiftMode: "none",
          ...coordinatePatch,
          ...buildFirestoreCreateAudit(),
        });
        toast({ title: "Site created", description: siteForm.siteName });
      } else if (editingSite) {
        await updateDoc(doc(db, "sites", editingSite.id), {
          siteName: siteForm.siteName.trim(),
          siteAddress: siteForm.siteAddress.trim(),
          district: siteForm.district.trim(),
          geofenceRadiusMeters: siteForm.geofenceRadiusMeters,
          strictGeofence: siteForm.strictGeofence,
          siteType: siteForm.siteType,
          ...coordinatePatch,
          ...buildFirestoreUpdateAudit(),
        });
        toast({ title: "Site updated" });
      }
      setSiteDialog(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setSavingSite(false);
    }
  };

  const handleDeleteSite = async () => {
    if (!deleteSiteTarget) return;
    try {
      const workOrdersSnap = await getDocs(
        query(collection(db, "workOrders"), where("siteId", "==", deleteSiteTarget.id))
      );
      const hasAssigned = workOrdersSnap.docs.some((d) => {
        const assigned = (d.data() as any).assignedGuards;
        return Array.isArray(assigned) && assigned.length > 0;
      });
      if (hasAssigned) {
        toast({
          variant: "destructive",
          title: "Cannot delete site",
          description: "This site has work orders with assigned guards. Remove the assignments or delete the work orders first.",
        });
        setDeleteSiteTarget(null);
        return;
      }
      await deleteDoc(doc(db, "sites", deleteSiteTarget.id));
      toast({ title: "Site deleted" });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not delete site." });
    } finally {
      setDeleteSiteTarget(null);
    }
  };

  // ── Location CRUD ──

  const openCreateLocation = () => {
    setLocationForm(BLANK_LOCATION);
    setEditingLocation(null);
    setLocationDialog("create");
  };

  const openEditLocation = (loc: LocationDoc) => {
    setEditingLocation(loc);
    setLocationForm({
      locationName: loc.locationName,
      address: loc.address || "",
      district: loc.district || "",
      geofenceRadiusMeters: loc.geofenceRadiusMeters ?? DEFAULT_GEOFENCE_RADIUS_METERS,
      strictGeofence: loc.strictGeofence !== false,
      siteType: (loc.siteType as SiteType | undefined) ?? "main",
      geolocation: normalizeGeoPoint(loc),
      latString: loc.latString || "",
      lngString: loc.lngString || "",
      coordinateStatus: (loc.coordinateStatus as CoordinateStatus | undefined) ?? "missing",
      coordinateSource: (loc.coordinateSource as CoordinateSource | undefined) ?? undefined,
      placeAccuracy: loc.placeAccuracy ?? null,
    });
    setLocationDialog("edit");
  };

  const handleSaveLocation = async () => {
    if (!locationForm.locationName.trim() || !locationForm.district.trim()) return;
    setSavingLocation(true);
    try {
      const coordinatePatch = buildCoordinatePayload(locationForm);
      if (locationDialog === "create") {
        await addDoc(collection(db, "clientLocations"), {
          clientId,
          clientName: client?.name ?? "",
          locationName: locationForm.locationName.trim(),
          address: locationForm.address.trim(),
          district: locationForm.district.trim(),
          geofenceRadiusMeters: locationForm.geofenceRadiusMeters,
          strictGeofence: locationForm.strictGeofence,
          siteType: locationForm.siteType,
          ...coordinatePatch,
          ...buildFirestoreCreateAudit(),
        });
        toast({ title: "Location created", description: locationForm.locationName });
      } else if (editingLocation) {
        await updateDoc(doc(db, "clientLocations", editingLocation.id), {
          locationName: locationForm.locationName.trim(),
          address: locationForm.address.trim(),
          district: locationForm.district.trim(),
          geofenceRadiusMeters: locationForm.geofenceRadiusMeters,
          strictGeofence: locationForm.strictGeofence,
          siteType: locationForm.siteType,
          ...coordinatePatch,
          ...buildFirestoreUpdateAudit(),
        });
        toast({ title: "Location updated" });
      }
      setLocationDialog(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setSavingLocation(false);
    }
  };

  const handleDeleteLocation = async () => {
    if (!deleteLocationTarget) return;
    try {
      await deleteDoc(doc(db, "clientLocations", deleteLocationTarget.id));
      toast({ title: "Location deleted" });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not delete location." });
    } finally {
      setDeleteLocationTarget(null);
    }
  };

  const handleRunGpsRepair = async () => {
    setRunningGpsRepair(true);
    try {
      const res = await authorizedFetch("/api/admin/sites/batch-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          includeInvalid: true,
          includeGeocoded: false,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Server error ${res.status}`);
      }

      const data = (await res.json()) as { results: BatchGeocodeResult[] };
      const updated = data.results.filter((result) => result.status === "updated").length;
      const failed = data.results.filter(
        (result) => result.status === "failed" || result.status === "no_result",
      ).length;

      if (data.results.length === 0) {
        toast({
          title: "All client sites already have GPS",
          description: "No sites needed GPS repair for this client.",
        });
        return;
      }

      toast({
        title: `GPS repair complete — ${updated} updated`,
        description:
          failed > 0
            ? `${failed} site${failed !== 1 ? "s" : ""} still need manual review.`
            : "Client site coordinates were updated successfully.",
        variant: failed > 0 ? "destructive" : "default",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "GPS repair failed",
        description: error?.message || "Could not run GPS repair.",
      });
    } finally {
      setRunningGpsRepair(false);
    }
  };

  // ── Helpers ──

  const coordBadge = (record: {
    coordinateStatus?: string;
    geolocation?: SiteDoc["geolocation"] | LocationDoc["geolocation"];
    latString?: string;
    lngString?: string;
  }) => {
    if (hasUsableSiteGps(record)) {
      return <Badge variant="outline" className="text-[10px] gap-1 text-green-700 border-green-200 bg-green-50"><CheckCircle2 className="h-2.5 w-2.5" />GPS set</Badge>;
    }
    return <Badge variant="outline" className="text-[10px] gap-1 text-amber-700 border-amber-200 bg-amber-50"><AlertCircle className="h-2.5 w-2.5" />No GPS</Badge>;
  };

  const coordinateSummary = (record: {
    coordinateStatus?: string;
    geolocation?: SiteDoc["geolocation"] | LocationDoc["geolocation"];
    latString?: string;
    lngString?: string;
  }) => {
    const coordinates = extractSiteCoordinates(record);
    if (!coordinates) return "Lat/Long not set";
    return `Lat ${formatCoordinate(coordinates.lat)} · Long ${formatCoordinate(coordinates.lng)}`;
  };

  if (clientLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!client) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Clients & Sites"
        title={client.name}
        description={`${sites.length} site${sites.length !== 1 ? "s" : ""} · ${locations.length} office location${locations.length !== 1 ? "s" : ""}${client.portalSubdomain ? ` · ${client.portalSubdomain}.cisskerala.site` : ""}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Settings", href: "/settings" },
          { label: "Clients & Sites", href: "/settings/clients" },
          { label: client.name },
        ]}
        actions={
          <div className="flex gap-2">
            {client.portalSubdomain ? (
              <Button variant="outline" asChild>
                <a href={buildClientPortalUrl(client.portalSubdomain) || "#"} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" /> Open Portal
                </a>
              </Button>
            ) : null}
            <Button variant="outline" onClick={openClientEdit}>
              <Pencil className="mr-2 h-4 w-4" /> Edit Client
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteClientDialog(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="sites">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="sites" className="flex-1 sm:flex-none">
            Sites
            <Badge variant="secondary" className="ml-2 text-xs">{sites.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="locations" className="flex-1 sm:flex-none">
            Office Locations
            <Badge variant="secondary" className="ml-2 text-xs">{locations.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="users" className="flex-1 sm:flex-none">
            Users
            <Badge variant="secondary" className="ml-2 text-xs">{users.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── Sites Tab ── */}
        <TabsContent value="sites" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Duty sites where guards are posted and attendance is recorded.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleRunGpsRepair} disabled={runningGpsRepair}>
                {runningGpsRepair ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Running GPS Repair
                  </>
                ) : (
                  <>
                    <MapPin className="mr-1.5 h-3.5 w-3.5" /> Run GPS Repair
                  </>
                )}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={`/settings/clients/${clientId}/geocode-coordinates`} className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> Fix Coordinates
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={`/settings/site-management?client=${encodeURIComponent(client.name)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" /> Advanced
                </a>
              </Button>
              <Button size="sm" onClick={openCreateSite}>
                <Plus className="mr-1.5 h-4 w-4" /> Add Site
              </Button>
            </div>
          </div>

          {sitesLoading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
          ) : sites.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <MapPin className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No sites yet for this client.</p>
                <Button size="sm" className="mt-4" onClick={openCreateSite}><Plus className="mr-1.5 h-4 w-4" /> Add First Site</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {sites.map((site) => (
                <Card key={site.id}>
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-sm">{site.siteName}</p>
                        {coordBadge(site)}
                        <Badge variant="secondary" className="text-[10px]">
                          {SITE_TYPE_LABELS[site.siteType || "site"] || "Site"}
                        </Badge>
                        <Badge variant={site.strictGeofence === false ? "secondary" : "default"} className="text-[10px]">
                          {site.strictGeofence === false ? "Soft geofence" : "Strict geofence"}
                        </Badge>
                      </div>
                      <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                        <p>{[site.district, site.siteAddress].filter(Boolean).join(" · ") || "No address added"}</p>
                        <p>
                          {coordinateStatusLabels[(site.coordinateStatus as CoordinateStatus | undefined) ?? (hasUsableSiteGps(site) ? "verified" : "missing")]}
                          {site.geofenceRadiusMeters ? ` · ${site.geofenceRadiusMeters}m fence` : ""}
                        </p>
                        <p>{coordinateSummary(site)}</p>
                        {site.placeAccuracy ? <p>{site.placeAccuracy}</p> : null}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditSite(site)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteSiteTarget(site)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Office Locations Tab ── */}
        <TabsContent value="locations" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Client offices and headquarters used for IN/OUT attendance check-in.
            </p>
            <Button size="sm" onClick={openCreateLocation}>
              <Plus className="mr-1.5 h-4 w-4" /> Add Location
            </Button>
          </div>

          {locationsLoading ? (
            <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
          ) : locations.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Building2 className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No office locations for this client.</p>
                <Button size="sm" className="mt-4" onClick={openCreateLocation}><Plus className="mr-1.5 h-4 w-4" /> Add Location</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {locations.map((loc) => (
                <Card key={loc.id}>
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-sm">{loc.locationName}</p>
                        {coordBadge(loc)}
                        <Badge variant="secondary" className="text-[10px]">
                          {SITE_TYPE_LABELS[loc.siteType || "main"] || "Main Office"}
                        </Badge>
                        <Badge variant={loc.strictGeofence === false ? "secondary" : "default"} className="text-[10px]">
                          {loc.strictGeofence === false ? "Soft geofence" : "Strict geofence"}
                        </Badge>
                      </div>
                      <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                        <p>{[loc.district, loc.address].filter(Boolean).join(" · ") || "No address added"}</p>
                        <p>
                          {coordinateStatusLabels[(loc.coordinateStatus as CoordinateStatus | undefined) ?? (hasUsableSiteGps(loc) ? "verified" : "missing")]}
                          {loc.geofenceRadiusMeters ? ` · ${loc.geofenceRadiusMeters}m fence` : ""}
                        </p>
                        <p>{coordinateSummary(loc)}</p>
                        {loc.placeAccuracy ? <p>{loc.placeAccuracy}</p> : null}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditLocation(loc)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteLocationTarget(loc)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Users Tab ── */}
        <TabsContent value="users" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" /> Client Portal Users
              </CardTitle>
              <CardDescription>Users who can log in to the client portal to view their data.</CardDescription>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : users.length === 0 ? (
                <p className="text-sm text-muted-foreground">No portal users linked.</p>
              ) : (
                <div className="space-y-2">
                  {users.map((u) => (
                    <div key={u.id} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{u.name || u.email}</span>
                      <span className="text-xs text-muted-foreground">{u.email}</span>
                    </div>
                  ))}
                </div>
              )}
              <Button size="sm" variant="outline" className="mt-4" asChild>
                <a href={`/settings/client-management`}>Manage Portal Users</a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Edit Client Dialog ── */}
      <Dialog open={clientEditDialog} onOpenChange={setClientEditDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Client</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Client Name *</Label>
              <Input value={clientForm.name} onChange={(e) => setClientForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Portal Subdomain *</Label>
              <Input
                value={clientForm.portalSubdomain}
                onChange={(e) =>
                  setClientForm((form) => ({
                    ...form,
                    portalSubdomain: slugifyPortalSubdomain(e.target.value),
                  }))
                }
                placeholder="e.g. logiware"
              />
              <p className="text-xs text-muted-foreground">
                Portal URL: {buildClientPortalUrl(clientForm.portalSubdomain || clientForm.name) || "https://client.cisskerala.site"}
              </p>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/60 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Portal access</p>
                <p className="text-xs text-muted-foreground">Admin can pause or resume this client dashboard link at any time.</p>
              </div>
              <Switch
                checked={clientForm.portalEnabled}
                onCheckedChange={(checked) => setClientForm((form) => ({ ...form, portalEnabled: checked }))}
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setClientEditDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveClient} disabled={savingClient || !clientForm.name.trim()}>
              {savingClient && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add/Edit Site Dialog ── */}
      <Dialog open={!!siteDialog} onOpenChange={(open) => { if (!open) setSiteDialog(null); }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{siteDialog === "create" ? "New Site" : "Edit Site"}</DialogTitle>
            <DialogDescription>Site under <strong>{client.name}</strong></DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Site Name *</Label>
              <Input
                placeholder="e.g. TCS Gate 1"
                value={siteForm.siteName}
                onChange={(e) => setSiteForm(f => ({ ...f, siteName: e.target.value }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>District *</Label>
                <Input
                  value={siteForm.district}
                  onChange={(e) => setSiteForm(f => ({ ...f, district: e.target.value }))}
                  placeholder="Enter district"
                  list="client-site-district-options"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Site Type</Label>
                <Select value={siteForm.siteType} onValueChange={(value: SiteType) => setSiteForm(f => ({ ...f, siteType: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SITE_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Geofence Radius (metres)</Label>
                <Input
                  type="number"
                  min={50}
                  max={2000}
                  value={siteForm.geofenceRadiusMeters}
                  onChange={(e) => setSiteForm(f => ({ ...f, geofenceRadiusMeters: Number(e.target.value) }))}
                />
                <p className="text-xs text-muted-foreground">Guards must be within this radius to mark attendance. Default: {DEFAULT_GEOFENCE_RADIUS_METERS}m.</p>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-1">
                  <Label htmlFor="site-strict-geofence">Strict geofence</Label>
                  <p className="text-xs text-muted-foreground">Block attendance outside this radius instead of warning only.</p>
                </div>
                <Switch
                  id="site-strict-geofence"
                  checked={siteForm.strictGeofence}
                  onCheckedChange={(checked: boolean) => setSiteForm(f => ({ ...f, strictGeofence: checked }))}
                />
              </div>
            </div>
            <LocationEditorCard
              entityType="site"
              value={{
                address: siteForm.siteAddress,
                district: siteForm.district,
                geolocation: siteForm.geolocation,
                latString: siteForm.latString,
                lngString: siteForm.lngString,
                coordinateStatus: siteForm.coordinateStatus,
                coordinateSource: siteForm.coordinateSource,
                placeAccuracy: siteForm.placeAccuracy,
              }}
              onChange={(patch) =>
                setSiteForm((current) => ({
                  ...current,
                  siteAddress: patch.address ?? current.siteAddress,
                  district: patch.district ?? current.district,
                  geolocation: patch.geolocation ?? current.geolocation,
                  latString: patch.latString ?? current.latString,
                  lngString: patch.lngString ?? current.lngString,
                  coordinateStatus: patch.coordinateStatus ?? current.coordinateStatus,
                  coordinateSource: patch.coordinateSource ?? current.coordinateSource,
                  placeAccuracy: patch.placeAccuracy ?? current.placeAccuracy,
                }))
              }
              title="Site location"
              description="Geocode the address, then click or drag the pin to fine-tune the site position if needed."
            />
            <datalist id="client-site-district-options">
              {KERALA_DISTRICTS.map((district) => <option key={district} value={district} />)}
            </datalist>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setSiteDialog(null)}>Cancel</Button>
            <Button onClick={handleSaveSite} disabled={savingSite || !siteForm.siteName.trim() || !siteForm.district.trim()}>
              {savingSite && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {siteDialog === "create" ? "Create Site" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add/Edit Location Dialog ── */}
      <Dialog open={!!locationDialog} onOpenChange={(open) => { if (!open) setLocationDialog(null); }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{locationDialog === "create" ? "New Office Location" : "Edit Location"}</DialogTitle>
            <DialogDescription>Office or HQ location for <strong>{client.name}</strong></DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Location Name *</Label>
              <Input
                placeholder="e.g. TCS Main Office"
                value={locationForm.locationName}
                onChange={(e) => setLocationForm(f => ({ ...f, locationName: e.target.value }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>District *</Label>
                <Input
                  value={locationForm.district}
                  onChange={(e) => setLocationForm(f => ({ ...f, district: e.target.value }))}
                  placeholder="Enter district"
                  list="client-location-district-options"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Location Type</Label>
                <Select value={locationForm.siteType} onValueChange={(value: SiteType) => setLocationForm(f => ({ ...f, siteType: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LOCATION_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Geofence Radius (metres)</Label>
                <Input
                  type="number"
                  min={50}
                  max={2000}
                  value={locationForm.geofenceRadiusMeters}
                  onChange={(e) => setLocationForm(f => ({ ...f, geofenceRadiusMeters: Number(e.target.value) }))}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-1">
                  <Label htmlFor="location-strict-geofence">Strict geofence</Label>
                  <p className="text-xs text-muted-foreground">Use this when office attendance should enforce the saved radius.</p>
                </div>
                <Switch
                  id="location-strict-geofence"
                  checked={locationForm.strictGeofence}
                  onCheckedChange={(checked: boolean) => setLocationForm(f => ({ ...f, strictGeofence: checked }))}
                />
              </div>
            </div>
            <LocationEditorCard
              entityType="clientLocation"
              value={{
                address: locationForm.address,
                district: locationForm.district,
                geolocation: locationForm.geolocation,
                latString: locationForm.latString,
                lngString: locationForm.lngString,
                coordinateStatus: locationForm.coordinateStatus,
                coordinateSource: locationForm.coordinateSource,
                placeAccuracy: locationForm.placeAccuracy,
              }}
              onChange={(patch) =>
                setLocationForm((current) => ({
                  ...current,
                  address: patch.address ?? current.address,
                  district: patch.district ?? current.district,
                  geolocation: patch.geolocation ?? current.geolocation,
                  latString: patch.latString ?? current.latString,
                  lngString: patch.lngString ?? current.lngString,
                  coordinateStatus: patch.coordinateStatus ?? current.coordinateStatus,
                  coordinateSource: patch.coordinateSource ?? current.coordinateSource,
                  placeAccuracy: patch.placeAccuracy ?? current.placeAccuracy,
                }))
              }
              title="Office location"
              description="Geocode the office address and adjust the pin manually if the saved point needs correction."
            />
            <datalist id="client-location-district-options">
              {KERALA_DISTRICTS.map((district) => <option key={district} value={district} />)}
            </datalist>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setLocationDialog(null)}>Cancel</Button>
            <Button onClick={handleSaveLocation} disabled={savingLocation || !locationForm.locationName.trim() || !locationForm.district.trim()}>
              {savingLocation && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {locationDialog === "create" ? "Create Location" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Site Confirm ── */}
      <AlertDialog open={!!deleteSiteTarget} onOpenChange={(open) => { if (!open) setDeleteSiteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete site?</AlertDialogTitle>
            <AlertDialogDescription>
              "<strong>{deleteSiteTarget?.siteName}</strong>" will be permanently removed. Sites with assigned guards cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSite} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete Location Confirm ── */}
      <AlertDialog open={!!deleteLocationTarget} onOpenChange={(open) => { if (!open) setDeleteLocationTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete location?</AlertDialogTitle>
            <AlertDialogDescription>
              "<strong>{deleteLocationTarget?.locationName}</strong>" will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteLocation} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete Client Confirm ── */}
      <AlertDialog open={deleteClientDialog} onOpenChange={setDeleteClientDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{client.name}</strong> and its configuration will be permanently deleted. The client must have no sites, locations, or users before it can be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteClient} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Client
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
