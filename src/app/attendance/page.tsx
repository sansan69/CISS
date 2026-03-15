
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QrCode, Camera, MapPin, CheckCircle, Clock3, Loader2, ListChecks, RefreshCcw, WifiOff, ScanLine, UserRoundSearch, Navigation, Sparkles, ArrowRight, RotateCcw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Image from 'next/image';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { storage } from '@/lib/firebase';
import { ref as storageRef, uploadString, getDownloadURL } from 'firebase/storage';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { haversineDistanceMeters } from '@/lib/geo';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type {
  AttendanceSubmission,
  DeviceAttendanceHistoryItem,
  QueuedAttendanceSubmission,
} from '@/types/attendance';

type SiteOption = {
  id: string;
  siteName: string;
  clientName: string;
  district: string;
  geofenceRadiusMeters?: number;
  lat?: number;
  lng?: number;
};

type ScannedEmployee = {
  id: string;                 // Firestore document ID
  employeeCode?: string;      // Human-readable employeeId like CISS/...
  fullName: string;
  phoneNumber?: string;
  clientName?: string;
};

type SuggestedSite = SiteOption & {
  distanceMeters: number;
  withinGeofence: boolean;
  matchedBy: 'client' | 'nearest';
};

const ATTENDANCE_QUEUE_STORAGE_KEY = 'ciss_attendance_queue_v1';
const ATTENDANCE_HISTORY_STORAGE_KEY = 'ciss_attendance_history_v1';

