
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QrCode, Camera, MapPin, CheckCircle, XCircle, Info, Loader2, ListChecks, RefreshCcw, WifiOff } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Image from 'next/image';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import html2canvas from 'html2canvas';
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
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([]);
  const [isLoadingSites, setIsLoadingSites] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<'In' | 'Out'>('In');
  const [scannedEmployee, setScannedEmployee] = useState<ScannedEmployee | null>(null);
  const [clientFilter, setClientFilter] = useState<'auto' | 'all' | string>('auto');
  const [hasScanned, setHasScanned] = useState(false);
  
  const [isScanning, setIsScanning] = useState(false);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [isWatermarking, setIsWatermarking] = useState(false);
  const [manualIdOpen, setManualIdOpen] = useState(false);
  const [manualEmployeeId, setManualEmployeeId] = useState('');

  const [recentAttendance, setRecentAttendance] = useState<DeviceAttendanceHistoryItem[]>([]);
  const [queuedAttendance, setQueuedAttendance] = useState<QueuedAttendanceSubmission[]>([]);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<BrowserMultiFormatReader | null>(null);
  const photoContainerRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();

  // Simplified: we only require a captured photo and a resolved employee
  const allVerificationsComplete = !!capturedPhoto && !!scanResult;
  const isSelectionComplete = !!selectedDistrict && !!selectedSiteId;

  const keralaDistricts = [
    "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam",
    "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram",
    "Kozhikode", "Wayanad", "Kannur", "Kasaragod", "Lakshadweep"
  ];

  const availableClients = React.useMemo(() => {
    const set = new Set<string>();
    siteOptions.forEach(s => {
      if (s.clientName) set.add(s.clientName);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [siteOptions]);

  const filteredSiteOptions = React.useMemo(() => {
    if (!siteOptions.length) return [];
    let targetClient: string | null = null;

    if (clientFilter === 'all') {
      targetClient = null;
    } else if (clientFilter === 'auto') {
      targetClient = scannedEmployee?.clientName ?? null;
    } else {
      targetClient = clientFilter;
    }

    if (!targetClient) return siteOptions;
    return siteOptions.filter(s => s.clientName === targetClient);
  }, [siteOptions, clientFilter, scannedEmployee?.clientName]);

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
      if (!selectedDistrict) { setSiteOptions([]); setSelectedSiteId(""); return; }
      setIsLoadingSites(true);
      try {
        const q = query(collection(db, 'sites'), where('district', '==', selectedDistrict));
        const snap = await getDocs(q);
        const options: SiteOption[] = snap.docs.map(d => {
          const data = d.data() as any;
          const geo = data.geolocation;
          // Parse from GeoPoint or fallback to stored string values
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
        }).sort((a, b) => {
          if (a.clientName === b.clientName) {
            return a.siteName.localeCompare(b.siteName);
          }
          return String(a.clientName || '').localeCompare(String(b.clientName || ''));
        });
        setSiteOptions(options);
        if (options.length === 0) {
          toast({ title: 'No sites found', description: `No sites under ${selectedDistrict}.` });
        }
      } catch (e: any) {
        console.error('Failed loading sites', e);
        toast({ variant: 'destructive', title: 'Error loading sites', description: e.message || 'Try again.' });
      } finally {
        setIsLoadingSites(false);
      }
    };
    fetchSites();
  }, [selectedDistrict, toast]);

  const handleStartVerification = async () => {
    setIsFetchingLocation(true);
    setIsTakingPhoto(true);

    try {
      // Capture GPS once at the beginning of the flow
      await getDeviceLocation();
      // Start scanner which will also start the camera stream
      await handleScanAndCapture();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Verification Error", description: error.message });
      resetState();
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
        setLocationCoords({ lat: latitude, lon: longitude });
        // Using a reverse geocoding API would be ideal here. For now, just show coords.
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

  const handleMarkAttendance = (status: 'In' | 'Out') => {
    // kept for compatibility; no-op in new flow
  };

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
    const selectedSite = siteOptions.find(s => s.id === selectedSiteId);
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
      resetState();
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
      resetState();
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
        resetState();
        return;
      }

      const failedId = `${Date.now()}`;
      appendRecentAttendance(buildHistoryItem(failedId, payloadWithoutPhotoUrl, undefined, 'failed'));
      toast({ variant: 'destructive', title: 'Submit Failed', description: e?.message || 'Could not submit attendance.' });
    }
  };

  const resetState = () => {
      setScanResult(null);
      setCapturedPhoto(null);
      setWatermarkedPhoto(null);
      setLocation(null);
      setLocationCoords(null);
      setScannedEmployee(null);
      setHasScanned(false);
      setIsScanning(false);
      setIsTakingPhoto(false);
      setIsFetchingLocation(false);
      setIsWatermarking(false);
  }

  const isLoading = isFetchingLocation || isTakingPhoto || isScanning || isWatermarking;
  // Enable submit when all green badges are met and watermarked photo is ready
  const canSubmit = isSelectionComplete && !!scannedEmployee && !!capturedPhoto && !isTakingPhoto && !isScanning;
  const verificationStarted = isFetchingLocation || isTakingPhoto;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <h1 className="text-3xl font-bold tracking-tight">Attendance Tracking</h1>

      <Card>
        <CardHeader>
          <CardTitle>Duty Selection</CardTitle>
          <CardDescription>
            Select your district, client (if different from your primary client), and site for today&apos;s duty.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="grid gap-2">
            <Label>District</Label>
            <Select
              value={selectedDistrict}
              onValueChange={(v) => {
                setSelectedDistrict(v);
                setSelectedSiteId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a district" />
              </SelectTrigger>
              <SelectContent>
                {keralaDistricts.map(d => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Client (for today)</Label>
            <Select
              value={clientFilter}
              onValueChange={(v) => {
                setClientFilter(v as any);
                setSelectedSiteId("");
              }}
              disabled={!selectedDistrict || availableClients.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select client filter" />
              </SelectTrigger>
              <SelectContent>
                {scannedEmployee?.clientName && (
                  <SelectItem value="auto">
                    Same as employee ({scannedEmployee.clientName})
                  </SelectItem>
                )}
                <SelectItem value="all">All clients in district</SelectItem>
                {availableClients.map(client => (
                  <SelectItem key={client} value={client}>
                    {client}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Site</Label>
            <Select
              value={selectedSiteId}
              onValueChange={(v) => setSelectedSiteId(v)}
              disabled={!selectedDistrict || isLoadingSites || filteredSiteOptions.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    isLoadingSites
                      ? 'Loading sites...'
                      : (!selectedDistrict
                          ? 'Select district first'
                          : (filteredSiteOptions.length === 0
                              ? 'No sites for selected client'
                              : 'Select a site'))
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {filteredSiteOptions.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.clientName} — {s.siteName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>How to Mark Attendance</AlertTitle>
        <AlertDescription>
          {!verificationStarted && 'Click "Start Verification" to access your camera and location.'}
          {verificationStarted && !scanResult && 'Point your QR code at the camera and click "Scan QR & Capture".'}
          {scanResult && 'Once all data is captured, click "Mark IN" or "Mark OUT".'}
        </AlertDescription>
      </Alert>

      <Alert>
        {queuedAttendance.length > 0 ? <WifiOff className="h-4 w-4" /> : <RefreshCcw className="h-4 w-4" />}
        <AlertTitle>Attendance Sync</AlertTitle>
        <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {queuedAttendance.length > 0
              ? `${queuedAttendance.length} attendance entr${queuedAttendance.length === 1 ? 'y is' : 'ies are'} queued for sync.`
              : 'All locally saved attendance entries are synced.'}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={flushQueuedAttendance} disabled={isSyncingQueue || queuedAttendance.length === 0}>
            {isSyncingQueue ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            Sync Now
          </Button>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Attendance Terminal</CardTitle>
          <CardDescription>Verify your identity to mark attendance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!verificationStarted ? (
            <Button onClick={handleStartVerification} className="w-full sm:w-auto">
              <Camera className="mr-2 h-4 w-4" /> Start Verification
            </Button>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Side: Camera and Capture */}
              <div className="space-y-4">
                 <div ref={photoContainerRef} className="relative w-full bg-muted rounded-lg overflow-hidden flex items-center justify-center"
                      style={{ aspectRatio: typeof window !== 'undefined' && window.innerWidth < 640 ? '3 / 4' : '4 / 3' }}>
                    {isTakingPhoto && <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />}
                    {capturedPhoto && <Image src={capturedPhoto} alt="Captured photo" layout="fill" objectFit="cover" data-ai-hint="employee attendance photo"/>}
                    {(capturedPhoto && location) && (
                       <div className="absolute bottom-0 left-0 w-full bg-black/50 text-white p-2 text-xs">
                          <p>{new Date().toLocaleString()}</p>
                          <p>{location}</p>
                          {isSelectionComplete && (
                            <p>{selectedDistrict} — {siteOptions.find(s => s.id === selectedSiteId)?.siteName}</p>
                          )}
                       </div>
                    )}
                    {isWatermarking && (
                        <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white">
                            <Loader2 className="h-8 w-8 animate-spin" />
                            <p className="mt-2">Verifying...</p>
                        </div>
                    )}
                 </div>
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                   <Button onClick={capturePhoto} disabled={!hasScanned || isWatermarking} className="w-full">
                     <Camera className="mr-2 h-4 w-4" /> Capture Photo
                   </Button>
                   <Button onClick={() => { setCapturedPhoto(null); setWatermarkedPhoto(null); setIsTakingPhoto(true); }} variant="secondary" className="w-full">
                     <Camera className="mr-2 h-4 w-4" /> Retake Photo
                   </Button>
                   <Button onClick={handleRescan} variant="secondary" disabled={isLoading} className="w-full">
                     <QrCode className="mr-2 h-4 w-4" /> Rescan QR
                 </Button>
                 </div>
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                   <Input placeholder="Enter Employee ID (fallback)" value={manualEmployeeId} onChange={(e)=> setManualEmployeeId(e.target.value)} />
                   <Button variant="outline" onClick={async ()=>{
                     if (!manualEmployeeId.trim()) { toast({ variant: 'destructive', title: 'Enter Employee ID' }); return; }
                     const emp = await fetchEmployeeByEmployeeId(manualEmployeeId.trim());
                     if (emp) {
                       setScannedEmployee(emp);
                       setScanResult(`Manual:${manualEmployeeId.trim()}`);
                       setHasScanned(true);
                       toast({ title: 'Employee Selected', description: emp.fullName });
                     } else {
                       toast({ variant: 'destructive', title: 'Not Found', description: 'No employee with that ID' });
                     }
                   }}>Use Manual ID</Button>
                   <div />
                 </div>
              </div>
              
              {/* Right Side: Status */}
              <div className="space-y-4">
                 <h3 className="font-semibold text-lg">Verification Status</h3>
                 <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 border rounded-md">
                        <Camera className={`h-6 w-6 ${capturedPhoto ? 'text-green-500' : 'text-muted-foreground'}`} />
                        <div>
                            <p className="font-medium">Photo</p>
                            <p className={`text-sm ${capturedPhoto ? 'text-green-500' : 'text-muted-foreground'}`}>{capturedPhoto ? 'Captured' : 'Pending'}</p>
                        </div>
                    </div>
                     <div className="flex items-center gap-3 p-3 border rounded-md">
                        <MapPin className={`h-6 w-6 ${location ? 'text-green-500' : 'text-muted-foreground'}`} />
                        <div>
                            <p className="font-medium">Location</p>
                            <p className={`text-sm ${location ? 'text-green-500' : 'text-muted-foreground'}`}>{location || 'Will be checked on submit'}</p>
                        </div>
                    </div>
                     <div className="flex items-center gap-3 p-3 border rounded-md">
                        <QrCode className={`h-6 w-6 ${scannedEmployee ? 'text-green-500' : 'text-muted-foreground'}`} />
                        <div>
                            <p className="font-medium">QR Scan</p>
                            <p className={`text-sm ${scannedEmployee ? 'text-green-500' : 'text-muted-foreground'}`}>{scannedEmployee ? `${scannedEmployee.fullName}` : (scanResult || 'Pending')}</p>
                        </div>
                    </div>
                     <div className="flex items-center gap-3 p-3 border rounded-md">
                        <ListChecks className={`h-6 w-6 ${isSelectionComplete ? 'text-green-500' : 'text-muted-foreground'}`} />
                        <div>
                            <p className="font-medium">Duty Selection</p>
                            <p className={`text-sm ${isSelectionComplete ? 'text-green-500' : 'text-muted-foreground'}`}>{isSelectionComplete ? `${selectedDistrict} — ${siteOptions.find(s => s.id === selectedSiteId)?.siteName}` : 'Pending'}</p>
                        </div>
                     </div>
                     <div className="p-3 border rounded-md">
                        <p className="font-medium mb-2">Status</p>
                        <RadioGroup value={selectedStatus} onValueChange={(v)=> setSelectedStatus((v as 'In'|'Out'))} className="flex items-center gap-4">
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="In" id="status-in" />
                            <Label htmlFor="status-in">Mark IN</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Out" id="status-out" />
                            <Label htmlFor="status-out">Mark OUT</Label>
                          </div>
                        </RadioGroup>
                    </div>
                 </div>
                 {watermarkedPhoto && (
                    <div className="mt-4">
                        <p className="font-semibold mb-2">Verified Photo:</p>
                        <Image src={watermarkedPhoto} alt="Watermarked employee photo" width={200} height={150} className="rounded-md border" data-ai-hint="verified employee photo"/>
                    </div>
                 )}
                  {(hasScanned || watermarkedPhoto) && (
                    <div className="mt-4 p-3 border rounded-md space-y-1">
                      <p className="font-semibold">Review</p>
                      <p className="text-sm">Employee: {scannedEmployee ? scannedEmployee.fullName : '—'}</p>
                      <p className="text-sm">Status: {selectedStatus}</p>
                      <p className="text-sm">District/Site: {isSelectionComplete ? `${selectedDistrict} — ${siteOptions.find(s => s.id === selectedSiteId)?.siteName}` : '—'}</p>
                      <p className="text-sm">Location: {location || '—'}</p>
                      <p className="text-xs text-muted-foreground">Ensure QR was read, duty selected, photo captured, then submit.</p>
                    </div>
                 )}
              </div>
            </div>
          )}
          
          {isLoading && (
            <Progress value={isFetchingLocation ? 20 : isTakingPhoto ? 40 : isScanning ? 60 : isWatermarking ? 80 : 0} className="w-full mt-2" />
          )}

        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row justify-end gap-2">
          <Button onClick={handleSubmitAttendance} disabled={!canSubmit} className="w-full sm:w-auto">
            <CheckCircle className="mr-2 h-4 w-4" /> Submit Attendance
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Attendance Logs (This Device)</CardTitle>
          <CardDescription>Last 5 attendance records marked on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentAttendance.length === 0 ? (
            <p className="text-muted-foreground">No recent attendance records.</p>
          ) : (
            <ul className="space-y-3">
              {recentAttendance.map(record => (
                <li key={record.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 border rounded-md shadow-sm gap-4">
                  <div className="flex items-center gap-3">
                    {record.photoUrl && <Image src={record.photoUrl} alt={record.employeeName} width={80} height={60} className="rounded-md" data-ai-hint="employee avatar" />}
                    <div>
                      <p className="font-medium">{record.employeeName}</p>
                      <p className="text-sm text-muted-foreground">ID: {record.employeeId} | Time: {record.time}</p>
                      <p className="text-xs text-muted-foreground">Location: {record.location}</p>
                      <p className="text-xs text-muted-foreground">Duty: {record.district} — {record.siteName}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={record.status === 'In' ? 'default' : 'destructive'} className="shrink-0">
                      {record.status}
                    </Badge>
                    <Badge variant={record.syncStatus === 'synced' ? 'default' : record.syncStatus === 'queued' ? 'secondary' : 'destructive'}>
                      {record.syncStatus}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
