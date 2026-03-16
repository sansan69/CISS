
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QrCode, Camera, MapPin, CheckCircle, Loader2, ScanLine, Sparkles, RotateCcw, AlertTriangle, ShieldAlert, Shirt, BadgeCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Image from 'next/image';
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
import { getNextShift, resolveSiteShift } from '@/lib/shift-utils';
import type {
  AttendancePhotoCompliance,
  AttendanceSubmission,
  DeviceAttendanceHistoryItem,
  QueuedAttendanceSubmission,
} from '@/types/attendance';
import type { ShiftTemplate } from '@/types/location';

type SiteOption = {
  id: string;
  siteName: string;
  clientName: string;
  district: string;
  geofenceRadiusMeters?: number;
  lat?: number;
  lng?: number;
  shiftMode?: 'none' | 'fixed';
  shiftPattern?: '2x12' | '3x8' | null;
  shiftTemplates?: ShiftTemplate[];
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
const INDIA_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

export default function AttendancePage() {
  const [workflowStep, setWorkflowStep] = useState<'idle' | 'scanning' | 'review' | 'photo'>('idle');
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [watermarkedPhoto, setWatermarkedPhoto] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lon: number; accuracyMeters?: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [reportingStartedAt, setReportingStartedAt] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string>("");
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [allSites, setAllSites] = useState<SiteOption[]>([]);
  const [isLoadingCenters, setIsLoadingCenters] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<'In' | 'Out'>('In');
  const [scannedEmployee, setScannedEmployee] = useState<ScannedEmployee | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [hasManualCenterOverride, setHasManualCenterOverride] = useState(false);
  const [autoDetectedSite, setAutoDetectedSite] = useState<SuggestedSite | null>(null);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  
  const [isScanning, setIsScanning] = useState(false);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [isWatermarking, setIsWatermarking] = useState(false);
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false);
  const [manualEmployeeId, setManualEmployeeId] = useState('');
  const [photoCapturedAt, setPhotoCapturedAt] = useState<string | null>(null);
  const [photoCompliance, setPhotoCompliance] = useState<AttendancePhotoCompliance | null>(null);
  const [photoComplianceError, setPhotoComplianceError] = useState<string | null>(null);

  const [recentAttendance, setRecentAttendance] = useState<DeviceAttendanceHistoryItem[]>([]);
  const [queuedAttendance, setQueuedAttendance] = useState<QueuedAttendanceSubmission[]>([]);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<BrowserMultiFormatReader | null>(null);
  const photoContainerRef = useRef<HTMLDivElement>(null);
  const scanLockedRef = useRef(false);

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
  const resolvedShift = useMemo(
    () => resolveSiteShift(selectedSite?.shiftMode, selectedSite?.shiftTemplates, new Date()),
    [selectedSite],
  );
  const nextResolvedShift = useMemo(
    () => getNextShift(selectedSite?.shiftMode, selectedSite?.shiftTemplates, resolvedShift?.code),
    [selectedSite, resolvedShift],
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
            shiftMode: data.shiftMode,
            shiftPattern: data.shiftPattern,
            shiftTemplates: Array.isArray(data.shiftTemplates) ? data.shiftTemplates : [],
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
    setCurrentTime(new Date());
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // Cleanup camera stream and QR scanner when the component unmounts to prevent
  // media track leaks if the user navigates away while the camera is active.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      try {
        (scannerRef.current as any)?.reset?.();
      } catch {}
      if (video) {
        const stream = video.srcObject as MediaStream | null;
        stream?.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      }
    };
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

  const waitForVideoSurface = () => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });

  const buildAttendanceStampLines = useCallback((capturedAtIso?: string | null) => {
    const capturedAt = capturedAtIso || new Date().toISOString();
    const coordsText = locationCoords
      ? `Lat ${locationCoords.lat.toFixed(6)} • Long ${locationCoords.lon.toFixed(6)}`
      : 'Lat/Long unavailable';

    return [
      selectedSite?.siteName || 'Duty center pending',
      [selectedDistrict, selectedSite?.clientName].filter(Boolean).join(' • ') || 'Client pending',
      location || 'Location unavailable',
      coordsText,
      `${INDIA_DATE_TIME_FORMATTER.format(new Date(capturedAt))} • ${selectedStatus} duty`,
      scannedEmployee
        ? `${scannedEmployee.fullName} • ${scannedEmployee.employeeCode || scannedEmployee.id}`
        : 'Guard details pending',
      'Captured by CISS Attendance',
    ];
  }, [location, locationCoords, scannedEmployee, selectedDistrict, selectedSite, selectedStatus]);

  const createWatermarkedAttendancePhoto = useCallback(async (
    originalDataUrl: string,
    capturedAtIso: string,
  ) => {
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.src = originalDataUrl;

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Photo could not be prepared.'));
    });

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Photo canvas is unavailable.');
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const overlayHeight = Math.max(220, Math.round(canvas.height * 0.28));
    const overlayY = canvas.height - overlayHeight - 24;
    const overlayX = 24;
    const overlayWidth = canvas.width - 48;
    const radius = 28;

    context.fillStyle = 'rgba(8, 14, 30, 0.72)';
    context.beginPath();
    context.moveTo(overlayX + radius, overlayY);
    context.lineTo(overlayX + overlayWidth - radius, overlayY);
    context.quadraticCurveTo(overlayX + overlayWidth, overlayY, overlayX + overlayWidth, overlayY + radius);
    context.lineTo(overlayX + overlayWidth, overlayY + overlayHeight - radius);
    context.quadraticCurveTo(overlayX + overlayWidth, overlayY + overlayHeight, overlayX + overlayWidth - radius, overlayY + overlayHeight);
    context.lineTo(overlayX + radius, overlayY + overlayHeight);
    context.quadraticCurveTo(overlayX, overlayY + overlayHeight, overlayX, overlayY + overlayHeight - radius);
    context.lineTo(overlayX, overlayY + radius);
    context.quadraticCurveTo(overlayX, overlayY, overlayX + radius, overlayY);
    context.closePath();
    context.fill();

    context.fillStyle = 'rgba(255,255,255,0.95)';
    context.font = `700 ${Math.max(26, Math.round(canvas.width * 0.032))}px Arial`;
    const lines = buildAttendanceStampLines(capturedAtIso);
    let cursorY = overlayY + 52;
    lines.forEach((line, index) => {
      context.fillStyle = index === 0 ? '#FFFFFF' : 'rgba(255,255,255,0.92)';
      context.font = `${index === 0 ? 700 : index === lines.length - 1 ? 600 : 500} ${index === 0 ? Math.max(26, Math.round(canvas.width * 0.032)) : Math.max(18, Math.round(canvas.width * 0.022))}px Arial`;
      context.fillText(line, overlayX + 32, cursorY, overlayWidth - 64);
      cursorY += index === 0 ? 42 : 32;
    });

    context.fillStyle = selectedStatus === 'In' ? '#22C55E' : '#F97316';
    context.fillRect(overlayX + overlayWidth - 220, overlayY + 24, 164, 40);
    context.fillStyle = '#07101F';
    context.font = `700 ${Math.max(18, Math.round(canvas.width * 0.02))}px Arial`;
    context.fillText(selectedStatus === 'In' ? 'CHECK IN' : 'CHECK OUT', overlayX + overlayWidth - 200, overlayY + 51);

    return canvas.toDataURL('image/jpeg', 0.92);
  }, [buildAttendanceStampLines, selectedStatus]);

  const createAnalysisPhoto = useCallback(async (originalDataUrl: string) => {
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.src = originalDataUrl;

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Photo could not be prepared for uniform review.'));
    });

    const maxEdge = 960;
    const width = image.width || 1280;
    const height = image.height || 720;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Photo canvas is unavailable.');
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  }, []);

  const analyzeCapturedPhoto = useCallback(async (
    originalPhotoDataUrl: string,
  ): Promise<AttendancePhotoCompliance> => {
    const analysisPhotoDataUrl = await createAnalysisPhoto(originalPhotoDataUrl);
    const response = await fetch('/api/attendance/analyze-photo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        photoDataUrl: analysisPhotoDataUrl,
        employeeName: scannedEmployee?.fullName,
        employeeId: scannedEmployee?.employeeCode || scannedEmployee?.id,
        siteName: selectedSite?.siteName,
        district: selectedDistrict,
        clientName: selectedSite?.clientName,
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || 'Uniform review could not be completed.');
    }

    return body.compliance as AttendancePhotoCompliance;
  }, [createAnalysisPhoto, scannedEmployee, selectedDistrict, selectedSite]);

  useEffect(() => {
    if (!locationCoords || allSites.length === 0 || hasManualCenterOverride) return;
    const suggestion = findSuggestedSite(locationCoords, scannedEmployee?.clientName ?? null);
    applySuggestedSite(suggestion, { silent: true });
  }, [allSites, applySuggestedSite, findSuggestedSite, hasManualCenterOverride, locationCoords, scannedEmployee?.clientName]);

  const handleStartVerification = async () => {
    setWorkflowStep('scanning');
    scanLockedRef.current = false;
    setHasScanned(false);
    setScanResult(null);
    setScannedEmployee(null);
    setCapturedPhoto(null);
    setWatermarkedPhoto(null);
    setPhotoCapturedAt(null);
    setPhotoCompliance(null);
    setPhotoComplianceError(null);
    setReportingStartedAt(null);
    setLocationError(null);

    try {
      if (!locationCoords) {
        setIsFetchingLocation(true);
        void getDeviceLocation().catch((error: any) => {
          setLocationError(error.message || 'Location could not be captured.');
        });
      }
      await waitForVideoSurface();
      await handleScanAndCapture();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Verification Error", description: error.message });
      resetVerificationState({ keepCenter: true, keepLocation: true });
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
        setLocationError(null);
        setIsFetchingLocation(false);
        resolve({ lat: latitude, lon: longitude, accuracyMeters: accuracy });
      },
      (error) => {
        console.error("Error getting location:", error);
        setLocation(null);
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

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 1280;
    canvas.height = videoRef.current.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const photoDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const capturedAtIso = new Date().toISOString();
    setCapturedPhoto(photoDataUrl);
    setPhotoCapturedAt(capturedAtIso);
    setPhotoCompliance(null);
    setPhotoComplianceError(null);
    stopScanner();
    setIsTakingPhoto(false);
    setWorkflowStep('review');
    setIsWatermarking(true);
    setIsAnalyzingPhoto(true);

    try {
      const [stampedPhoto, compliance] = await Promise.all([
        createWatermarkedAttendancePhoto(photoDataUrl, capturedAtIso),
        analyzeCapturedPhoto(photoDataUrl).catch((error: any) => {
          setPhotoComplianceError(error?.message || 'Uniform review could not be completed.');
          return {
            overallStatus: 'analysis_failed',
            adminFlag: true,
            warnings: ['Uniform review could not be completed automatically.'],
            summary: error?.message || 'Uniform review could not be completed automatically.',
            missingShoes: false,
            missingIdCard: false,
            uniformIssue: false,
            fullBodyVisible: false,
            onePersonVisible: true,
          } satisfies AttendancePhotoCompliance;
        }),
      ]);
      setWatermarkedPhoto(stampedPhoto);
      setPhotoCompliance(compliance);
      if (compliance.overallStatus === 'warning') {
        toast({
          variant: 'destructive',
          title: 'Uniform check found issues',
          description: compliance.warnings[0] || 'Review the photo and retake it if needed.',
        });
      } else if (compliance.overallStatus === 'clear') {
        toast({ title: 'Photo captured', description: 'Uniform details look clear.' });
      } else {
        toast({ title: 'Photo captured', description: 'Attendance can continue, but uniform review needs admin attention.' });
      }
    } catch (error: any) {
      setWatermarkedPhoto(photoDataUrl);
      setPhotoComplianceError(error?.message || 'Photo overlay could not be prepared.');
      toast({
        variant: 'destructive',
        title: 'Photo prepared with limited checks',
        description: error?.message || 'You can still retake the photo or continue.',
      });
    } finally {
      setIsWatermarking(false);
      setIsAnalyzingPhoto(false);
    }
  };

  const resolveScannedEmployee = useCallback((employee: ScannedEmployee, sourceText: string) => {
    setScannedEmployee(employee);
    setScanResult(sourceText);
    setHasScanned(true);
    setReportingStartedAt(new Date().toISOString());
    stopScanner();
    setWorkflowStep('review');
    toast({ title: 'Guard identified', description: employee.fullName, duration: 1600 });
  }, [toast]);

  const beginPhotoCapture = async () => {
    setWorkflowStep('photo');
    setCapturedPhoto(null);
    setWatermarkedPhoto(null);
    setPhotoCapturedAt(null);
    setPhotoCompliance(null);
    setPhotoComplianceError(null);
    setIsTakingPhoto(true);
    try {
      await waitForVideoSurface();
      await startCameraStream();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Camera Error', description: error.message });
      setWorkflowStep('review');
    }
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
            if (result && !scanLockedRef.current) {
              scanLockedRef.current = true;
              const text = result.getText();
              const parsedId = parseEmployeeIdFromText(text);
              if (parsedId) {
                fetchEmployeeByEmployeeId(parsedId).then((emp) => {
                  if (emp) {
                    resolveScannedEmployee(emp, text);
                  } else {
                    scanLockedRef.current = false;
                    toast({ variant: 'destructive', title: 'Employee Not Found', description: `ID ${parsedId} not found` });
                  }
                });
              } else {
                scanLockedRef.current = false;
                toast({ variant: 'destructive', title: 'Invalid QR', description: 'Could not parse Employee ID' });
              }
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
            if (result && !scanLockedRef.current) {
              scanLockedRef.current = true;
              const text = result.getText();
              const parsedId = parseEmployeeIdFromText(text);
              if (parsedId) {
                fetchEmployeeByEmployeeId(parsedId).then((emp) => {
                  if (emp) {
                    resolveScannedEmployee(emp, text);
                  } else {
                    scanLockedRef.current = false;
                    toast({ variant: 'destructive', title: 'Employee Not Found', description: `ID ${parsedId} not found` });
                  }
                });
              } else {
                scanLockedRef.current = false;
                toast({ variant: 'destructive', title: 'Invalid QR', description: 'Could not parse Employee ID' });
              }
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
    scanLockedRef.current = false;
    setHasScanned(false);
    setScanResult(null);
    setScannedEmployee(null);
    setCapturedPhoto(null);
    setWatermarkedPhoto(null);
    setPhotoCapturedAt(null);
    setPhotoCompliance(null);
    setPhotoComplianceError(null);
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
    time: payload.reportedAtClient
      ? new Date(payload.reportedAtClient).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
      : new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }),
    district: payload.district,
    siteName: payload.siteName,
    clientName: payload.clientName,
    shiftLabel: payload.shiftLabel,
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
    if (selectedSite.shiftMode === 'fixed' && !resolvedShift) {
      toast({
        variant: 'destructive',
        title: 'Shift not resolved',
        description: 'This site uses fixed shifts, but no active shift matches the current time. Please contact admin.',
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
      reportedAtClient: reportingStartedAt || new Date().toISOString(),
      employeePhoneNumber: scannedEmployee.phoneNumber,
      employeeClientName: scannedEmployee.clientName,
      status: selectedStatus,
      district: selectedDistrict,
      siteId: selectedSiteId,
      siteName: selectedSite.siteName,
      clientName: selectedSite.clientName,
      shiftCode: resolvedShift?.code,
      shiftLabel: resolvedShift?.label,
      shiftStartTime: resolvedShift?.startTime,
      shiftEndTime: resolvedShift?.endTime,
      nextShiftCode: nextResolvedShift?.code,
      nextShiftStartsAt: nextResolvedShift?.startTime,
      siteCoords: { lat: selectedSite.lat, lng: selectedSite.lng },
      locationText: location || '',
      locationCoords,
      distanceMeters: Math.round(distance),
      locationAccuracyMeters: locationCoords?.accuracyMeters ? Math.round(locationCoords.accuracyMeters) : null,
      photoCapturedAt: photoCapturedAt || new Date().toISOString(),
      photoCompliance: photoCompliance ?? undefined,
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
      scanLockedRef.current = false;
      setWorkflowStep('idle');
      setScanResult(null);
      setCapturedPhoto(null);
      setWatermarkedPhoto(null);
      setPhotoCapturedAt(null);
      setPhotoCompliance(null);
      setPhotoComplianceError(null);
      setReportingStartedAt(null);
      setLocationError(options?.keepLocation ? locationError : null);
      if (!options?.keepLocation) {
        setLocation(null);
        setLocationCoords(null);
        setAutoDetectedSite(null);
        setLocationError(null);
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

  const isLoading = isFetchingLocation || isTakingPhoto || isScanning || isWatermarking || isAnalyzingPhoto;
  const canSubmit = isSelectionComplete && !!scannedEmployee && !!capturedPhoto && !isTakingPhoto && !isScanning && !isWatermarking && !isAnalyzingPhoto;
  const verificationStarted = workflowStep !== 'idle';
  const selectedSiteDistance = selectedSite && locationCoords && typeof selectedSite.lat === 'number' && typeof selectedSite.lng === 'number'
    ? haversineDistanceMeters(locationCoords.lat, locationCoords.lon, selectedSite.lat, selectedSite.lng)
    : null;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col gap-4 p-4 pb-8">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Attendance</p>
            <h1 className="text-2xl font-bold tracking-tight">Record Duty Entry</h1>
          </div>
          <Badge variant={queuedAttendance.length > 0 ? 'secondary' : 'outline'}>
            {queuedAttendance.length > 0
              ? `${queuedAttendance.length} queued`
              : currentTime
                ? currentTime.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
                : 'Ready'}
          </Badge>
        </div>
        {selectedSite && workflowStep === 'idle' && (
          <p className="text-sm text-muted-foreground">
            Last used center: <span className="font-medium text-foreground">{selectedSite.siteName}</span>
          </p>
        )}
      </div>

      {workflowStep === 'idle' && (
        <Card className="rounded-3xl">
          <CardContent className="space-y-5 p-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <QrCode className="h-8 w-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">Start attendance</h2>
              <p className="text-sm text-muted-foreground">
                Tap once, scan the guard QR, confirm the center if needed, take one full-size photo, and submit.
              </p>
            </div>
            <Button size="lg" className="h-14 w-full text-base" onClick={handleStartVerification} disabled={isScanning || isFetchingLocation}>
              {isScanning || isFetchingLocation ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ScanLine className="mr-2 h-5 w-5" />}
              Start attendance
            </Button>
            <div className="rounded-2xl border bg-muted/30 p-4 text-left text-sm text-muted-foreground">
              <p className="font-medium text-foreground">For shared-center phones</p>
              <p className="mt-1">After one guard is submitted, the center and location stay ready so the next guard can finish faster.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {workflowStep === 'scanning' && (
        <Card className="rounded-3xl">
          <CardHeader className="space-y-2">
            <CardTitle>Scan the guard QR</CardTitle>
            <CardDescription>Hold the QR in front of the camera. Location is being captured in the background.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative aspect-[3/4] overflow-hidden rounded-3xl border bg-black">
              <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
              <div className="pointer-events-none absolute inset-x-6 top-1/2 h-44 -translate-y-1/2 rounded-3xl border-2 border-white/80" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-center text-sm text-white">
                Show the QR clearly inside the frame
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border p-4">
              <div className="flex items-start gap-3">
                <MapPin className={`mt-0.5 h-5 w-5 ${locationCoords ? 'text-green-600' : locationError ? 'text-destructive' : 'text-muted-foreground'}`} />
                <div className="min-w-0">
                  <p className="font-medium">Location status</p>
                  <p className="text-sm text-muted-foreground">
                    {locationCoords
                      ? 'Location captured in the background.'
                      : locationError
                        ? locationError
                        : 'Requesting location permission...'}
                  </p>
                </div>
              </div>
              {locationError && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={async () => {
                    setLocationError(null);
                    setIsFetchingLocation(true);
                    try {
                      await getDeviceLocation();
                    } catch (error: any) {
                      setLocationError(error.message || 'Location could not be captured.');
                    }
                  }}
                >
                  <MapPin className="mr-2 h-4 w-4" />
                  Retry location
                </Button>
              )}
            </div>

            <Accordion type="single" collapsible className="rounded-2xl border px-4">
              <AccordionItem value="manual-id" className="border-none">
                <AccordionTrigger>QR not working? Use manual employee ID</AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-2 pb-1">
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
                          resolveScannedEmployee(emp, `Manual:${manualEmployeeId.trim()}`);
                          if (!locationCoords && !isFetchingLocation) {
                            setIsFetchingLocation(true);
                            void getDeviceLocation().catch((error: any) => setLocationError(error.message || 'Location could not be captured.'));
                          }
                        } else {
                          toast({ variant: 'destructive', title: 'Not found', description: 'No employee with that ID.' });
                        }
                      }}
                    >
                      Continue with manual ID
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      )}

      {(workflowStep === 'review' || workflowStep === 'photo') && (
        <Card className="rounded-3xl">
          <CardHeader className="space-y-2">
            <CardTitle>{workflowStep === 'photo' ? 'Take full-size guard photo' : 'Confirm details'}</CardTitle>
            <CardDescription>
              {workflowStep === 'photo'
                ? 'Make sure the guard is clearly visible before capturing the photo.'
                : 'Review the guard, center, time, and status before the final photo and submit.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Guard identified</p>
              <p className="mt-2 text-lg font-semibold">{scannedEmployee?.fullName || 'Pending'}</p>
              <p className="text-sm text-muted-foreground">{scannedEmployee?.employeeCode || scanResult || 'No employee selected yet'}</p>
              {reportingStartedAt && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Reported at {new Date(reportingStartedAt).toLocaleDateString('en-IN')} • {new Date(reportingStartedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                </p>
              )}
            </div>

            {locationError && (
              <Alert variant="destructive">
                <MapPin className="h-4 w-4" />
                <AlertTitle>Location still needed</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>Turn on location services and allow location access before submitting this attendance.</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={async () => {
                      setLocationError(null);
                      setIsFetchingLocation(true);
                      try {
                        await getDeviceLocation();
                      } catch (error: any) {
                        setLocationError(error.message || 'Location could not be captured.');
                      }
                    }}
                  >
                    Retry location
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-2xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Center</p>
                  <p className="mt-2 text-base font-semibold">{selectedSite ? selectedSite.siteName : 'Waiting for location'}</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedSite ? `${selectedSite.clientName} • ${selectedDistrict}` : 'Auto-detect will choose the nearest center.'}
                  </p>
                  {resolvedShift && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Expected shift: <span className="font-medium text-foreground">{resolvedShift.label}</span> ({resolvedShift.startTime} - {resolvedShift.endTime})
                    </p>
                  )}
                  {!resolvedShift && selectedSite?.shiftMode === 'fixed' && (
                    <p className="mt-1 text-sm text-amber-700">No active shift matched the current time. Ask admin to check the site shift setup.</p>
                  )}
                  {resolvedShift && nextResolvedShift && (
                    <p className="mt-1 text-xs text-muted-foreground">Next shift expected after this window: {nextResolvedShift.label} from {nextResolvedShift.startTime}</p>
                  )}
                  {selectedSiteDistance != null && (
                    <p className="mt-1 text-xs text-muted-foreground">About {Math.round(selectedSiteDistance)} meters away</p>
                  )}
                </div>
                {autoDetectedSite && (
                  <Badge variant="outline">
                    {hasManualCenterOverride ? 'Changed manually' : 'Auto selected'}
                  </Badge>
                )}
              </div>

              <Accordion type="single" collapsible className="mt-4">
                <AccordionItem value="change-center">
                  <AccordionTrigger>Change center if this is wrong</AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-3 pt-1">
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
                        <Label>Center name</Label>
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
                            {districtSiteOptions.map((site) => (
                              <SelectItem key={site.id} value={site.id}>
                                {site.siteName} - {site.clientName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button type="button" variant="outline" onClick={refreshSuggestedCenter} disabled={!locationCoords}>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Use nearest center again
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>

            <div className="rounded-2xl border p-4">
              <Label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Attendance status</Label>
              <RadioGroup value={selectedStatus} onValueChange={(value) => setSelectedStatus(value as 'In' | 'Out')} className="mt-3 grid grid-cols-2 gap-2">
                <Label htmlFor="status-in" className={`flex cursor-pointer items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold ${selectedStatus === 'In' ? 'border-primary bg-primary text-primary-foreground' : ''}`}>
                  <RadioGroupItem value="In" id="status-in" className="sr-only" />
                  Mark IN
                </Label>
                <Label htmlFor="status-out" className={`flex cursor-pointer items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold ${selectedStatus === 'Out' ? 'border-primary bg-primary text-primary-foreground' : ''}`}>
                  <RadioGroupItem value="Out" id="status-out" className="sr-only" />
                  Mark OUT
                </Label>
              </RadioGroup>
            </div>

            {workflowStep === 'photo' ? (
              <div className="space-y-4">
                <div ref={photoContainerRef} className="relative aspect-[3/4] overflow-hidden rounded-3xl border bg-black">
                  <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
                  <div className="pointer-events-none absolute inset-x-5 top-5 rounded-2xl bg-black/55 px-4 py-3 text-sm text-white">
                    Keep one guard only in the frame. Make sure face, ID card, uniform, and shoes are visible.
                  </div>
                  <div className="pointer-events-none absolute inset-x-8 top-24 bottom-10 rounded-[2rem] border-2 border-dashed border-white/75" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button size="lg" className="h-12 w-full" onClick={() => void capturePhoto()}>
                    <Camera className="mr-2 h-4 w-4" />
                    Capture photo
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full"
                    onClick={() => {
                      stopScanner();
                      setWorkflowStep('review');
                    }}
                  >
                    Back
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {capturedPhoto ? (
                  <div className="space-y-3">
                    <div className="relative aspect-[3/4] overflow-hidden rounded-3xl border">
                      <Image src={watermarkedPhoto || capturedPhoto} alt="Guard photo" fill className="object-cover" />
                    </div>
                    {(isWatermarking || isAnalyzingPhoto) && (
                      <div className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Preparing attendance photo
                        </div>
                        <p className="mt-2">Adding attendance details to the image and checking shoes, ID card, and uniform visibility.</p>
                      </div>
                    )}
                    {photoCompliance && !isAnalyzingPhoto && (
                      <Alert variant={photoCompliance.overallStatus === 'warning' ? 'destructive' : 'default'}>
                        {photoCompliance.overallStatus === 'clear' ? (
                          <BadgeCheck className="h-4 w-4" />
                        ) : (
                          <ShieldAlert className="h-4 w-4" />
                        )}
                        <AlertTitle>
                          {photoCompliance.overallStatus === 'clear'
                            ? 'Uniform check looks good'
                            : photoCompliance.overallStatus === 'warning'
                              ? 'Please review the photo'
                              : 'Uniform check needs admin review'}
                        </AlertTitle>
                        <AlertDescription className="space-y-3">
                          <p>{photoCompliance.summary || 'Review the photo before submitting.'}</p>
                          {photoCompliance.warnings.length > 0 && (
                            <ul className="list-disc pl-5">
                              {photoCompliance.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                              ))}
                            </ul>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <Badge variant={photoCompliance.missingShoes ? 'destructive' : 'outline'}>
                              Shoes {photoCompliance.missingShoes ? 'not visible' : 'visible'}
                            </Badge>
                            <Badge variant={photoCompliance.missingIdCard ? 'destructive' : 'outline'}>
                              ID card {photoCompliance.missingIdCard ? 'not visible' : 'visible'}
                            </Badge>
                            <Badge variant={photoCompliance.uniformIssue ? 'destructive' : 'outline'}>
                              <Shirt className="mr-1 h-3 w-3" />
                              {photoCompliance.uniformIssue ? 'Uniform issue' : 'Uniform looks okay'}
                            </Badge>
                            <Badge variant={!photoCompliance.fullBodyVisible ? 'destructive' : 'outline'}>
                              Full body {photoCompliance.fullBodyVisible ? 'visible' : 'unclear'}
                            </Badge>
                          </div>
                          {photoCompliance.adminFlag && (
                            <p className="text-sm font-medium">
                              This record will be marked for admin review even if you submit now.
                            </p>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                    {photoComplianceError && !isAnalyzingPhoto && (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Uniform review could not finish fully</AlertTitle>
                        <AlertDescription>{photoComplianceError}</AlertDescription>
                      </Alert>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button type="button" variant="outline" className="h-12 w-full" onClick={beginPhotoCapture}>
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Retake photo
                      </Button>
                      <Button size="lg" className="h-12 w-full" onClick={handleSubmitAttendance} disabled={!canSubmit}>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Submit attendance
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="lg" className="h-14 w-full text-base" onClick={beginPhotoCapture} disabled={!scannedEmployee}>
                    <Camera className="mr-2 h-5 w-5" />
                    Take full-size guard photo
                  </Button>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" className="w-full" onClick={handleRescan}>
                    <QrCode className="mr-2 h-4 w-4" />
                    Scan another QR
                  </Button>
                  <Button type="button" variant="outline" className="w-full" onClick={() => resetVerificationState({ keepCenter: true, keepLocation: true })}>
                    Start over
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Accordion type="single" collapsible>
        <AccordionItem value="recent">
          <AccordionTrigger>Recent attendance on this phone</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3">
              {recentAttendance.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent records yet.</p>
              ) : (
                recentAttendance.slice(0, 4).map((record) => (
                  <div key={record.id} className="rounded-2xl border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{record.employeeName}</p>
                        <p className="text-xs text-muted-foreground">{record.siteName} • {record.shiftLabel ? `${record.shiftLabel} • ` : ''}{record.time}</p>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant={record.status === 'In' ? 'default' : 'destructive'}>{record.status}</Badge>
                        <Badge variant={record.syncStatus === 'synced' ? 'outline' : record.syncStatus === 'queued' ? 'secondary' : 'destructive'}>
                          {record.syncStatus}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