export default function AttendancePage() {
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [watermarkedPhoto, setWatermarkedPhoto] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lon: number; accuracyMeters?: number } | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string>("");
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [allSites, setAllSites] = useState<SiteOption[]>([]);
  const [isLoadingCenters, setIsLoadingCenters] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<'In' | 'Out'>('In');
  const [scannedEmployee, setScannedEmployee] = useState<ScannedEmployee | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [hasManualCenterOverride, setHasManualCenterOverride] = useState(false);
  const [autoDetectedSite, setAutoDetectedSite] = useState<SuggestedSite | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  
  const [isScanning, setIsScanning] = useState(false);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [isWatermarking, setIsWatermarking] = useState(false);
  const [manualEmployeeId, setManualEmployeeId] = useState('');

  const [recentAttendance, setRecentAttendance] = useState<DeviceAttendanceHistoryItem[]>([]);
  const [queuedAttendance, setQueuedAttendance] = useState<QueuedAttendanceSubmission[]>([]);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<BrowserMultiFormatReader | null>(null);
  const photoContainerRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();

  // Simplified: we only require a captured photo and a resolved employee
  const isSelectionComplete = !!selectedDistrict && !!selectedSiteId;
  const districtOptions = useMemo(
    () => Array.from(new Set(allSites.map((site) => site.district).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [allSites],
  );

  const selectedSite = useMemo(
    () => allSites.find((site) => site.id === selectedSiteId) ?? null,
    [allSites, selectedSiteId],
  );

  const districtSiteOptions = useMemo(() => {
    if (!selectedDistrict) return [];

    const options = allSites.filter((site) => site.district === selectedDistrict);
    if (!locationCoords) {
      return options.sort((a, b) => {
        if (a.clientName === b.clientName) {
          return a.siteName.localeCompare(b.siteName);
        }
        return a.clientName.localeCompare(b.clientName);
      });
    }

    return [...options].sort((a, b) => {
      const aDistance = typeof a.lat === 'number' && typeof a.lng === 'number'
        ? haversineDistanceMeters(locationCoords.lat, locationCoords.lon, a.lat, a.lng)
        : Number.POSITIVE_INFINITY;
      const bDistance = typeof b.lat === 'number' && typeof b.lng === 'number'
        ? haversineDistanceMeters(locationCoords.lat, locationCoords.lon, b.lat, b.lng)
        : Number.POSITIVE_INFINITY;
      return aDistance - bDistance;
    });
  }, [allSites, locationCoords, selectedDistrict]);

  const appendRecentAttendance = useCallback((item: DeviceAttendanceHistoryItem) => {
    setRecentAttendance((previous) => {
      const next = [item, ...previous.filter((entry) => entry.id !== item.id)].slice(0, 10);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ATTENDANCE_HISTORY_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const updateRecentAttendance = useCallback((id: string, patch: Partial<DeviceAttendanceHistoryItem>) => {
    setRecentAttendance((previous) => {
      const next = previous.map((entry) => entry.id === id ? { ...entry, ...patch } : entry);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ATTENDANCE_HISTORY_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const removeQueuedAttendance = useCallback((id: string) => {
    setQueuedAttendance((previous) => {
      const next = previous.filter((item) => item.id !== id);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ATTENDANCE_QUEUE_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const queueAttendanceSubmission = useCallback((queuedItem: QueuedAttendanceSubmission) => {
    setQueuedAttendance((previous) => {
      const next = [...previous, queuedItem];
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ATTENDANCE_QUEUE_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const fetchSites = async () => {
      setIsLoadingCenters(true);
      try {
        const snap = await getDocs(collection(db, 'sites'));
        const options: SiteOption[] = snap.docs.map((d) => {
          const data = d.data() as any;
          const geo = data.geolocation;
          const lat = typeof geo?.latitude === 'number' ? geo.latitude : (geo?.lat || parseFloat(data.latString || '0'));
          const lng = typeof geo?.longitude === 'number' ? geo.longitude : (geo?.lng || parseFloat(data.lngString || '0'));

          return {
            id: d.id,
            siteName: data.siteName,
            clientName: data.clientName,
            district: data.district,
            geofenceRadiusMeters: typeof data.geofenceRadiusMeters === 'number' ? data.geofenceRadiusMeters : undefined,
            lat,
            lng,
          };
        });
        setAllSites(options);
      } catch (e: any) {
        console.error('Failed loading sites', e);
        toast({ variant: 'destructive', title: 'Error loading centers', description: e.message || 'Try again.' });
      } finally {
        setIsLoadingCenters(false);
      }
    };
    fetchSites();
  }, [toast]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const findSuggestedSite = useCallback((coords: { lat: number; lon: number }, preferredClient?: string | null) => {
    const candidates = allSites
      .filter((site) => typeof site.lat === 'number' && typeof site.lng === 'number')
      .map((site) => {
        const distanceMeters = haversineDistanceMeters(coords.lat, coords.lon, site.lat!, site.lng!);
        const allowedRadius = site.geofenceRadiusMeters || 150;
        return {
          ...site,
          distanceMeters,
          withinGeofence: distanceMeters <= allowedRadius,
          matchedBy: preferredClient && site.clientName === preferredClient ? 'client' as const : 'nearest' as const,
        };
      });

    if (candidates.length === 0) return null;

    const preferredMatches = preferredClient
      ? candidates.filter((site) => site.clientName === preferredClient)
      : [];
    const pool = preferredMatches.length > 0 ? preferredMatches : candidates;

    return [...pool].sort((a, b) => {
      if (a.withinGeofence !== b.withinGeofence) {
        return a.withinGeofence ? -1 : 1;
      }
      return a.distanceMeters - b.distanceMeters;
    })[0] ?? null;
  }, [allSites]);

  const applySuggestedSite = useCallback((site: SuggestedSite | null, options?: { silent?: boolean }) => {
    if (!site) return;

    setAutoDetectedSite(site);
    setSelectedDistrict(site.district);
    setSelectedSiteId(site.id);

    if (!options?.silent) {
      toast({
        title: site.withinGeofence ? 'Duty center detected' : 'Nearest duty center suggested',
        description: `${site.siteName}, ${site.district}${Number.isFinite(site.distanceMeters) ? ` • ${Math.round(site.distanceMeters)}m away` : ''}`,
      });
    }
  }, [toast]);

  useEffect(() => {
    if (!locationCoords || allSites.length === 0 || hasManualCenterOverride) return;
    const suggestion = findSuggestedSite(locationCoords, scannedEmployee?.clientName ?? null);
    applySuggestedSite(suggestion, { silent: true });
  }, [allSites, applySuggestedSite, findSuggestedSite, hasManualCenterOverride, locationCoords, scannedEmployee?.clientName]);

  const handleStartVerification = async () => {
    setIsFetchingLocation(true);
    setIsTakingPhoto(true);

    try {
      if (!locationCoords) {
        await getDeviceLocation();
      }
      // Start scanner which will also start the camera stream
      await handleScanAndCapture();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Verification Error", description: error.message });
      resetVerificationState({ keepCenter: true, keepLocation: true });
    } finally {
      setIsFetchingLocation(false);
    }
  };

  const getDeviceLocation = () => new Promise<{ lat: number; lon: number; accuracyMeters?: number }>((resolve, reject) => {
    if (!navigator.geolocation) {
      setIsFetchingLocation(false);
      return reject(new Error("Geolocation is not supported by this browser."));
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setLocationCoords({ lat: latitude, lon: longitude, accuracyMeters: accuracy });
        setLocation(`Lat: ${latitude.toFixed(4)}, Lon: ${longitude.toFixed(4)}${accuracy ? ` (±${Math.round(accuracy)}m)` : ''}`);
        setIsFetchingLocation(false);
        toast({ title: "Location Acquired", description: "Device location captured." });
        resolve({ lat: latitude, lon: longitude, accuracyMeters: accuracy });
      },
      (error) => {
        console.error("Error getting location:", error);
        setLocation('Error: Could not fetch');
        setIsFetchingLocation(false);
        reject(new Error("Could not fetch device location. Please enable location services."));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
  
  const startCameraStream = () => new Promise<void>((resolve, reject) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setIsTakingPhoto(false);
      return reject(new Error("Camera is not supported by your browser."));
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      .then(stream => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            resolve();
          };
        }
      })
      .catch(err => {
        console.error("Error accessing camera:", err);
        setIsTakingPhoto(false);
        reject(new Error("Could not access camera. Please enable camera permissions."));
      });
  });

  const stopScanner = () => {
    try {
      (scannerRef.current as any)?.reset?.();
    } catch {}
    if (videoRef.current) {
      const stream = videoRef.current.srcObject as MediaStream | null;
      stream?.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsTakingPhoto(false);
    setIsScanning(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 1280;
    canvas.height = videoRef.current.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const photoDataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setCapturedPhoto(photoDataUrl);
    toast({ title: 'Photo Captured' });
    // Stop camera/decoder after capturing photo so UI can proceed to submit
    stopScanner();
    setIsTakingPhoto(false);
  };

  const parseEmployeeIdFromText = (text: string): string | null => {
    const m = text.match(/Employee\s*ID\s*:\s*([^\n]+)/i);
    if (m && m[1]) return m[1].trim();
    // fallback: first line if contains CISS pattern
    const firstLine = text.split(/\n|\r/)[0]?.trim();
    if (/CISS\//i.test(firstLine)) return firstLine;
    return null;
  };

  const fetchEmployeeByEmployeeId = async (empId: string) => {
    const snap = await getDocs(query(collection(db, 'employees'), where('employeeId', '==', empId), limit(1)));
    if (snap.empty) return null;
    const d = snap.docs[0];
    const data = d.data() as any;
  return {
    id: d.id,
    employeeCode: data.employeeId,
    fullName: data.fullName,
    phoneNumber: data.phoneNumber,
    clientName: data.clientName,
  } as ScannedEmployee;
  };

  const handleScanAndCapture = async () => {
    setIsScanning(true);
    try {
      // Initialize scanner with QR-only hints and try-harder
      if (!scannerRef.current) {
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        scannerRef.current = new BrowserMultiFormatReader(hints);
      }

      // Use explicit constraints for better reliability (rear camera, HD)
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' } as any,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      let controls: any;
      try {
        controls = await scannerRef.current.decodeFromConstraints(
          constraints,
          videoRef.current!,
          (result, err, ctrl) => {
            if (result && !hasScanned) {
              const text = result.getText();
              setScanResult(text);
              const parsedId = parseEmployeeIdFromText(text);
              if (parsedId) {
                fetchEmployeeByEmployeeId(parsedId).then((emp) => {
                  if (emp) {
                    setScannedEmployee(emp);
                    toast({ title: 'QR Code Scanned', description: `${emp.fullName} (${parsedId})` });
                  } else {
                    toast({ variant: 'destructive', title: 'Employee Not Found', description: `ID ${parsedId} not found` });
                  }
                });
              } else {
                toast({ variant: 'destructive', title: 'Invalid QR', description: 'Could not parse Employee ID' });
              }
              setHasScanned(true);
              setIsScanning(false);
            }
          }
        );
      } catch (err) {
        // Fallback with minimal constraints for broader mobile support
        const minimal: MediaStreamConstraints = { video: { facingMode: 'environment' } as any, audio: false };
        controls = await scannerRef.current.decodeFromConstraints(
          minimal,
          videoRef.current!,
          (result, e2, ctrl) => {
            if (result && !hasScanned) {
              const text = result.getText();
              setScanResult(text);
              const parsedId = parseEmployeeIdFromText(text);
              if (parsedId) {
                fetchEmployeeByEmployeeId(parsedId).then((emp) => {
                  if (emp) {
                    setScannedEmployee(emp);
                    toast({ title: 'QR Code Scanned', description: `${emp.fullName} (${parsedId})` });
                  } else {
                    toast({ variant: 'destructive', title: 'Employee Not Found', description: `ID ${parsedId} not found` });
                  }
                });
              } else {
                toast({ variant: 'destructive', title: 'Invalid QR', description: 'Could not parse Employee ID' });
              }
              setHasScanned(true);
              setIsScanning(false);
            }
          }
        );
      }
      (scannerRef.current as any)._controls = controls;
    } catch (e: any) {
      console.error('Scanner error', e);
      toast({ variant: 'destructive', title: 'Scanner Error', description: e?.message || 'Failed to start scanner' });
      setIsScanning(false);
    }
  };

  const handleRescan = () => {
    setHasScanned(false);
    setScanResult(null);
    setScannedEmployee(null);
    setCapturedPhoto(null);
    setWatermarkedPhoto(null);
    toast({ title: 'Ready to rescan', description: 'Show the QR code to the camera.' });
    // restart scanner
    setIsTakingPhoto(true);
    handleScanAndCapture();
  };

  const refreshSuggestedCenter = useCallback(() => {
    if (!locationCoords) {
      toast({
        variant: 'destructive',
        title: 'Location needed',
        description: 'Start attendance once so the app can detect the nearest duty center.',
      });
      return;
    }

    const suggestion = findSuggestedSite(locationCoords, scannedEmployee?.clientName ?? null);
    if (!suggestion) {
      toast({
        variant: 'destructive',
        title: 'No nearby center found',
        description: 'Please choose the duty center manually.',
      });
      return;
    }

    setHasManualCenterOverride(false);
    applySuggestedSite(suggestion);
  }, [applySuggestedSite, findSuggestedSite, locationCoords, scannedEmployee?.clientName, toast]);

  const withRetry = async <T,>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 500): Promise<T> => {
    let lastErr: any;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const delay = baseDelayMs * Math.pow(2, i);
        await new Promise(res => setTimeout(res, delay));
      }
    }
    throw lastErr;
  };

  const computeAttendanceDocId = (employeeId: string, siteId: string, status: 'In' | 'Out'): string => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${employeeId}:${siteId}:${yyyy}-${mm}-${dd}:${status}`;
  };

  const buildHistoryItem = useCallback((
    id: string,
    payload: Omit<AttendanceSubmission, 'photoUrl'>,
    photoUrl?: string,
    syncStatus: DeviceAttendanceHistoryItem['syncStatus'] = 'synced',
  ): DeviceAttendanceHistoryItem => ({
    id,
    employeeId: payload.employeeId,
    employeeName: payload.employeeName,
    status: payload.status,
    time: new Date().toLocaleTimeString(),
    district: payload.district,
    siteName: payload.siteName,
    clientName: payload.clientName,
    location: payload.locationText,
    photoUrl,
    syncStatus,
  }), []);

  const isRetryableAttendanceError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || '');
    return /failed to fetch|network|fetch|timeout|offline/i.test(message);
  };

  const submitAttendanceOnline = useCallback(async (
    payloadWithoutPhotoUrl: Omit<AttendanceSubmission, 'photoUrl'>,
    photoDataUrl: string,
  ) => {
    const ts = Date.now();
    const phone = payloadWithoutPhotoUrl.employeePhoneNumber || 'unknown';
    const path = `employees/${phone}/attendance/${ts}_attendance.jpg`;
    const ref = storageRef(storage, path);

    await withRetry(() => uploadString(ref, photoDataUrl, 'data_url'));
    const photoUrl = await withRetry(() => getDownloadURL(ref));

    const response = await fetch('/api/attendance/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...payloadWithoutPhotoUrl,
        photoUrl,
      }),
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({}));
      throw new Error(responseBody.error || 'Could not submit attendance.');
    }

    return {
      photoUrl,
      recordId: `${payloadWithoutPhotoUrl.employeeId}-${ts}`,
    };
  }, []);

  const flushQueuedAttendance = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (isSyncingQueue || queuedAttendance.length === 0) return;

    setIsSyncingQueue(true);
    try {
      for (const queuedItem of queuedAttendance) {
        try {
          const { photoDataUrl, ...payloadWithoutPhotoUrl } = queuedItem.payload;
          const result = await submitAttendanceOnline(payloadWithoutPhotoUrl, photoDataUrl);
          updateRecentAttendance(queuedItem.id, {
            syncStatus: 'synced',
            photoUrl: result.photoUrl,
          });
          removeQueuedAttendance(queuedItem.id);
        } catch (error) {
          if (isRetryableAttendanceError(error)) {
            break;
          }

          updateRecentAttendance(queuedItem.id, {
            syncStatus: 'failed',
          });
          removeQueuedAttendance(queuedItem.id);
        }
      }
    } finally {
      setIsSyncingQueue(false);
    }
  }, [isSyncingQueue, queuedAttendance, removeQueuedAttendance, submitAttendanceOnline, updateRecentAttendance]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const storedQueue = window.localStorage.getItem(ATTENDANCE_QUEUE_STORAGE_KEY);
      const storedHistory = window.localStorage.getItem(ATTENDANCE_HISTORY_STORAGE_KEY);
      if (storedQueue) {
        setQueuedAttendance(JSON.parse(storedQueue));
      }
      if (storedHistory) {
        setRecentAttendance(JSON.parse(storedHistory));
      }
    } catch (error) {
      console.error('Could not restore attendance cache:', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      flushQueuedAttendance();
    };

    window.addEventListener('online', handleOnline);
    if (navigator.onLine) {
      flushQueuedAttendance();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [flushQueuedAttendance]);
  
  // Simplified: no heavy verification; treat captured photo as ready for upload
  useEffect(() => {
    if (capturedPhoto) {
      setWatermarkedPhoto(capturedPhoto);
            setIsWatermarking(false);
        }
  }, [capturedPhoto]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { (scannerRef.current as any)?._controls?.stop(); } catch {}
      stopScanner();
    };
  }, []);

  const handleSubmitAttendance = async () => {
    if (!isSelectionComplete) {
      toast({ variant: 'destructive', title: 'Select District & Site', description: 'Please choose district and site before submitting.' });
      return;
    }
    if (!capturedPhoto || !scannedEmployee) {
      toast({ variant: 'destructive', title: 'Incomplete Verification', description: 'Scan QR (or use manual ID) and capture photo before submitting.' });
      return;
    }
    // Geofence: ensure within 150 meters of selected site
    if (!selectedSite || selectedSite.lat == null || selectedSite.lng == null) {
      toast({ variant: 'destructive', title: 'Site Location Missing', description: 'Selected site does not have coordinates configured.' });
      return;
    }
    if (!locationCoords) {
      toast({
        variant: 'destructive',
        title: 'Location Not Captured',
        description: 'GPS location could not be captured. Please ensure location is enabled and tap "Start Verification" again.',
      });
      return;
    }

    // Additional safety: ensure employee is marking attendance only for their client
    if (scannedEmployee.clientName && selectedSite.clientName && scannedEmployee.clientName !== selectedSite.clientName) {
      toast({
        variant: 'destructive',
        title: 'Invalid Site for Employee',
        description: `This site belongs to ${selectedSite.clientName}, but you are assigned to ${scannedEmployee.clientName}.`,
      });
      return;
    }

    const distance = haversineDistanceMeters(locationCoords.lat, locationCoords.lon, selectedSite.lat, selectedSite.lng);
    const allowedRadius = selectedSite.geofenceRadiusMeters || 150;
    if (distance > allowedRadius) {
      toast({
        variant: 'destructive',
        title: 'Outside Allowed Radius',
        description: `You are approximately ${Math.round(distance)} meters away from the selected site. You must be within ${allowedRadius} meters to mark attendance.`,
      });
      return;
    }

    const payloadWithoutPhotoUrl: Omit<AttendanceSubmission, 'photoUrl'> = {
      employeeId: scannedEmployee.employeeCode || scannedEmployee.id,
      employeeDocId: scannedEmployee.id,
      employeeName: scannedEmployee.fullName,
      employeePhoneNumber: scannedEmployee.phoneNumber,
      employeeClientName: scannedEmployee.clientName,
      status: selectedStatus,
      district: selectedDistrict,
      siteId: selectedSiteId,
      siteName: selectedSite.siteName,
      clientName: selectedSite.clientName,
      siteCoords: { lat: selectedSite.lat, lng: selectedSite.lng },
      locationText: location || '',
      locationCoords,
      distanceMeters: Math.round(distance),
      locationAccuracyMeters: locationCoords?.accuracyMeters ? Math.round(locationCoords.accuracyMeters) : null,
      deviceInfo: { userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown' },
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const queuedItem: QueuedAttendanceSubmission = {
        id: `${Date.now()}`,
        createdAt: new Date().toISOString(),
        payload: {
          ...payloadWithoutPhotoUrl,
          photoDataUrl: watermarkedPhoto || capturedPhoto,
        },
      };
      queueAttendanceSubmission(queuedItem);
      appendRecentAttendance(buildHistoryItem(queuedItem.id, payloadWithoutPhotoUrl, undefined, 'queued'));
      toast({
        title: 'Attendance queued',
        description: 'You are offline. The attendance entry will sync automatically when the connection returns.',
      });
      resetVerificationState({ keepCenter: true, keepLocation: true });
      return;
    }

    try {
      const result = await submitAttendanceOnline(
        payloadWithoutPhotoUrl,
        watermarkedPhoto || capturedPhoto,
      );
      appendRecentAttendance(
        buildHistoryItem(result.recordId, payloadWithoutPhotoUrl, result.photoUrl, 'synced'),
      );
      toast({ title: 'Attendance Submitted', description: `${scannedEmployee.fullName} ${selectedStatus.toLowerCase()} recorded.` });
      resetVerificationState({ keepCenter: true, keepLocation: true });
    } catch (e: any) {
      console.error('Submit failed', e);
      if (isRetryableAttendanceError(e)) {
        const queuedItem: QueuedAttendanceSubmission = {
          id: `${Date.now()}`,
          createdAt: new Date().toISOString(),
          payload: {
            ...payloadWithoutPhotoUrl,
            photoDataUrl: watermarkedPhoto || capturedPhoto,
          },
        };
        queueAttendanceSubmission(queuedItem);
        appendRecentAttendance(buildHistoryItem(queuedItem.id, payloadWithoutPhotoUrl, undefined, 'queued'));
        toast({
          title: 'Attendance queued',
          description: 'Network issue detected. The entry was saved locally and will retry automatically.',
        });
        resetVerificationState({ keepCenter: true, keepLocation: true });
        return;
      }

      const failedId = `${Date.now()}`;
      appendRecentAttendance(buildHistoryItem(failedId, payloadWithoutPhotoUrl, undefined, 'failed'));
      toast({ variant: 'destructive', title: 'Submit Failed', description: e?.message || 'Could not submit attendance.' });
    }
  };

  const resetVerificationState = (options?: { keepCenter?: boolean; keepLocation?: boolean }) => {
      setScanResult(null);
      setCapturedPhoto(null);
      setWatermarkedPhoto(null);
      if (!options?.keepLocation) {
        setLocation(null);
        setLocationCoords(null);
        setAutoDetectedSite(null);
      }
      if (!options?.keepCenter) {
        setSelectedDistrict('');
        setSelectedSiteId('');
        setHasManualCenterOverride(false);
      }
      setScannedEmployee(null);
      setHasScanned(false);
      setIsScanning(false);
      setIsTakingPhoto(false);
      setIsFetchingLocation(false);
      setIsWatermarking(false);
  };

  const isLoading = isFetchingLocation || isTakingPhoto || isScanning || isWatermarking;
  const canSubmit = isSelectionComplete && !!scannedEmployee && !!capturedPhoto && !isTakingPhoto && !isScanning;
  const verificationStarted = isFetchingLocation || isTakingPhoto || !!capturedPhoto || !!scannedEmployee;
  const completionCount = [isSelectionComplete, !!scannedEmployee, !!capturedPhoto].filter(Boolean).length;
  const selectedSiteDistance = selectedSite && locationCoords && typeof selectedSite.lat === 'number' && typeof selectedSite.lng === 'number'
    ? haversineDistanceMeters(locationCoords.lat, locationCoords.lon, selectedSite.lat, selectedSite.lng)
    : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:gap-6 md:p-6">
      <Card className="overflow-hidden border-primary/15 bg-gradient-to-br from-background via-background to-primary/5">
        <CardContent className="grid gap-4 p-5 md:grid-cols-[1.2fr_0.8fr] md:p-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em]">
                Attendance Terminal
              </Badge>
              <Badge variant={queuedAttendance.length > 0 ? 'secondary' : 'outline'} className="rounded-full px-3 py-1">
                {queuedAttendance.length > 0 ? `${queuedAttendance.length} queued` : 'Sync ready'}
              </Badge>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Record Attendance</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">
                The app now tries to fill today&apos;s duty center from the current location. Most users only need to confirm the employee, take one photo, and submit.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-1">
            <div className="rounded-2xl border bg-background/90 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <Clock3 className="h-4 w-4" />
                Current Time
              </div>
              <p className="mt-2 text-lg font-semibold">{currentTime.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
              <p className="text-sm text-muted-foreground">{currentTime.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</p>
            </div>
            <div className="rounded-2xl border bg-background/90 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <Navigation className="h-4 w-4" />
                Duty Center
              </div>
              <p className="mt-2 text-base font-semibold">
                {selectedSite ? selectedSite.siteName : 'Will auto-detect after location is available'}
              </p>
              <p className="text-sm text-muted-foreground">
                {selectedSite ? `${selectedSite.clientName} • ${selectedDistrict}` : 'You can still choose manually if needed.'}
              </p>
            </div>
            <div className="rounded-2xl border bg-background/90 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <ListChecks className="h-4 w-4" />
                Progress
              </div>
              <p className="mt-2 text-base font-semibold">{completionCount}/3 steps ready</p>
              <Progress value={(completionCount / 3) * 100} className="mt-3 h-2" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Alert>
        {queuedAttendance.length > 0 ? <WifiOff className="h-4 w-4" /> : <RefreshCcw className="h-4 w-4" />}
        <AlertTitle>{queuedAttendance.length > 0 ? 'Offline entries waiting' : 'Sync status is healthy'}</AlertTitle>
        <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {queuedAttendance.length > 0
              ? `${queuedAttendance.length} attendance entr${queuedAttendance.length === 1 ? 'y is' : 'ies are'} stored on this device and ready to sync.`
              : 'No pending attendance entries on this device right now.'}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={flushQueuedAttendance} disabled={isSyncingQueue || queuedAttendance.length === 0}>
            {isSyncingQueue ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            Sync now
          </Button>
        </AlertDescription>
      </Alert>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/30">
            <CardTitle>Guided Attendance Flow</CardTitle>
            <CardDescription>
              Step 1 confirms the duty center. Step 2 identifies the employee. Step 3 captures the photo and submits the attendance mark.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 p-5 md:p-6">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border p-4">
                <div className="flex items-center gap-3">
                  <div className={`rounded-full p-2 ${isSelectionComplete ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">1. Duty center</p>
                    <p className="text-xs text-muted-foreground">{isSelectionComplete ? 'Ready' : 'Needs confirmation'}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border p-4">
                <div className="flex items-center gap-3">
                  <div className={`rounded-full p-2 ${scannedEmployee ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                    <UserRoundSearch className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">2. Employee</p>
                    <p className="text-xs text-muted-foreground">{scannedEmployee ? scannedEmployee.fullName : 'Scan QR or enter ID'}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border p-4">
                <div className="flex items-center gap-3">
                  <div className={`rounded-full p-2 ${capturedPhoto ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                    <Camera className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">3. Photo + submit</p>
                    <p className="text-xs text-muted-foreground">{capturedPhoto ? 'Photo ready' : 'Take a live photo'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">Start attendance</p>
                  <p className="text-sm text-muted-foreground">
                    This opens the camera and captures the current location for today&apos;s duty center.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button onClick={handleStartVerification} disabled={isLoading} className="min-w-[180px]">
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanLine className="mr-2 h-4 w-4" />}
                    {verificationStarted ? 'Continue scanning' : 'Start attendance'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setHasManualCenterOverride(false);
                      refreshSuggestedCenter();
                    }}
                    disabled={!locationCoords || isLoadingCenters}
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Recheck center
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm font-semibold">Detected duty center</p>
                  <p className="mt-1 text-base font-semibold">
                    {selectedSite ? selectedSite.siteName : 'No center selected yet'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedSite
                      ? `${selectedSite.clientName} • ${selectedDistrict}`
                      : 'Location will suggest the nearest center automatically.'}
                  </p>
                  {selectedSiteDistance != null && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      About {Math.round(selectedSiteDistance)} meters from current location
                    </p>
                  )}
                  {autoDetectedSite && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="secondary">
                        {autoDetectedSite.matchedBy === 'client' ? 'Matched to employee client' : 'Nearest center selected'}
                      </Badge>
                      <Badge variant={autoDetectedSite.withinGeofence ? 'outline' : 'secondary'}>
                        {autoDetectedSite.withinGeofence ? 'Inside allowed radius' : 'Please review center before submit'}
                      </Badge>
                    </div>
                  )}
                </div>
                <div className="w-full max-w-sm rounded-2xl border bg-background p-3">
                  <div className="grid gap-3">
                    <div>
                      <Label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Mark status</Label>
                      <RadioGroup
                        value={selectedStatus}
                        onValueChange={(value) => setSelectedStatus(value as 'In' | 'Out')}
                        className="mt-2 grid grid-cols-2 gap-2"
                      >
                        <Label htmlFor="status-in" className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${selectedStatus === 'In' ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'}`}>
                          <RadioGroupItem value="In" id="status-in" className="sr-only" />
                          <ArrowRight className="h-4 w-4 rotate-[-90deg]" />
                          Mark IN
                        </Label>
                        <Label htmlFor="status-out" className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${selectedStatus === 'Out' ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'}`}>
                          <RadioGroupItem value="Out" id="status-out" className="sr-only" />
                          <ArrowRight className="h-4 w-4 rotate-90" />
                          Mark OUT
                        </Label>
                      </RadioGroup>
                    </div>
                    <Button onClick={handleSubmitAttendance} disabled={!canSubmit} size="lg" className="w-full">
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Submit attendance
                    </Button>
                  </div>
                </div>
              </div>

              <Accordion type="single" collapsible className="mt-4">
                <AccordionItem value="manual-center">
                  <AccordionTrigger>Change duty center manually</AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-4 pt-2 md:grid-cols-2">
                      <div className="grid gap-2">
                        <Label>District</Label>
                        <Select
                          value={selectedDistrict}
                          onValueChange={(value) => {
                            setHasManualCenterOverride(true);
                            setSelectedDistrict(value);
                            setSelectedSiteId('');
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={isLoadingCenters ? 'Loading districts...' : 'Select district'} />
                          </SelectTrigger>
                          <SelectContent>
                            {districtOptions.map((district) => (
                              <SelectItem key={district} value={district}>{district}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Center / Site</Label>
                        <Select
                          value={selectedSiteId}
                          onValueChange={(value) => {
                            setHasManualCenterOverride(true);
                            setSelectedSiteId(value);
                          }}
                          disabled={!selectedDistrict || districtSiteOptions.length === 0}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={!selectedDistrict ? 'Select district first' : 'Select center'} />
                          </SelectTrigger>
                          <SelectContent>
                            {districtSiteOptions.map((site) => {
                              const distance = locationCoords && typeof site.lat === 'number' && typeof site.lng === 'number'
                                ? Math.round(haversineDistanceMeters(locationCoords.lat, locationCoords.lon, site.lat, site.lng))
                                : null;
                              return (
                                <SelectItem key={site.id} value={site.id}>
                                  {site.siteName} - {site.clientName}{distance != null ? ` (${distance}m)` : ''}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
              <div className="space-y-4">
                <div
                  ref={photoContainerRef}
                  className="relative aspect-[4/3] overflow-hidden rounded-3xl border bg-muted/40"
                >
                  {isTakingPhoto && <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />}
                  {capturedPhoto && (
                    <Image
                      src={capturedPhoto}
                      alt="Captured photo"
                      fill
                      className="object-cover"
                      data-ai-hint="employee attendance photo"
                    />
                  )}
                  {!isTakingPhoto && !capturedPhoto && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                      <Camera className="h-10 w-10" />
                      <div>
                        <p className="font-medium text-foreground">Camera preview will appear here</p>
                        <p className="text-sm">Start attendance, scan the employee, then capture the photo.</p>
                      </div>
                    </div>
                  )}
                  {capturedPhoto && (
                    <div className="absolute inset-x-0 bottom-0 bg-black/55 p-3 text-xs text-white">
                      <p>{currentTime.toLocaleDateString('en-IN')} • {currentTime.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</p>
                      <p>{location || 'Location available'}</p>
                      {selectedSite && <p>{selectedSite.siteName}, {selectedDistrict}</p>}
                    </div>
                  )}
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <Button onClick={capturePhoto} disabled={!hasScanned || isWatermarking || !isTakingPhoto} className="w-full">
                    <Camera className="mr-2 h-4 w-4" />
                    Capture photo
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setCapturedPhoto(null);
                      setWatermarkedPhoto(null);
                      setIsTakingPhoto(true);
                    }}
                    disabled={!verificationStarted}
                    className="w-full"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Retake photo
                  </Button>
                  <Button onClick={handleRescan} variant="secondary" disabled={isLoading || !verificationStarted} className="w-full">
                    <QrCode className="mr-2 h-4 w-4" />
                    Rescan QR
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border p-4">
                  <div className="flex items-start gap-3">
                    <div className={`rounded-full p-2 ${scannedEmployee ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                      <UserRoundSearch className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold">Employee</p>
                      <p className="text-sm text-muted-foreground">
                        {scannedEmployee ? `${scannedEmployee.fullName} (${scannedEmployee.employeeCode || scannedEmployee.id})` : 'Use QR scan first. Manual ID is available below only when needed.'}
                      </p>
                    </div>
                  </div>
                </div>

                <Accordion type="single" collapsible className="rounded-2xl border px-4">
                  <AccordionItem value="manual-id" className="border-none">
                    <AccordionTrigger>Use manual employee ID instead</AccordionTrigger>
                    <AccordionContent>
                      <div className="grid gap-2 pb-2 sm:grid-cols-[1fr_auto]">
                        <Input placeholder="Enter employee ID" value={manualEmployeeId} onChange={(e) => setManualEmployeeId(e.target.value)} />
                        <Button
                          variant="outline"
                          onClick={async () => {
                            if (!manualEmployeeId.trim()) {
                              toast({ variant: 'destructive', title: 'Enter employee ID' });
                              return;
                            }
                            const emp = await fetchEmployeeByEmployeeId(manualEmployeeId.trim());
                            if (emp) {
                              setScannedEmployee(emp);
                              setScanResult(`Manual:${manualEmployeeId.trim()}`);
                              setHasScanned(true);
                              toast({ title: 'Employee selected', description: emp.fullName });
                            } else {
                              toast({ variant: 'destructive', title: 'Not found', description: 'No employee with that ID.' });
                            }
                          }}
                        >
                          Use ID
                        </Button>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <div className="rounded-2xl border p-4">
                  <p className="font-semibold">Ready-to-submit review</p>
                  <div className="mt-3 space-y-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Duty center</span>
                      <span className="text-right font-medium">{selectedSite ? `${selectedSite.siteName}, ${selectedDistrict}` : 'Pending'}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Employee</span>
                      <span className="text-right font-medium">{scannedEmployee ? scannedEmployee.fullName : 'Pending'}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Photo</span>
                      <span className="text-right font-medium">{capturedPhoto ? 'Ready' : 'Pending'}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Attendance mark</span>
                      <span className="text-right font-medium">{selectedStatus}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Location</span>
                      <span className="text-right font-medium">{location || 'Will appear after GPS capture'}</span>
                    </div>
                  </div>
                </div>

                {isLoading && (
                  <div className="rounded-2xl border p-4">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium">Preparing attendance</span>
                      <span className="text-muted-foreground">
                        {isFetchingLocation ? 'Getting location' : isScanning ? 'Scanning QR' : isTakingPhoto ? 'Camera ready' : 'Finishing'}
                      </span>
                    </div>
                    <Progress value={isFetchingLocation ? 25 : isTakingPhoto ? 50 : isScanning ? 70 : isWatermarking ? 90 : 0} className="h-2" />
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Operator tips</CardTitle>
              <CardDescription>Designed to keep the flow simple for field use.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded-xl border p-3">
                <p className="font-medium text-foreground">1. Start attendance once</p>
                <p className="mt-1">The page will try to detect the nearest center from the current location automatically.</p>
              </div>
              <div className="rounded-xl border p-3">
                <p className="font-medium text-foreground">2. Scan the employee QR</p>
                <p className="mt-1">Only use manual ID when the QR is damaged or unavailable.</p>
              </div>
              <div className="rounded-xl border p-3">
                <p className="font-medium text-foreground">3. Capture photo and submit</p>
                <p className="mt-1">After each successful entry, the duty center stays ready for the next employee.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Attendance Logs</CardTitle>
              <CardDescription>Latest records created on this device.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentAttendance.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent attendance records on this device yet.</p>
              ) : (
                <div className="space-y-3">
                  {recentAttendance.slice(0, 5).map((record) => (
                    <div key={record.id} className="rounded-2xl border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{record.employeeName}</p>
                          <p className="text-xs text-muted-foreground">{record.employeeId}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{record.district} • {record.siteName}</p>
                          <p className="text-xs text-muted-foreground">{record.time}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Badge variant={record.status === 'In' ? 'default' : 'destructive'}>{record.status}</Badge>
                          <Badge variant={record.syncStatus === 'synced' ? 'outline' : record.syncStatus === 'queued' ? 'secondary' : 'destructive'}>
                            {record.syncStatus}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
