
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UploadCloud, Download, Loader2, FileCheck2, AlertTriangle, ListChecks, CheckCircle, ChevronLeft, Edit, Trash2, ChevronRight, MapPinned, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, writeBatch, serverTimestamp, GeoPoint, doc, query, where, getDocs, onSnapshot, orderBy, updateDoc, deleteDoc, limit, startAfter, type Query, type QueryDocumentSnapshot, endBefore, limitToLast, addDoc, arrayUnion } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buildFirestoreAuditEvent, buildFirestoreCreateAudit, buildFirestoreUpdateAudit } from '@/lib/firestore-audit';
import { LocationEditorCard } from '@/components/location/location-editor-card';
import { KERALA_DISTRICTS, OPERATIONAL_CLIENT_NAME } from '@/lib/constants';
import { buildGoogleMapsLink, buildLocationIdentity, coordinateStatusLabels, deriveCoordinateStatus, formatCoordinate, hasValidCoordinates, parseGeoString } from '@/lib/location-utils';
import { buildShiftTemplates, SHIFT_PATTERN_LABELS } from '@/lib/shift-utils';
import type { ClientLocation, CoordinateSource, CoordinateStatus, ManagedSite, SiteShiftPattern } from '@/types/location';
import { PageHeader } from '@/components/layout/page-header';


type Site = ManagedSite;

interface ClientOption {
    id: string;
    name: string;
}
interface FieldOfficerOption {
    id: string;
    name: string;
    assignedDistricts: string[];
}
interface ClientLocationOption extends ClientLocation {
    id: string;
    latString?: string;
    lngString?: string;
}


interface ProcessedRecord {
    data: any;
    status: 'success' | 'error' | 'duplicate';
    message: string;
}

const requiredFields = [
    'Site Name', 'Site Address', 'Geolocation', 'District'
];

const keralaDistricts = [...KERALA_DISTRICTS];
const SITES_PER_PAGE = 10;
const formatCoord = formatCoordinate;

