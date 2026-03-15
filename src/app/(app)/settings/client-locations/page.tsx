"use client";

import { useEffect, useMemo, useState } from "react";
import {
  GeoPoint,
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import * as XLSX from "xlsx";
import {
  ChevronLeft,
  Download,
  Edit,
  FileCheck2,
  Loader2,
  MapPinned,
  PlusCircle,
  Trash2,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";

import { LocationEditorCard } from "@/components/location/location-editor-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { buildFirestoreAuditEvent, buildFirestoreCreateAudit, buildFirestoreUpdateAudit } from "@/lib/firestore-audit";
import {
  buildGoogleMapsLink,
  buildLocationIdentity,
  coordinateStatusLabels,
  deriveCoordinateSource,
  deriveCoordinateStatus,
  formatCoordinate,
  hasValidCoordinates,
  parseGeoString,
} from "@/lib/location-utils";
import { KERALA_DISTRICTS } from "@/lib/constants";
import type {
  ClientLocation,
  CoordinateSource,
  CoordinateStatus,
  GeoPointLike,
} from "@/types/location";

type ClientOption = {
  id: string;
  name: string;
};

type ClientLocationForm = {
  clientId: string;
  clientName: string;
  locationName: string;
  address: string;
  district: string;
  geolocation?: GeoPointLike;
  latString?: string;
  lngString?: string;
  coordinateStatus?: CoordinateStatus;
  coordinateSource?: CoordinateSource;
  placeAccuracy?: string | null;
};

function emptyForm(): ClientLocationForm {
  return {
    clientId: "",
    clientName: "",
    locationName: "",
    address: "",
    district: "",
    coordinateStatus: "missing",
  };
}

function toStoredLocation(form: ClientLocationForm) {
  return {
    clientId: form.clientId || null,
    clientName: form.clientName,
    locationName: form.locationName,
    address: form.address,
    district: form.district,
    geolocation: form.geolocation
      ? new GeoPoint(form.geolocation.latitude, form.geolocation.longitude)
      : null,
    latString: form.latString || null,
    lngString: form.lngString || null,
    coordinateStatus: deriveCoordinateStatus(form),
    coordinateSource: deriveCoordinateSource(form) ?? null,
    placeAccuracy: form.placeAccuracy?.trim() || null,
    locationKey: buildLocationIdentity([
      form.clientId || form.clientName,
      form.locationName,
      form.address,
    ]),
  };
}

function fromStoredLocation(id: string, raw: any): ClientLocation & ClientLocationForm {
  return {
    id,
    clientId: raw.clientId ?? "",
    clientName: raw.clientName ?? "",
    locationName: raw.locationName ?? "",
    address: raw.address ?? "",
    district: raw.district ?? "",
    geolocation: raw.geolocation
      ? {
          latitude: raw.geolocation.latitude,
          longitude: raw.geolocation.longitude,
        }
      : undefined,
    latString:
      raw.latString ??
      (typeof raw.geolocation?.latitude === "number"
        ? formatCoordinate(raw.geolocation.latitude)
        : ""),
    lngString:
      raw.lngString ??
      (typeof raw.geolocation?.longitude === "number"
        ? formatCoordinate(raw.geolocation.longitude)
        : ""),
    coordinateStatus: deriveCoordinateStatus(raw),
    coordinateSource: deriveCoordinateSource(raw),
    placeAccuracy: raw.placeAccuracy ?? "",
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

async function geocodeAddress(address: string, district: string) {
  const response = await fetch("/api/locations/geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address,
      district,
      entityType: "clientLocation",
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not geocode this address.");
  }
  return data as {
    lat: number;
    lng: number;
    formattedAddress?: string;
    placeAccuracy?: string;
  };
}

export default function ClientLocationsPage() {
  const { toast } = useToast();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [locations, setLocations] = useState<(ClientLocation & ClientLocationForm)[]>([]);
  const [selectedClient, setSelectedClient] = useState("all");
  const [selectedDistrict, setSelectedDistrict] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<ClientLocationForm>(emptyForm());
  const [editingLocation, setEditingLocation] = useState<(ClientLocation & ClientLocationForm) | null>(null);
  const [deleteLocation, setDeleteLocation] = useState<(ClientLocation & ClientLocationForm) | null>(null);

  useEffect(() => {
    const clientsQuery = query(collection(db, "clients"), orderBy("name", "asc"));
    const unsubscribeClients = onSnapshot(clientsQuery, (snapshot) => {
      setClients(snapshot.docs.map((clientDoc) => ({
        id: clientDoc.id,
        name: clientDoc.data().name,
      })));
    });

    const locationsQuery = query(collection(db, "clientLocations"), orderBy("clientName", "asc"));
    const unsubscribeLocations = onSnapshot(
      locationsQuery,
      (snapshot) => {
        setLocations(snapshot.docs.map((locationDoc) => fromStoredLocation(locationDoc.id, locationDoc.data())));
        setIsLoading(false);
      },
      (error) => {
        console.error("Error fetching client locations", error);
        toast({
          variant: "destructive",
          title: "Error loading client locations",
          description: "Could not load location data from Firestore.",
        });
        setIsLoading(false);
      },
    );

    return () => {
      unsubscribeClients();
      unsubscribeLocations();
    };
  }, [toast]);

  const filteredLocations = useMemo(() => {
    return locations.filter((location) => {
      if (selectedClient !== "all" && location.clientId !== selectedClient) return false;
      if (selectedDistrict !== "all" && location.district !== selectedDistrict) return false;
      if (
        selectedStatus !== "all" &&
        deriveCoordinateStatus(location) !== selectedStatus
      ) {
        return false;
      }
      return true;
    });
  }, [locations, selectedClient, selectedDistrict, selectedStatus]);

  const ensureUniqueLocation = (
    form: ClientLocationForm,
    ignoreId?: string,
  ) => {
    const key = buildLocationIdentity([form.clientId || form.clientName, form.locationName, form.address]);
    return !locations.some((location) => {
      if (ignoreId && location.id === ignoreId) return false;
      return buildLocationIdentity([
        location.clientId || location.clientName,
        location.locationName,
        location.address,
      ]) === key;
    });
  };

  const validateForm = (form: ClientLocationForm, ignoreId?: string) => {
    if (!form.clientId || !form.clientName || !form.locationName || !form.address || !form.district) {
      return "Fill the client, location name, address, and district first.";
    }
    if (!hasValidCoordinates(form.geolocation)) {
      return "Set valid coordinates before saving this location.";
    }
    if (!ensureUniqueLocation(form, ignoreId)) {
      return "This client location already exists with the same address.";
    }
    return null;
  };

  const handleSelectClient = (
    clientId: string,
    apply: (patch: Partial<ClientLocationForm>) => void,
  ) => {
    const client = clients.find((item) => item.id === clientId);
    apply({
      clientId,
      clientName: client?.name ?? "",
    });
  };

  const handleCreate = async () => {
    const validationError = validateForm(createForm);
    if (validationError) {
      toast({ variant: "destructive", title: "Cannot save location", description: validationError });
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, "clientLocations"), {
        ...toStoredLocation(createForm),
        ...buildFirestoreCreateAudit(),
        auditTrail: arrayUnion(
          buildFirestoreAuditEvent("client_location_created", undefined, {
            clientId: createForm.clientId,
            clientName: createForm.clientName,
            locationName: createForm.locationName,
          }),
        ),
      });
      toast({
        title: "Client location created",
        description: "The client branch/location is ready to be linked to duty sites.",
      });
      setCreateForm(emptyForm());
      setCreateOpen(false);
    } catch (error) {
      console.error("Error creating client location", error);
      toast({
        variant: "destructive",
        title: "Create failed",
        description: "Could not create the client location.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingLocation) return;
    const validationError = validateForm(editingLocation, editingLocation.id);
    if (validationError) {
      toast({ variant: "destructive", title: "Cannot save changes", description: validationError });
      return;
    }

    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, "clientLocations", editingLocation.id!), {
        ...toStoredLocation(editingLocation),
        ...buildFirestoreUpdateAudit(),
        auditTrail: arrayUnion(
          buildFirestoreAuditEvent("client_location_updated", undefined, {
            clientId: editingLocation.clientId,
            clientName: editingLocation.clientName,
            locationName: editingLocation.locationName,
          }),
        ),
      });
      toast({ title: "Client location updated", description: "The changes have been saved." });
      setEditingLocation(null);
    } catch (error) {
      console.error("Error updating client location", error);
      toast({
        variant: "destructive",
        title: "Update failed",
        description: "Could not update the client location.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteLocation) return;
    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, "clientLocations", deleteLocation.id!));
      toast({ title: "Client location deleted", description: "The record has been removed." });
      setDeleteLocation(null);
    } catch (error) {
      console.error("Error deleting client location", error);
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: "Could not delete the client location.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const rows = [
      ["Client Name", "Location Name", "Address", "District", "Geolocation", "Coordinate Status", "Coordinate Source"],
      [
        "TCS",
        "Thrissur Digital Zone",
        "West Fort, Thrissur, Kerala",
        "Thrissur",
        "10.527642,76.214434",
        "verified",
        "manual",
      ],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Client Locations");
    XLSX.writeFile(workbook, "CISS_Client_Locations_Template.xlsx");
  };

  const processImport = async () => {
    if (!file) {
      toast({ variant: "destructive", title: "No file selected", description: "Choose a CSV or XLSX file first." });
      return;
    }

    setIsImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
      if (!rows.length) {
        throw new Error("The import file is empty.");
      }

      const existingKeys = new Set(
        locations.map((location) =>
          buildLocationIdentity([
            location.clientId || location.clientName,
            location.locationName,
            location.address,
          ]),
        ),
      );

      const clientLookup = new Map(
        clients.map((client) => [client.name.trim().toLowerCase(), client]),
      );

      const batch = writeBatch(db);
      let prepared = 0;

      for (const row of rows) {
        const clientName = String(row["Client Name"] ?? "").trim();
        const locationName = String(row["Location Name"] ?? "").trim();
        const address = String(row["Address"] ?? "").trim();
        const district = String(row["District"] ?? "").trim();
        if (!clientName || !locationName || !address || !district) {
          continue;
        }
        const client = clientLookup.get(clientName.toLowerCase());
        if (!client) {
          continue;
        }

        const identity = buildLocationIdentity([client.id, locationName, address]);
        if (existingKeys.has(identity)) {
          continue;
        }

        let latitude: number | null = null;
        let longitude: number | null = null;
        let coordinateSource = (String(row["Coordinate Source"] ?? "").trim() || undefined) as CoordinateSource | undefined;
        let coordinateStatus = (String(row["Coordinate Status"] ?? "").trim() || undefined) as CoordinateStatus | undefined;
        const parsedCoordinates = parseGeoString(String(row["Geolocation"] ?? "").trim());
        let placeAccuracy = String(row["Place Accuracy"] ?? "").trim() || undefined;

        if (parsedCoordinates) {
          latitude = parsedCoordinates.lat;
          longitude = parsedCoordinates.lng;
          coordinateSource = coordinateSource ?? "manual";
          coordinateStatus = coordinateStatus ?? "verified";
        } else {
          const geocoded = await geocodeAddress(address, district);
          latitude = geocoded.lat;
          longitude = geocoded.lng;
          placeAccuracy = geocoded.placeAccuracy ?? placeAccuracy;
          coordinateSource = coordinateSource ?? "geocode";
          coordinateStatus = coordinateStatus ?? "geocoded";
        }

        const payload = {
          clientId: client.id,
          clientName: client.name,
          locationName,
          address,
          district,
          geolocation: new GeoPoint(latitude, longitude),
          latString: formatCoordinate(latitude),
          lngString: formatCoordinate(longitude),
          coordinateStatus,
          coordinateSource,
          placeAccuracy: placeAccuracy ?? null,
          locationKey: identity,
          ...buildFirestoreCreateAudit(),
        };

        batch.set(doc(collection(db, "clientLocations")), payload);
        existingKeys.add(identity);
        prepared += 1;
      }

      if (!prepared) {
        throw new Error("No new client locations were ready to import.");
      }

      await batch.commit();
      toast({
        title: "Import complete",
        description: `${prepared} client location${prepared === 1 ? "" : "s"} imported.`,
      });
      setFile(null);
    } catch (error: any) {
      console.error("Client location import failed", error);
      toast({
        variant: "destructive",
        title: "Import failed",
        description: error?.message || "Could not import the file.",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/settings">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Back to settings</span>
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Client Locations</h1>
          <p className="text-muted-foreground">
            Manage verified branch, office, and center coordinates separately from duty sites.
          </p>
        </div>
      </div>

      <Alert>
        <MapPinned className="h-4 w-4" />
        <AlertTitle>Recommended workflow</AlertTitle>
        <AlertDescription>
          Create one record for each client branch or center, verify the coordinates once, then optionally link multiple duty sites back to that location.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Client location registry</CardTitle>
            <CardDescription>Filter and verify the physical locations attached to each client.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Client</Label>
                <Select value={selectedClient} onValueChange={setSelectedClient}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All clients</SelectItem>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>District</Label>
                <Select value={selectedDistrict} onValueChange={setSelectedDistrict}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All districts</SelectItem>
                    {KERALA_DISTRICTS.map((district) => (
                      <SelectItem key={district} value={district}>
                        {district}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Coordinate state</Label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All states</SelectItem>
                    {Object.entries(coordinateStatusLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setCreateOpen(true)}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add client location
              </Button>
              <Button type="button" variant="outline" onClick={handleDownloadTemplate}>
                <Download className="mr-2 h-4 w-4" />
                Download template
              </Button>
            </div>

            {isLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
              </div>
            ) : filteredLocations.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No client locations match the current filters.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredLocations.map((location) => {
                  const lat = location.geolocation?.latitude;
                  const lng = location.geolocation?.longitude;
                  const mapLink = buildGoogleMapsLink(lat, lng, location.locationName);
                  const status = deriveCoordinateStatus(location);
                  return (
                    <div key={location.id} className="rounded-xl border p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold">{location.locationName}</h3>
                            <Badge variant={status === "missing" ? "destructive" : "outline"}>
                              {coordinateStatusLabels[status]}
                            </Badge>
                            <Badge variant="secondary">{location.clientName}</Badge>
                            <Badge variant="outline">{location.district}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{location.address}</p>
                          <p className="text-xs text-muted-foreground">
                            {hasValidCoordinates(location.geolocation)
                              ? `Lat ${formatCoordinate(lat)}, Long ${formatCoordinate(lng)}`
                              : "Coordinates not set yet"}
                          </p>
                          {location.placeAccuracy ? (
                            <p className="text-xs text-muted-foreground">{location.placeAccuracy}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {mapLink ? (
                            <Button variant="outline" size="sm" asChild>
                              <a href={mapLink} target="_blank" rel="noreferrer">
                                Open map
                              </a>
                            </Button>
                          ) : null}
                          <Button variant="outline" size="sm" onClick={() => setEditingLocation(location)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => setDeleteLocation(location)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bulk import</CardTitle>
            <CardDescription>
              Import client branches and centers from Excel. If coordinates are missing, the system will geocode from the address.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="client-locations-file">Upload file</Label>
              <Input
                id="client-locations-file"
                type="file"
                accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            {file ? (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <FileCheck2 className="h-4 w-4 text-green-600" />
                <span>{file.name}</span>
              </div>
            ) : null}
          </CardContent>
          <CardFooter>
            <Button onClick={processImport} disabled={!file || isImporting}>
              {isImporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="mr-2 h-4 w-4" />
              )}
              {isImporting ? "Importing..." : "Process import"}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Add client location</DialogTitle>
            <DialogDescription>Capture the verified physical branch, office, or center details for this client.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Client</Label>
                <Select
                  value={createForm.clientId || undefined}
                  onValueChange={(clientId) => handleSelectClient(clientId, (patch) => setCreateForm((current) => ({ ...current, ...patch })))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Location name</Label>
                <Input
                  value={createForm.locationName}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, locationName: event.target.value }))
                  }
                  placeholder="Example: TCS Thrissur Digital Zone"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>District</Label>
              <Select
                value={createForm.district}
                onValueChange={(district) => setCreateForm((current) => ({ ...current, district }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select district" />
                </SelectTrigger>
                <SelectContent>
                  {KERALA_DISTRICTS.map((district) => (
                    <SelectItem key={district} value={district}>
                      {district}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <LocationEditorCard
              entityType="clientLocation"
              value={createForm}
              onChange={(patch) => setCreateForm((current) => ({ ...current, ...patch }))}
              title="Location confirmation"
              description="Geocode the address, verify the map, and keep manual entry only as a fallback."
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save location
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingLocation} onOpenChange={(open) => !open && setEditingLocation(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit client location</DialogTitle>
            <DialogDescription>Update the verified coordinates or branch details.</DialogDescription>
          </DialogHeader>
          {editingLocation ? (
            <>
              <div className="grid gap-4 py-2">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Client</Label>
                    <Select
                      value={editingLocation.clientId || undefined}
                      onValueChange={(clientId) =>
                        handleSelectClient(clientId, (patch) =>
                          setEditingLocation((current) => (current ? { ...current, ...patch } : current)),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select client" />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Location name</Label>
                    <Input
                      value={editingLocation.locationName}
                      onChange={(event) =>
                        setEditingLocation((current) =>
                          current ? { ...current, locationName: event.target.value } : current,
                        )
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>District</Label>
                  <Select
                    value={editingLocation.district}
                    onValueChange={(district) =>
                      setEditingLocation((current) => (current ? { ...current, district } : current))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select district" />
                    </SelectTrigger>
                    <SelectContent>
                      {KERALA_DISTRICTS.map((district) => (
                        <SelectItem key={district} value={district}>
                          {district}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <LocationEditorCard
                  entityType="clientLocation"
                  value={editingLocation}
                  onChange={(patch) =>
                    setEditingLocation((current) => (current ? { ...current, ...patch } : current))
                  }
                />
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setEditingLocation(null)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveEdit} disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save changes
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteLocation} onOpenChange={(open) => !open && setDeleteLocation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client location?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the client location "{deleteLocation?.locationName}". Linked duty sites will keep working, but the optional relationship will point to a deleted record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isSubmitting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