const toRadians = (deg: number) => (deg * Math.PI) / 180;
const haversineDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000; // meters
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
            Math.cos(toRadians(lat2)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

type GeocodeStatus = 'created' | 'updated' | 'kept' | 'failed' | 'noResult';

interface GeocodeResult {
    clientName?: string;
    siteName?: string;
    district?: string;
    siteAddress?: string;
    status: GeocodeStatus;
    message: string;
    oldLat?: number;
    oldLng?: number;
    newLat?: number;
    newLng?: number;
    distanceMeters?: number;
}

interface SiteEditFormProps {
    site: Site;
    onSave: (siteData: Partial<Site>) => Promise<void>;
    isSaving: boolean;
    onClose: () => void;
    clients: ClientOption[];
    clientLocations: ClientLocationOption[];
}

const SiteEditForm: React.FC<SiteEditFormProps> = ({ site, onSave, isSaving, onClose, clients, clientLocations }) => {
    const [formData, setFormData] = useState<Partial<Site>>(site);
    const filteredClientLocations = clientLocations.filter((location) => location.clientId === formData.clientId);
    const isTcsSite = (formData.clientName || '').trim().toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase();

    const handleSave = () => {
        const changes: Partial<Site> = {};
        (Object.keys(formData) as Array<keyof Site>).forEach(key => {
            if (key === 'geolocation') {
                if (formData.geolocation?.latitude !== site.geolocation?.latitude || formData.geolocation?.longitude !== site.geolocation?.longitude) {
                    (changes as any)[key] = formData[key];
                }
            } else if (formData[key] !== site[key]) {
                (changes as any)[key] = formData[key];
            }
        });
        
        if (Object.keys(changes).length > 0) {
            onSave(changes);
        } else {
            onClose(); 
        }
    };

    const updateShiftPattern = (pattern: SiteShiftPattern) => {
        setFormData({
            ...formData,
            shiftMode: 'fixed',
            shiftPattern: pattern,
            shiftTemplates: buildShiftTemplates(pattern),
        });
    };

    return (
        <div className="grid gap-4 py-4">
            <div className="grid gap-2">
                <Label htmlFor="clientName">Client</Label>
                <Select
                    value={formData.clientId || undefined}
                    onValueChange={(value) => {
                        const selectedClient = clients.find((client) => client.id === value);
                        const isTcs = (selectedClient?.name || '').trim().toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase();
                        setFormData({
                            ...formData,
                            clientId: value,
                            clientName: selectedClient?.name ?? '',
                            clientLocationId: undefined,
                            clientLocationName: undefined,
                            shiftMode: isTcs ? 'none' : (formData.shiftMode === 'fixed' ? 'fixed' : 'fixed'),
                            shiftPattern: isTcs ? null : (formData.shiftPattern ?? '2x12'),
                            shiftTemplates: isTcs ? [] : buildShiftTemplates((formData.shiftPattern as SiteShiftPattern | undefined) ?? '2x12'),
                        });
                    }}
                >
                    <SelectTrigger id="clientName"><SelectValue placeholder="Select a client" /></SelectTrigger>
                    <SelectContent>
                        {clients.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
             <div className="grid gap-2">
                <Label htmlFor="siteName">Site Name</Label>
                <Input id="siteName" value={formData.siteName || ''} onChange={(e) => setFormData({...formData, siteName: e.target.value})} />
            </div>
             <div className="grid gap-2">
                <Label htmlFor="siteAddress">Site Address</Label>
                <Input id="siteAddress" value={formData.siteAddress || ''} onChange={(e) => setFormData({...formData, siteAddress: e.target.value})} />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="clientLocationId">{isTcsSite ? 'Linked TCS Center' : 'Linked Client Location'}</Label>
                <Select
                    value={formData.clientLocationId || 'none'}
                    onValueChange={(value) => {
                        if (value === 'none') {
                            setFormData({ ...formData, clientLocationId: undefined, clientLocationName: undefined });
                            return;
                        }
                        const linkedLocation = filteredClientLocations.find((location) => location.id === value);
                        setFormData({
                            ...formData,
                            clientLocationId: value,
                            clientLocationName: linkedLocation?.locationName ?? undefined,
                        });
                    }}
                >
                    <SelectTrigger id="clientLocationId"><SelectValue placeholder="Optional linked client location" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">No linked client location</SelectItem>
                        {filteredClientLocations.map((location) => (
                            <SelectItem key={location.id} value={location.id}>
                                {location.locationName}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {isTcsSite ? (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    TCS sites stay flexible. No recurring shift timing is enforced here.
                </div>
            ) : (
                <div className="grid gap-3 rounded-lg border p-4">
                    <div className="space-y-1">
                        <Label>Shift pattern</Label>
                        <p className="text-xs text-muted-foreground">Attendance will resolve the expected shift from this site configuration.</p>
                    </div>
                    <Select
                        value={(formData.shiftPattern as string | undefined) || '2x12'}
                        onValueChange={(value) => updateShiftPattern(value as SiteShiftPattern)}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select shift pattern" />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.entries(SHIFT_PATTERN_LABELS).map(([key, label]) => (
                                <SelectItem key={key} value={key}>{label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="grid gap-2 sm:grid-cols-3">
                        {(formData.shiftTemplates || buildShiftTemplates((formData.shiftPattern as SiteShiftPattern | undefined) ?? '2x12')).map((shift) => (
                            <div key={shift.code} className="rounded-md border bg-muted/20 p-3 text-sm">
                                <p className="font-medium">{shift.label}</p>
                                <p className="text-muted-foreground">{shift.startTime} - {shift.endTime}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div className="grid gap-2">
                <Label htmlFor="geofenceRadiusMeters">Geofence Radius (meters)</Label>
                <Input
                    id="geofenceRadiusMeters"
                    type="number"
                    min={1}
                    value={formData.geofenceRadiusMeters ?? 150}
                    onChange={(e) => setFormData({ ...formData, geofenceRadiusMeters: Math.max(1, Number(e.target.value || 150)) })}
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="district">District</Label>
                 <Select value={formData.district} onValueChange={(value) => setFormData({...formData, district: value})}>
                    <SelectTrigger><SelectValue placeholder="Select a district" /></SelectTrigger>
                    <SelectContent>
                        {keralaDistricts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <LocationEditorCard
                entityType="site"
                value={{
                    address: formData.siteAddress || '',
                    district: formData.district,
                    geolocation: formData.geolocation,
                    latString: formData.latString,
                    lngString: formData.lngString,
                    coordinateStatus: formData.coordinateStatus,
                    coordinateSource: formData.coordinateSource,
                    placeAccuracy: formData.placeAccuracy,
                }}
                onChange={(patch) =>
                    setFormData({
                        ...formData,
                        siteAddress: patch.address ?? formData.siteAddress,
                        district: patch.district ?? formData.district,
                        geolocation: patch.geolocation,
                        latString: patch.latString,
                        lngString: patch.lngString,
                        coordinateStatus: patch.coordinateStatus,
                        coordinateSource: patch.coordinateSource,
                        placeAccuracy: patch.placeAccuracy ?? undefined,
                    })
                }
                title="Duty-site coordinates"
                description="Geocode or verify this duty site without exposing the API key in the browser."
            />
            <DialogFooter>
                <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                </Button>
            </DialogFooter>
        </div>
    );
};


export default function SiteManagementPage() {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processedRecords, setProcessedRecords] = useState<ProcessedRecord[]>([]);
    const { toast } = useToast();
    
    // State for CRUD and Pagination
    const [sites, setSites] = useState<Site[]>([]);
    const [isLoadingSites, setIsLoadingSites] = useState(true);
    const [editingSite, setEditingSite] = useState<Site | null>(null);
    const [deletingSite, setDeletingSite] = useState<Site | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [createData, setCreateData] = useState<Partial<Site>>({
        clientId: '',
        clientName: '',
        siteName: '',
        siteAddress: '',
        district: '',
        geofenceRadiusMeters: 150,
        latString: '',
        lngString: '',
        coordinateStatus: 'missing',
    });
    
    // Filters
    const [clients, setClients] = useState<ClientOption[]>([]);
    const [clientLocations, setClientLocations] = useState<ClientLocationOption[]>([]);
    const [fieldOfficers, setFieldOfficers] = useState<FieldOfficerOption[]>([]);
    const [selectedClient, setSelectedClient] = useState<string>('all');
    const [selectedDistrict, setSelectedDistrict] = useState<string>('all');
    const [selectedOfficer, setSelectedOfficer] = useState<string>('all');
    const [selectedCoordinateStatus, setSelectedCoordinateStatus] = useState<string>('all');
    const [isFilterDataLoading, setIsFilterDataLoading] = useState(true);

    const [currentPage, setCurrentPage] = useState(1);
    const [firstDoc, setFirstDoc] = useState<QueryDocumentSnapshot | null>(null);
    const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
    const [hasNextPage, setHasNextPage] = useState(false);

    // Geocoding helper state
    const [isGeocoding, setIsGeocoding] = useState(false);
    const [geocodeReport, setGeocodeReport] = useState<string>('');
    const [geocodeResults, setGeocodeResults] = useState<GeocodeResult[]>([]);
    const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
    const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
    const [bulkDeleteMode, setBulkDeleteMode] = useState<'selected' | 'all' | null>(null);
    const operationalClient = useMemo(
        () => clients.find(client => client.name.trim().toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase()) ?? null,
        [clients],
    );

    useEffect(() => {
        const fetchFilterData = async () => {
            setIsFilterDataLoading(true);
            try {
                const clientsSnapshot = await getDocs(query(collection(db, 'clients'), orderBy('name')));
                setClients(clientsSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name } as ClientOption)));

                const clientLocationsSnapshot = await getDocs(query(collection(db, 'clientLocations'), orderBy('clientName')));
                setClientLocations(clientLocationsSnapshot.docs.map((clientLocationDoc) => ({
                    id: clientLocationDoc.id,
                    ...(clientLocationDoc.data() as any),
                } as ClientLocationOption)));

                const officersSnapshot = await getDocs(query(collection(db, 'fieldOfficers'), orderBy('name')));
                setFieldOfficers(officersSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name, assignedDistricts: doc.data().assignedDistricts } as FieldOfficerOption)));

            } catch (error) {
                toast({ variant: "destructive", title: "Error", description: "Could not load data for filters." });
            } finally {
                setIsFilterDataLoading(false);
            }
        };
        fetchFilterData();
    }, [toast]);

    useEffect(() => {
        if (!operationalClient) return;
        setCreateData((current) => ({
            ...current,
            clientId: current.clientId || operationalClient.id,
            clientName: current.clientName || operationalClient.name,
        }));
    }, [operationalClient]);


    const fetchSites = useCallback(async (pageDirection: 'next' | 'prev' | 'first' = 'first') => {
        setIsLoadingSites(true);
        try {
            let q: Query = collection(db, "sites");
            
            // --- Apply Filters ---
            const officer = fieldOfficers.find(fo => fo.id === selectedOfficer);
            if (officer && officer.assignedDistricts.length > 0) {
                q = query(q, where('district', 'in', officer.assignedDistricts));
            } else if (selectedDistrict !== 'all') {
                q = query(q, where('district', '==', selectedDistrict));
            }
            if (selectedClient !== 'all') {
                q = query(q, where('clientName', '==', selectedClient));
            }
            // Use a single orderBy to avoid composite index requirements across different filter combos
            q = query(q, orderBy('clientName', 'asc'));
            
            let finalQuery = q;
            if (pageDirection === 'next' && lastDoc) {
                finalQuery = query(q, startAfter(lastDoc), limit(SITES_PER_PAGE));
            } else if (pageDirection === 'prev' && firstDoc) {
                // Use startAt with the stored firstDoc anchor and then take the previous page by limitingToLast
                finalQuery = query(q, endBefore(firstDoc), limitToLast(SITES_PER_PAGE));
            } else {
                 finalQuery = query(q, limit(SITES_PER_PAGE));
            }

            const documentSnapshots = await getDocs(finalQuery);
            const fetchedSites = documentSnapshots.docs
                .map(siteDoc => {
                    const raw = siteDoc.data() as any;
                    const resolvedClient = clients.find(client => client.name === raw.clientName);
                    const resolvedClientName = raw.clientName ?? resolvedClient?.name ?? operationalClient?.name ?? '';
                    const isTcs = resolvedClientName.trim().toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase();
                    return {
                        id: siteDoc.id,
                        ...raw,
                        clientId: raw.clientId ?? resolvedClient?.id ?? (isTcs ? operationalClient?.id : undefined),
                        clientName: resolvedClientName,
                        coordinateStatus: deriveCoordinateStatus(raw),
                        coordinateSource: raw.coordinateSource ?? (hasValidCoordinates(raw.geolocation) ? 'manual' : undefined),
                        placeAccuracy: raw.placeAccuracy ?? undefined,
                    } as Site;
                })
                .filter(site =>
                    selectedCoordinateStatus === 'all'
                        ? true
                        : deriveCoordinateStatus(site) === selectedCoordinateStatus,
                );
            
            if (!documentSnapshots.empty) {
                setSites(fetchedSites);
                setFirstDoc(documentSnapshots.docs[0]);
                setLastDoc(documentSnapshots.docs[documentSnapshots.docs.length - 1]);

                const nextQuery = query(q, startAfter(documentSnapshots.docs[documentSnapshots.docs.length - 1]), limit(1));
                const nextSnapshot = await getDocs(nextQuery);
                setHasNextPage(!nextSnapshot.empty);
            } else {
                 if (pageDirection === 'next') {
                    setHasNextPage(false);
                } else if (pageDirection === 'prev' && currentPage > 1) {
                     fetchSites('first');
                     setCurrentPage(1);
                }
                 else {
                     setSites([]);
                     setHasNextPage(false);
                     setFirstDoc(null);
                     setLastDoc(null);
                }
            }
        } catch (error: any) {
            console.error("Error fetching sites: ", error);
            let message = "Could not load site data.";
            if (error.code === 'failed-precondition') {
                message = "The query requires an index. Please check the browser console for a link to create it in Firebase.";
            }
            toast({ variant: "destructive", title: "Error", description: message });
            setSites([]);
        } finally {
            setIsLoadingSites(false);
        }
    }, [lastDoc, firstDoc, currentPage, toast, selectedClient, selectedDistrict, selectedOfficer, fieldOfficers, selectedCoordinateStatus, clients, operationalClient]);

    useEffect(() => {
        fetchSites('first');
        setCurrentPage(1); // Reset page number on filter change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedClient, selectedDistrict, selectedOfficer, selectedCoordinateStatus]); // Re-fetch when filters change


    const handleNextPage = () => {
        if (hasNextPage) {
            setCurrentPage(prev => prev + 1);
            fetchSites('next');
        }
    };

    const handlePrevPage = () => {
        if (currentPage > 1) {
            setCurrentPage(prev => prev - 1);
            fetchSites('prev');
        }
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            const selectedFile = event.target.files[0];
            if (selectedFile.type === 'text/csv' || selectedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
                setFile(selectedFile);
                setProcessedRecords([]);
            } else {
                toast({
                    variant: 'destructive',
                    title: 'Invalid File Type',
                    description: 'Please upload a CSV or XLSX file.',
                });
            }
        }
    };

    const handleDownloadTemplate = () => {
        const templateHeaders = ['Client Name', 'Site Name', 'Site ID', 'Site Address', 'Geolocation', 'District', 'Client Location Name', 'Shift Pattern', 'Coordinate Status', 'Coordinate Source'];
        const templateExampleRow = [OPERATIONAL_CLIENT_NAME, 'Main Branch', 'SITE-001', '123 Example St, Example City, EX 12345', '10.1234,76.5432', 'Ernakulam', 'TCS Kochi Branch', '', 'verified', 'manual'];
        const templateData = [templateHeaders, templateExampleRow];
        const ws = XLSX.utils.aoa_to_sheet(templateData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Site Import Template");
        XLSX.writeFile(wb, "CISS_Site_Import_Template.xlsx");
        toast({
            title: "Template Downloading",
            description: "The Excel template file has started downloading."
        });
    };

    const processAndUpload = async () => {
        if (!file) {
            toast({ variant: 'destructive', title: 'No File Selected', description: 'Please select a file to upload.' });
            return;
        }

        setIsProcessing(true);
        setProcessedRecords([]);

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                
                if (jsonData.length === 0) {
                    throw new Error("The file is empty or does not contain data rows.");
                }

                toast({ title: "Checking for duplicates...", description: "Comparing with existing site data." });
                const existingSitesSnapshot = await getDocs(collection(db, 'sites'));
                const existingSites = new Set(existingSitesSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return buildLocationIdentity([data.clientName, data.siteName, data.district]);
                }));

                let validRecords: any[] = [];
                let localProcessedRecords: ProcessedRecord[] = [];

                jsonData.forEach((row: any, index) => {
                    let missingFields = requiredFields.filter(field => !row[field]);
                    if (missingFields.length > 0) {
                        localProcessedRecords.push({ data: row, status: 'error', message: `Row ${index + 2}: Missing required fields: ${missingFields.join(', ')}` });
                        return;
                    }

                const clientName = String(row['Client Name'] || '').trim() || OPERATIONAL_CLIENT_NAME;
                const siteName = row['Site Name'];
                const clientOption = clients.find(client => client.name.toLowerCase() === clientName.toLowerCase()) ?? null;
                    
                    const uniqueKey = buildLocationIdentity([clientName, siteName, row['District']]);
                    if (existingSites.has(uniqueKey)) {
                        localProcessedRecords.push({ data: row, status: 'duplicate', message: `Row ${index + 2}: This site already exists and was skipped.` });
                        return;
                    }
                    
                    if (!keralaDistricts.includes(row['District'])) {
                        localProcessedRecords.push({ data: row, status: 'error', message: `Row ${index + 2}: Invalid District "${row['District']}". Please use a valid Kerala district.` });
                        return;
                    }

                    const parsedCoords = parseGeoString(String(row.Geolocation || '').trim());
                    if (!parsedCoords) {
                        localProcessedRecords.push({ data: row, status: 'error', message: `Row ${index + 2}: Invalid Geolocation format. Expected "latitude,longitude".` });
                        return;
                    }
                    const { lat: latitude, lng: longitude } = parsedCoords;
                    const linkedClientLocationName = String(row['Client Location Name'] || '').trim();
                    const importedShiftPattern = String(row['Shift Pattern'] || '').trim() as SiteShiftPattern | '';
                    const linkedClientLocation = linkedClientLocationName
                        ? clientLocations.find((location) =>
                            (location.clientId ? location.clientId === clientOption?.id : location.clientName?.toLowerCase() === clientName.toLowerCase()) &&
                            location.locationName?.toLowerCase() === linkedClientLocationName.toLowerCase(),
                        )
                        : null;
                    
                    const normalizedShiftPattern = importedShiftPattern === '2x12' || importedShiftPattern === '3x8'
                        ? importedShiftPattern
                        : '2x12';

                    const siteData = {
                      clientId: clientOption?.id ?? null,
                      clientName: clientName,
                      siteName: siteName,
                      siteId: row['Site ID'] || null,
                      siteAddress: row['Site Address'],
                      district: row['District'],
                      geolocation: new GeoPoint(latitude, longitude),
                      latString: formatCoord(latitude),
                      lngString: formatCoord(longitude),
                      clientLocationId: linkedClientLocation?.id ?? null,
                      clientLocationName: linkedClientLocation?.locationName ?? null,
                      coordinateStatus: (String(row['Coordinate Status'] || '').trim() || 'verified') as CoordinateStatus,
                      coordinateSource: (String(row['Coordinate Source'] || '').trim() || 'manual') as CoordinateSource,
                      shiftMode: clientName.toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase() ? 'none' : 'fixed',
                      shiftPattern: clientName.toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase() ? null : normalizedShiftPattern,
                      shiftTemplates: clientName.toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase() ? [] : buildShiftTemplates(normalizedShiftPattern),
                      locationKey: buildLocationIdentity([clientName, siteName, row['District']]),
                      ...buildFirestoreCreateAudit(),
                    };
                    
                    validRecords.push(siteData);
                });
                
                setProcessedRecords(localProcessedRecords);

                if (validRecords.length === 0) {
                    if (localProcessedRecords.length > 0) {
                        throw new Error("No new sites to import. All records were either duplicates or contained errors.");
                    } else {
                        throw new Error("No valid records found to import.");
                    }
                }

                toast({ title: "Uploading...", description: `Importing ${validRecords.length} new site records.` });

                const batch = writeBatch(db);
                const sitesRef = collection(db, "sites");

                validRecords.forEach(record => {
                    const siteDocRef = doc(sitesRef);
                    batch.set(siteDocRef, record);
                });

                await batch.commit();
                
                fetchSites('first');
                setCurrentPage(1);

                toast({
                    title: 'Import Successful',
                    description: `Successfully imported ${validRecords.length} new sites.`,
                    duration: 5000
                });
                const successRecords = validRecords.map(data => ({ data: { ...data, 'Client Name': data.clientName }, status: 'success', message: 'Successfully imported.'} as ProcessedRecord));
                setProcessedRecords(prev => [...prev, ...successRecords]);

            } catch (error: any) {
                console.error("Error processing file:", error);
                toast({ variant: 'destructive', title: 'Import Failed', description: error.message || 'An unexpected error occurred during import.' });
            } finally {
                setIsProcessing(false);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const handleUpdateSite = async (updatedData: Partial<Site>) => {
        if (!editingSite) return;
        setIsSubmitting(true);
        try {
            const siteDocRef = doc(db, 'sites', editingSite.id);
            const isTcs = (updatedData.clientName ?? editingSite.clientName ?? '').trim().toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase();
            await updateDoc(siteDocRef, {
                ...updatedData,
                // If geolocation updated and we have lat/lng inputs in formData, persist the strings too
                ...(updatedData.geolocation ? { latString: (updatedData as any).latString ?? undefined, lngString: (updatedData as any).lngString ?? undefined } : {}),
                locationKey: buildLocationIdentity([
                    updatedData.clientName ?? editingSite.clientName,
                    updatedData.siteName ?? editingSite.siteName,
                    updatedData.district ?? editingSite.district,
                ]),
                shiftMode: isTcs ? 'none' : (updatedData.shiftMode ?? editingSite.shiftMode ?? 'fixed'),
                shiftPattern: isTcs ? null : (updatedData.shiftPattern ?? editingSite.shiftPattern ?? '2x12'),
                shiftTemplates: isTcs
                    ? []
                    : (updatedData.shiftTemplates ?? editingSite.shiftTemplates ?? buildShiftTemplates(((updatedData.shiftPattern ?? editingSite.shiftPattern) as SiteShiftPattern | undefined) ?? '2x12')),
                ...buildFirestoreUpdateAudit(),
                auditTrail: arrayUnion(
                    buildFirestoreAuditEvent('site_updated', undefined, {
                        siteId: editingSite.id,
                        siteName: updatedData.siteName ?? editingSite.siteName,
                    }),
                ),
            });
            toast({ title: "Site Updated", description: "The site details have been saved." });
            fetchSites(currentPage === 1 ? 'first' : 'next');
        } catch (error) {
            toast({ variant: "destructive", title: "Update Failed", description: "Could not update the site." });
        } finally {
            setIsSubmitting(false);
            setEditingSite(null);
        }
    };

    const handleDeleteSite = async () => {
        if (!deletingSite) return;
        setIsSubmitting(true);
        try {
            await deleteDoc(doc(db, 'sites', deletingSite.id));
            toast({ title: "Site Deleted", description: "The site has been removed." });
            fetchSites(currentPage === 1 ? 'first' : 'next');
        } catch (error) {
            toast({ variant: "destructive", title: "Delete Failed", description: "Could not delete the site." });
        } finally {
            setIsSubmitting(false);
            setDeletingSite(null);
        }
    };

    const handleDownloadGeocodeReport = () => {
        if (!geocodeResults.length) {
            toast({ variant: 'destructive', title: 'No Report Available', description: 'Run "Update Site Locations" first.' });
            return;
        }

        const rows = geocodeResults.map((r, index) => ({
            SNo: index + 1,
            Client: r.clientName ?? '',
            'Site Name': r.siteName ?? '',
            District: r.district ?? '',
            'Site Address': r.siteAddress ?? '',
            Status: r.status,
            Message: r.message,
            'Old Latitude': typeof r.oldLat === 'number' ? formatCoord(r.oldLat) : '',
            'Old Longitude': typeof r.oldLng === 'number' ? formatCoord(r.oldLng) : '',
            'New Latitude': typeof r.newLat === 'number' ? formatCoord(r.newLat) : '',
            'New Longitude': typeof r.newLng === 'number' ? formatCoord(r.newLng) : '',
            'Distance (m)': typeof r.distanceMeters === 'number' ? Math.round(r.distanceMeters) : '',
        }));

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Geocoding Report');
        XLSX.writeFile(workbook, 'CISS_Site_Geocoding_Report.xlsx');
    };

    // --- Bulk Geocoding using a server-side API route ---
    const handleAutoGeocode = async () => {
        setIsGeocoding(true);
        setGeocodeReport('');
        setGeocodeResults([]);
        try {
            // Load all sites and only geocode records that are still missing valid coordinates.
            const snap = await getDocs(collection(db, 'sites'));
            const allSites = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            const sitesNeedingGeocodes = allSites.filter((site) => {
                const lat = site?.geolocation?.latitude;
                const lng = site?.geolocation?.longitude;
                return !Number.isFinite(lat) || !Number.isFinite(lng);
            });

            const reportLines: string[] = [];
            const structuredResults: GeocodeResult[] = [];
            let batch = writeBatch(db);
            let pendingWrites = 0;

            const flushBatch = async () => {
                if (pendingWrites === 0) return;
                await batch.commit();
                batch = writeBatch(db);
                pendingWrites = 0;
            };

            if (sitesNeedingGeocodes.length === 0) {
                setGeocodeReport('ℹ️ All sites already have valid coordinates saved.');
                setGeocodeResults([]);
                toast({
                    title: 'No Geocoding Needed',
                    description: 'All sites already have coordinates configured.',
                });
                return;
            }

            for (const site of sitesNeedingGeocodes) {
                const addressParts = [
                    site.siteAddress,
                    site.district,
                    'Kerala',
                    'India',
                ].filter(Boolean);
                const address = addressParts.join(', ');

                try {
                    const res = await fetch('/api/geocode-site', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ address }),
                    });

                    if (!res.ok) {
                        const errText = await res.text();
                        const message = errText || 'Geocoding failed.';
                        reportLines.push(`❌ ${site.siteName} (${site.clientName}) – ${message}`);
                        structuredResults.push({
                            clientName: site.clientName,
                            siteName: site.siteName,
                            district: site.district,
                            siteAddress: site.siteAddress,
                            status: 'failed',
                            message,
                        });
                        continue;
                    }

                    const data = await res.json();
                    if (typeof data.lat !== 'number' || typeof data.lng !== 'number') {
                        const message = `No coordinates returned for address "${address}".`;
                        reportLines.push(`⚠️ ${site.siteName} (${site.clientName}) – ${message}`);
                        structuredResults.push({
                            clientName: site.clientName,
                            siteName: site.siteName,
                            district: site.district,
                            siteAddress: site.siteAddress,
                            status: 'noResult',
                            message,
                        });
                        continue;
                    }

                    const lat = data.lat;
                    const lng = data.lng;
                    batch.update(doc(db, 'sites', site.id), {
                        geolocation: new GeoPoint(lat, lng),
                        latString: formatCoord(lat),
                        lngString: formatCoord(lng),
                        coordinateStatus: 'geocoded',
                        coordinateSource: 'geocode',
                        placeAccuracy: data.placeAccuracy ?? null,
                        updatedAt: serverTimestamp(),
                    });
                    pendingWrites++;

                    if (pendingWrites >= 400) {
                        await flushBatch();
                    }
                    reportLines.push(
                        `✅ ${site.siteName} (${site.clientName}) – ${formatCoord(lat)}, ${formatCoord(
                            lng,
                        )} (created)`,
                    );
                    structuredResults.push({
                        clientName: site.clientName,
                        siteName: site.siteName,
                        district: site.district,
                        siteAddress: site.siteAddress,
                        status: 'created',
                        message: 'created',
                        newLat: lat,
                        newLng: lng,
                    });
                } catch (e: any) {
                    console.error('Geocode failed for site', site.id, e);
                    const message = e?.message || 'Unexpected error during geocoding.';
                    reportLines.push(`❌ ${site.siteName} (${site.clientName}) – ${message}`);
                    structuredResults.push({
                        clientName: site.clientName,
                        siteName: site.siteName,
                        district: site.district,
                        siteAddress: site.siteAddress,
                        status: 'failed',
                        message,
                    });
                }
            }

            if (reportLines.length > 0) {
                await flushBatch();
                setGeocodeReport(reportLines.join('\n'));
                setGeocodeResults(structuredResults);
            }

            toast({
                title: 'Geocoding Completed',
                description: 'Missing site coordinates have been updated where possible.',
            });
            fetchSites('first');
            setCurrentPage(1);
        } catch (e: any) {
            console.error('Bulk geocoding error', e);
            toast({
                variant: 'destructive',
                title: 'Geocoding Failed',
                description: e?.message || 'An error occurred during geocoding.',
            });
        } finally {
            setIsGeocoding(false);
        }
    };

    const successCount = processedRecords.filter(r => r.status === 'success').length;
    const errorCount = processedRecords.filter(r => r.status === 'error').length;
    const duplicateCount = processedRecords.filter(r => r.status === 'duplicate').length;
    const createClientLocations = clientLocations.filter(location => location.clientId === createData.clientId);

    const toggleSiteSelection = (siteId: string) => {
        setSelectedSiteIds(prev =>
            prev.includes(siteId) ? prev.filter(id => id !== siteId) : [...prev, siteId],
        );
    };

    const toggleSelectAllOnPage = () => {
        if (!sites.length) return;
        const allIds = sites.map(s => s.id);
        const allSelected = allIds.every(id => selectedSiteIds.includes(id));
        if (allSelected) {
            setSelectedSiteIds(prev => prev.filter(id => !allIds.includes(id)));
        } else {
            setSelectedSiteIds(prev => Array.from(new Set([...prev, ...allIds])));
        }
    };

    const handleBulkDelete = async (mode: 'selected' | 'all') => {
        let ids: string[] = [];

        if (mode === 'selected') {
            if (!selectedSiteIds.length) {
                toast({ variant: 'destructive', title: 'No Sites Selected', description: 'Select one or more sites to delete.' });
                return;
            }
            ids = [...selectedSiteIds];
        } else {
            const snap = await getDocs(collection(db, 'sites'));
            ids = snap.docs.map(d => d.id);
            if (!ids.length) {
                toast({ variant: 'destructive', title: 'No Sites Found', description: 'There are no sites to delete.' });
                return;
            }
        }

        setIsSubmitting(true);
        try {
            // Firestore batch limit is 500 writes; delete in chunks to be safe
            const chunkSize = 400;
            for (let i = 0; i < ids.length; i += chunkSize) {
                const chunk = ids.slice(i, i + chunkSize);
                const batch = writeBatch(db);
                chunk.forEach(siteId => {
                    batch.delete(doc(db, 'sites', siteId));
                });
                await batch.commit();
            }

            toast({ title: 'Sites Deleted', description: `${ids.length} site(s) have been removed.` });
            setSelectedSiteIds([]);
            fetchSites('first');
            setCurrentPage(1);
        } catch (error: any) {
            console.error('Bulk delete failed', error);
            toast({ variant: 'destructive', title: 'Delete Failed', description: error?.message || 'Could not delete selected sites.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBackfillCoordinateMetadata = async () => {
        setIsSubmitting(true);
        try {
            const snapshot = await getDocs(collection(db, 'sites'));
            if (snapshot.empty) {
                toast({ title: 'No sites found', description: 'There are no duty sites to backfill.' });
                return;
            }

            let batch = writeBatch(db);
            let writes = 0;
            for (const siteDoc of snapshot.docs) {
                const raw = siteDoc.data() as any;
                const resolvedClient = clients.find(client => client.name === raw.clientName);
                const isTcs = String(raw.clientName || '').trim().toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase();
                batch.update(siteDoc.ref, {
                    clientId: raw.clientId ?? resolvedClient?.id ?? null,
                    coordinateStatus: deriveCoordinateStatus(raw),
                    coordinateSource: raw.coordinateSource ?? (hasValidCoordinates(raw.geolocation) ? 'manual' : null),
                    shiftMode: raw.shiftMode ?? (isTcs ? 'none' : 'fixed'),
                    shiftPattern: raw.shiftPattern ?? (isTcs ? null : '2x12'),
                    shiftTemplates: raw.shiftTemplates ?? (isTcs ? [] : buildShiftTemplates('2x12')),
                    locationKey: raw.locationKey ?? buildLocationIdentity([raw.clientName, raw.siteName, raw.district]),
                    updatedAt: serverTimestamp(),
                });
                writes += 1;

                if (writes >= 400) {
                    await batch.commit();
                    batch = writeBatch(db);
                    writes = 0;
                }
            }

            if (writes > 0) {
                await batch.commit();
            }

            toast({
                title: 'Site metadata backfilled',
                description: 'Existing sites now carry coordinate metadata and default shift settings.',
            });
            fetchSites('first');
        } catch (error: any) {
            console.error('Backfill failed', error);
            toast({
                variant: 'destructive',
                title: 'Backfill failed',
                description: error?.message || 'Could not backfill site metadata.',
            });
        } finally {
            setIsSubmitting(false);
        }
    };


    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                eyebrow="Admin"
                title="Duty Sites"
                description="Operational attendance and work-order locations linked to optional client locations."
                breadcrumbs={[
                    { label: "Dashboard", href: "/dashboard" },
                    { label: "Settings", href: "/settings" },
                    { label: "Duty Sites" },
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
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Instructions & Important Notes</AlertTitle>
                <AlertDescription>
                    <ul className="list-disc list-inside space-y-1">
                        <li>Duty sites remain the operational source of truth for attendance and work orders.</li>
                        <li>TCS sites stay flexible with no recurring shift timing.</li>
                        <li>Non-TCS sites can use fixed 2-shift/12-hour or 3-shift/8-hour patterns for attendance expectations.</li>
                        <li>Bulk import still supports <code>latitude,longitude</code>, with optional coordinate metadata columns.</li>
                    </ul>
                </AlertDescription>
            </Alert>

            <Card>
                <CardHeader>
                    <CardTitle>Bulk Duty-Site Import</CardTitle>
                    <CardDescription>Upload an Excel file to add multiple attendance/work-order sites at once.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex justify-between items-center">
                        <div className="flex gap-4">
                            <Button onClick={handleDownloadTemplate} variant="outline">
                                <Download className="mr-2 h-4 w-4" /> Download Template (.xlsx)
                            </Button>
                            <Button onClick={handleBackfillCoordinateMetadata} variant="outline" disabled={isSubmitting}>
                                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                                Backfill Site Metadata
                            </Button>
                        </div>
                        <Button onClick={() => setIsCreateOpen(true)}>
                            Add Duty Site
                        </Button>
                    </div>
                     <div className="flex flex-col sm:flex-row gap-4 items-center">
                        <div className="grid w-full max-w-sm items-center gap-1.5">
                            <Label htmlFor="site-file">Upload Completed File</Label>
                            <Input id="site-file" type="file" accept=".csv, .xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" onChange={handleFileChange} />
                        </div>
                        {file && (
                            <div className="flex items-center gap-2 p-2 border rounded-md bg-muted text-sm">
                                <FileCheck2 className="h-5 w-5 text-green-500" />
                                <span>{file.name}</span>
                            </div>
                        )}
                    </div>
                </CardContent>
                <CardFooter>
                    <Button onClick={processAndUpload} disabled={isProcessing || !file}>
                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                        {isProcessing ? 'Processing...' : 'Process & Upload File'}
                    </Button>
                </CardFooter>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Auto-Geocode Sites</CardTitle>
                    <CardDescription>
                        Fetch latitude/longitude for sites based on their address so that attendance can be validated against the correct location.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Clicking **Update Site Locations** will look up coordinates for any sites that do not yet have valid geolocation saved.
                        A secure server-side API (`/api/geocode-site`) is used so your geocoding API key is never exposed to the browser.
                    </p>
                    <div className="flex flex-wrap gap-3">
                        <Button onClick={handleAutoGeocode} disabled={isGeocoding}>
                            {isGeocoding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ListChecks className="mr-2 h-4 w-4" />}
                            {isGeocoding ? 'Updating site locations...' : 'Update Site Locations'}
                        </Button>
                        <Button variant="outline" onClick={handleDownloadGeocodeReport} disabled={!geocodeResults.length}>
                            <Download className="mr-2 h-4 w-4" />
                            Download Geocoding Report
                        </Button>
                    </div>
                    {geocodeReport && (
                        <div className="mt-3">
                            <Label className="text-xs font-medium text-muted-foreground">Geocoding Summary</Label>
                            <Textarea
                                className="mt-1 h-40 text-xs font-mono"
                                value={geocodeReport}
                                readOnly
                            />
                            <p className="mt-2 text-xs text-muted-foreground">
                                Entries marked with ❌ or ⚠️ could not be geocoded automatically. For those sites, open them in
                                the editor and manually paste the latitude/longitude (for example from Google Maps: right‑click
                                on the map &rarr; “What&apos;s here?” &rarr; copy the decimal coordinates).
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>
            {/* Create New Site Dialog */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Add Duty Site</DialogTitle>
                        <DialogDescription>Enter the operational site details used by attendance and work orders.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-2">
                            <Label htmlFor="new-client">Client</Label>
                            <Select
                                value={createData.clientId || undefined}
                                onValueChange={(value) => {
                                    const selectedClient = clients.find(client => client.id === value);
                                    const isTcs = (selectedClient?.name || '').trim().toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase();
                                    setCreateData({
                                        ...createData,
                                        clientId: value,
                                        clientName: selectedClient?.name ?? '',
                                        clientLocationId: undefined,
                                        clientLocationName: undefined,
                                        shiftMode: isTcs ? 'none' : 'fixed',
                                        shiftPattern: isTcs ? null : ((createData.shiftPattern as SiteShiftPattern | undefined) ?? '2x12'),
                                        shiftTemplates: isTcs ? [] : buildShiftTemplates(((createData.shiftPattern as SiteShiftPattern | undefined) ?? '2x12')),
                                    });
                                }}
                            >
                                <SelectTrigger id="new-client"><SelectValue placeholder="Select client" /></SelectTrigger>
                                <SelectContent>
                                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="new-site-name">Site Name</Label>
                            <Input id="new-site-name" value={createData.siteName || ''} onChange={(e) => setCreateData({ ...createData, siteName: e.target.value })} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="new-site-id">Site ID (optional)</Label>
                            <Input id="new-site-id" value={createData.siteId || ''} onChange={(e) => setCreateData({ ...createData, siteId: e.target.value })} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="new-address">Site Address</Label>
                            <Input id="new-address" value={createData.siteAddress || ''} onChange={(e) => setCreateData({ ...createData, siteAddress: e.target.value })} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="new-client-location">{(createData.clientName || '').trim().toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase() ? 'Linked TCS Center' : 'Linked Client Location'}</Label>
                            <Select
                                value={createData.clientLocationId || 'none'}
                                onValueChange={(value) => {
                                    if (value === 'none') {
                                        setCreateData({ ...createData, clientLocationId: undefined, clientLocationName: undefined });
                                        return;
                                    }
                                    const linkedLocation = createClientLocations.find(location => location.id === value);
                                    setCreateData({
                                        ...createData,
                                        clientLocationId: value,
                                        clientLocationName: linkedLocation?.locationName ?? undefined,
                                    });
                                }}
                            >
                                <SelectTrigger id="new-client-location"><SelectValue placeholder="Optional linked client location" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">No linked client location</SelectItem>
                                    {createClientLocations.map(location => (
                                        <SelectItem key={location.id} value={location.id}>{location.locationName}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">This links the duty site to a known physical branch or center when one exists.</p>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="new-district">District</Label>
                            <Select value={createData.district} onValueChange={(value) => setCreateData({ ...createData, district: value })}>
                                <SelectTrigger id="new-district"><SelectValue placeholder="Select district" /></SelectTrigger>
                                <SelectContent>
                                    {keralaDistricts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="new-geofence-radius">Geofence Radius (meters)</Label>
                            <Input
                                id="new-geofence-radius"
                                type="number"
                                min={1}
                                value={createData.geofenceRadiusMeters ?? 150}
                                onChange={(e) => setCreateData({ ...createData, geofenceRadiusMeters: Math.max(1, Number(e.target.value || 150)) })}
                            />
                        </div>
                        {(createData.clientName || '').trim().toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase() ? (
                            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                                TCS sites stay flexible. No recurring shift timing is enforced here.
                            </div>
                        ) : (
                            <div className="grid gap-3 rounded-lg border p-4">
                                <div className="space-y-1">
                                    <Label>Shift pattern</Label>
                                    <p className="text-xs text-muted-foreground">Attendance will automatically expect the next shift after the current shift ends.</p>
                                </div>
                                <Select
                                    value={(createData.shiftPattern as string | undefined) || '2x12'}
                                    onValueChange={(value) => {
                                        const pattern = value as SiteShiftPattern;
                                        setCreateData({
                                            ...createData,
                                            shiftMode: 'fixed',
                                            shiftPattern: pattern,
                                            shiftTemplates: buildShiftTemplates(pattern),
                                        });
                                    }}
                                >
                                    <SelectTrigger><SelectValue placeholder="Select shift pattern" /></SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(SHIFT_PATTERN_LABELS).map(([key, label]) => (
                                            <SelectItem key={key} value={key}>{label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <div className="grid gap-2 sm:grid-cols-3">
                                    {(createData.shiftTemplates || buildShiftTemplates((createData.shiftPattern as SiteShiftPattern | undefined) ?? '2x12')).map((shift) => (
                                        <div key={shift.code} className="rounded-md border bg-muted/20 p-3 text-sm">
                                            <p className="font-medium">{shift.label}</p>
                                            <p className="text-muted-foreground">{shift.startTime} - {shift.endTime}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <LocationEditorCard
                            entityType="site"
                            value={{
                                address: createData.siteAddress || '',
                                district: createData.district,
                                geolocation: createData.geolocation,
                                latString: createData.latString,
                                lngString: createData.lngString,
                                coordinateStatus: createData.coordinateStatus,
                                coordinateSource: createData.coordinateSource,
                                placeAccuracy: createData.placeAccuracy,
                            }}
                            onChange={(patch) => setCreateData({
                                ...createData,
                                siteAddress: patch.address ?? createData.siteAddress,
                                district: patch.district ?? createData.district,
                                geolocation: patch.geolocation,
                                latString: patch.latString,
                                lngString: patch.lngString,
                                coordinateStatus: patch.coordinateStatus,
                                coordinateSource: patch.coordinateSource,
                                placeAccuracy: patch.placeAccuracy ?? undefined,
                            })}
                            title="Duty-site coordinates"
                            description="Use geocoding or current location first. Manual entry stays available as a fallback."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                        <Button onClick={async () => {
                            if (!createData.clientId || !createData.clientName || !createData.siteName || !createData.siteAddress || !createData.district || !hasValidCoordinates(createData.geolocation)) {
                                toast({ variant: 'destructive', title: 'Missing Data', description: 'Please fill all required fields and confirm valid coordinates.' });
                                return;
                            }
                            const isTcs = createData.clientName.trim().toLowerCase() === OPERATIONAL_CLIENT_NAME.toLowerCase();
                            try {
                                setIsSubmitting(true);
                                await addDoc(collection(db, 'sites'), {
                                    clientId: createData.clientId,
                                    clientName: createData.clientName,
                                    siteName: createData.siteName,
                                    siteId: createData.siteId || null,
                                    siteAddress: createData.siteAddress,
                                    district: createData.district,
                                    geolocation: new GeoPoint(createData.geolocation!.latitude, createData.geolocation!.longitude),
                                    geofenceRadiusMeters: createData.geofenceRadiusMeters ?? 150,
                                    latString: createData.latString ?? formatCoord(createData.geolocation!.latitude),
                                    lngString: createData.lngString ?? formatCoord(createData.geolocation!.longitude),
                                    coordinateStatus: deriveCoordinateStatus(createData),
                                    coordinateSource: createData.coordinateSource ?? 'manual',
                                    placeAccuracy: createData.placeAccuracy ?? null,
                                    shiftMode: isTcs ? 'none' : 'fixed',
                                    shiftPattern: isTcs ? null : ((createData.shiftPattern as SiteShiftPattern | undefined) ?? '2x12'),
                                    shiftTemplates: isTcs ? [] : (createData.shiftTemplates || buildShiftTemplates((createData.shiftPattern as SiteShiftPattern | undefined) ?? '2x12')),
                                    clientLocationId: createData.clientLocationId ?? null,
                                    clientLocationName: createData.clientLocationName ?? null,
                                    locationKey: buildLocationIdentity([createData.clientName, createData.siteName, createData.district]),
                                    ...buildFirestoreCreateAudit(),
                                    auditTrail: arrayUnion(
                                        buildFirestoreAuditEvent('site_created', undefined, {
                                            clientName: createData.clientName,
                                            siteName: createData.siteName,
                                        }),
                                    ),
                                });
                                toast({ title: 'Site Created', description: 'The new site has been added.' });
                                setIsCreateOpen(false);
                                setCreateData({ clientId: operationalClient?.id || '', clientName: operationalClient?.name || '', siteName: '', siteAddress: '', district: '', geofenceRadiusMeters: 150, latString: '', lngString: '', coordinateStatus: 'missing', shiftMode: operationalClient ? 'none' : undefined });
                                fetchSites('first');
                                setCurrentPage(1);
                            } catch (e) {
                                toast({ variant: 'destructive', title: 'Create Failed', description: 'Could not create site. Please try again.' });
                            } finally {
                                setIsSubmitting(false);
                            }
                        }} disabled={isSubmitting}>Create Site</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {processedRecords.length > 0 && (
                 <Card>
                    <CardHeader>
                        <CardTitle>Import Results</CardTitle>
                        <CardDescription className="flex flex-col sm:flex-row flex-wrap gap-x-4 gap-y-2">
                            <span className="flex items-center gap-1 text-green-600"><CheckCircle className="h-4 w-4"/>Successful: {successCount}</span>
                            <span className="flex items-center gap-1 text-yellow-600"><AlertTriangle className="h-4 w-4"/>Duplicates (Skipped): {duplicateCount}</span>
                            <span className="flex items-center gap-1 text-red-600"><AlertTriangle className="h-4 w-4"/>Failed: {errorCount}</span>
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="max-h-96 overflow-y-auto">
                       <div className="space-y-2">
                            {processedRecords.map((record, index) => (
                                <div key={index} className={`p-3 border rounded-md ${record.status === 'success' ? 'bg-green-50 border-green-200' : record.status === 'duplicate' ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
                                    <p className="font-semibold text-sm">
                                        {record.data['Site Name']} ({record.data['Client Name'] || OPERATIONAL_CLIENT_NAME})
                                    </p>
                                    <p className={`text-xs ${record.status === 'success' ? 'text-green-700' : record.status === 'duplicate' ? 'text-yellow-700' : 'text-red-700'}`}>
                                        {record.message}
                                    </p>
                                </div>
                            ))}
                       </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Existing Duty Sites</CardTitle>
                    <CardDescription>A list of all currently managed operational sites in the system.</CardDescription>
                </CardHeader>
                 <CardContent>
                    <div className="grid grid-cols-1 gap-4 p-4 border-b sm:grid-cols-2 xl:grid-cols-5">
                        <div className="space-y-1.5">
                            <Label htmlFor="client-filter">Filter by Client</Label>
                            <Select value={selectedClient} onValueChange={setSelectedClient} disabled={isFilterDataLoading}>
                                <SelectTrigger id="client-filter"><SelectValue/></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Clients</SelectItem>
                                    {clients.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="district-filter">Filter by District</Label>
                            <Select value={selectedDistrict} onValueChange={setSelectedDistrict} disabled={isFilterDataLoading || selectedOfficer !== 'all'}>
                                <SelectTrigger id="district-filter"><SelectValue/></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Districts</SelectItem>
                                    {keralaDistricts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="officer-filter">Filter by Field Officer</Label>
                            <Select value={selectedOfficer} onValueChange={setSelectedOfficer} disabled={isFilterDataLoading}>
                                <SelectTrigger id="officer-filter"><SelectValue/></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Officers</SelectItem>
                                    {fieldOfficers.map(fo => <SelectItem key={fo.id} value={fo.id}>{fo.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="coordinate-status-filter">Coordinate State</Label>
                            <Select value={selectedCoordinateStatus} onValueChange={setSelectedCoordinateStatus} disabled={isFilterDataLoading}>
                                <SelectTrigger id="coordinate-status-filter"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All states</SelectItem>
                                    {Object.entries(coordinateStatusLabels).map(([key, label]) => (
                                        <SelectItem key={key} value={key}>{label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Bulk Actions</Label>
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={toggleSelectAllOnPage}
                                    disabled={isLoadingSites || !sites.length}
                                >
                                    Select {sites.length && sites.every(s => selectedSiteIds.includes(s.id)) ? 'None' : 'All on Page'}
                                </Button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            size="icon"
                                            disabled={isLoadingSites || (!selectedSiteIds.length && sites.length === 0)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                            <span className="sr-only">Delete options</span>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                            onClick={() => {
                                                setBulkDeleteMode('selected');
                                                setIsBulkDeleteDialogOpen(true);
                                            }}
                                            disabled={!selectedSiteIds.length}
                                        >
                                            Delete selected sites
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                setBulkDeleteMode('all');
                                                setIsBulkDeleteDialogOpen(true);
                                            }}
                                        >
                                            Delete ALL sites
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>
                    </div>
                     {isLoadingSites ? (
                        <div className="flex justify-center items-center h-40"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                    ) : sites.length === 0 ? (
                        <p className="text-center text-muted-foreground py-10">No sites found for the selected filters.</p>
                    ) : (
                        <div className="space-y-3 mt-4">
                            {sites.map(site => {
                                const isSelected = selectedSiteIds.includes(site.id);
                                return (
                                    <div
                                        key={site.id}
                                        className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 border rounded-lg shadow-sm ${
                                            isSelected ? 'bg-red-50/40 border-red-300' : ''
                                        }`}
                                    >
                                        <div className="flex items-start gap-3 flex-1 mb-2 sm:mb-0">
                                            <input
                                                type="checkbox"
                                                className="mt-1 h-4 w-4"
                                                checked={isSelected}
                                                onChange={() => toggleSiteSelection(site.id)}
                                            />
                                            <div className="flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="font-semibold">{site.siteName}</h3>
                                                    <Badge variant={deriveCoordinateStatus(site) === 'missing' ? 'destructive' : 'outline'}>
                                                        {coordinateStatusLabels[deriveCoordinateStatus(site)]}
                                                    </Badge>
                                                    <Badge variant="secondary">{site.clientName}</Badge>
                                                    <Badge variant="outline">{site.district}</Badge>
                                                    <Badge variant={site.shiftMode === 'fixed' ? 'default' : 'outline'}>
                                                        {site.shiftMode === 'fixed'
                                                            ? SHIFT_PATTERN_LABELS[(site.shiftPattern as SiteShiftPattern | undefined) ?? '2x12']
                                                            : 'Flexible'}
                                                    </Badge>
                                                </div>
                                                <p className="text-sm text-muted-foreground">
                                                    {site.clientLocationName ? `${site.clientLocationName} · ` : ''}{site.clientName}
                                                </p>
                                                <p className="text-xs text-muted-foreground mt-1">{site.siteAddress}</p>
                                                {site.geolocation && (
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        Lat, Long: {site.latString ?? formatCoord(site.geolocation.latitude)}, {site.lngString ?? formatCoord(site.geolocation.longitude)}
                                                    </p>
                                                )}
                                                {site.placeAccuracy ? (
                                                    <p className="text-xs text-muted-foreground mt-1">{site.placeAccuracy}</p>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2 self-start sm:self-center">
                                            {site.geolocation ? (
                                                <Button variant="outline" size="sm" asChild>
                                                    <a
                                                        href={buildGoogleMapsLink(site.geolocation.latitude, site.geolocation.longitude, site.siteName)}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        Open map
                                                    </a>
                                                </Button>
                                            ) : null}
                                            <Button variant="outline" size="sm" onClick={() => setEditingSite(site)}><Edit className="mr-2 h-4 w-4"/>Edit</Button>
                                            <Button variant="destructive" size="sm" onClick={() => setDeletingSite(site)}><Trash2 className="mr-2 h-4 w-4"/>Delete</Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
                 <CardFooter>
                    <div className="flex justify-between items-center w-full">
                        <span className="text-sm text-muted-foreground">Page {currentPage}</span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handlePrevPage} disabled={isLoadingSites || currentPage <= 1}>
                                <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleNextPage} disabled={isLoadingSites || !hasNextPage}>
                                Next <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardFooter>
            </Card>

            {/* Edit Dialog */}
            <Dialog open={!!editingSite} onOpenChange={(isOpen) => !isOpen && setEditingSite(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Site</DialogTitle>
                        <DialogDescription>Update the details for "{editingSite?.siteName}".</DialogDescription>
                    </DialogHeader>
                    {editingSite && <SiteEditForm site={editingSite} onSave={handleUpdateSite} isSaving={isSubmitting} onClose={() => setEditingSite(null)} clients={clients} clientLocations={clientLocations} />}
                </DialogContent>
            </Dialog>

            {/* Delete Dialog */}
            <AlertDialog open={!!deletingSite} onOpenChange={(isOpen) => !isOpen && setDeletingSite(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the site "{deletingSite?.siteName}". This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteSite} disabled={isSubmitting} className="bg-destructive hover:bg-destructive/90">
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Bulk Delete Dialog */}
            <AlertDialog
                open={isBulkDeleteDialogOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        setIsBulkDeleteDialogOpen(false);
                        setBulkDeleteMode(null);
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm bulk delete</AlertDialogTitle>
                        <AlertDialogDescription>
                            {bulkDeleteMode === 'all'
                                ? 'This will permanently delete ALL sites from the system. This cannot be undone.'
                                : `This will permanently delete ${selectedSiteIds.length} selected site(s). This cannot be undone.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isSubmitting || !bulkDeleteMode}
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={async () => {
                                if (!bulkDeleteMode) return;
                                await handleBulkDelete(bulkDeleteMode);
                                setIsBulkDeleteDialogOpen(false);
                                setBulkDeleteMode(null);
                            }}
                        >
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
