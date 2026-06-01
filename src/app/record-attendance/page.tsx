"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  MapPin,
  ScanLine,
  Camera,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { startHybridQrScanner } from "@/lib/qr/scanner-engine";
import { parseQrContent } from "@/lib/qr/qr-token";


interface SiteOption {
  id: string;
  siteName: string;
  clientName: string;
  district: string;
  lat?: number;
  lng?: number;
  geofenceRadiusMeters: number;
  strictGeofence: boolean;
  shiftMode: string;
  shiftTemplates: unknown[];
  dutyPoints: DutyPoint[];
}

interface DutyPoint {
  id: string;
  name: string;
  coverageMode: string;
  dutyHours: string;
  shiftTemplates: ShiftTemplate[];
  geofenceRadiusMeters?: number;
}

interface ShiftTemplate {
  code: string;
  label: string;
  startTime: string;
  endTime: string;
}

interface EmployeeInfo {
  id: string;
  employeeId: string;
  fullName: string;
  phoneNumber: string;
  clientName: string;
  district: string;
  status: string;
}

interface AttendanceHint {
  lastStatus: string | null;
  lastAttendanceDate: string | null;
  lastSiteId: string | null;
  lastDutyPointId: string | null;
  lastShiftCode: string | null;
  openSessionId: string | null;
  recommendedStatus: string;
}

function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const R = 6371e3;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function RecordAttendancePage() {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerSessionRef = useRef<{ stop: () => void } | null>(null);

  const [step, setStep] = useState<"scan" | "verify" | "form" | "confirm">("scan");
  const [scanning, setScanning] = useState(false);
  const [qrText, setQrText] = useState("");
  const [employee, setEmployee] = useState<EmployeeInfo | null>(null);
  const [hint, setHint] = useState<AttendanceHint | null>(null);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [selectedSite, setSelectedSite] = useState<SiteOption | null>(null);
  const [selectedDutyPoint, setSelectedDutyPoint] = useState<DutyPoint | null>(null);
  const [selectedShift, setSelectedShift] = useState<ShiftTemplate | null>(null);
  const [status, setStatus] = useState<"In" | "Out">("In");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ id: string; autoClosed?: boolean; message?: string } | null>(null);

  // ── QR Scanner ───────────────────────────────────────────────────────────
  const startScanning = useCallback(async () => {
    if (!videoRef.current) return;
    setScanning(true);
    setGpsError(null);
    try {
      const session = await startHybridQrScanner({
        video: videoRef.current,
        onResult: async (result) => {
          if (scannerSessionRef.current) {
            scannerSessionRef.current.stop();
            scannerSessionRef.current = null;
          }
          setScanning(false);
          setQrText(result.text);
          await handleQrScanned(result.text);
        },
        onError: (err) => {
          console.error("QR scan error:", err);
          toast({ variant: "destructive", title: "Scan failed", description: String(err) });
          setScanning(false);
        },
      });
      scannerSessionRef.current = session;
    } catch (err: any) {
      toast({ variant: "destructive", title: "Camera error", description: err.message });
      setScanning(false);
    }
  }, [toast]);

  const stopScanning = useCallback(() => {
    if (scannerSessionRef.current) {
      scannerSessionRef.current.stop();
      scannerSessionRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => {
    return () => stopScanning();
  }, [stopScanning]);

  // ── Handle QR Scanned ────────────────────────────────────────────────────
  const handleQrScanned = async (text: string) => {
    setStep("verify");
    try {
      const res = await fetch("/api/public/attendance/verify-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrText: text }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Verification failed");
      }
      setEmployee(json.employee);
      setHint(json.attendanceHint);
      setStatus(json.attendanceHint?.recommendedStatus === "Out" ? "Out" : "In");
      fetchSites();
      setStep("form");
    } catch (err: any) {
      toast({ variant: "destructive", title: "QR Verification Failed", description: err.message });
      setStep("scan");
    }
  };

  // ── Fetch Sites ──────────────────────────────────────────────────────────
  const fetchSites = async () => {
    setSitesLoading(true);
    try {
      const res = await fetch("/api/public/attendance");
      const json = await res.json();
      if (json.options) {
        setSites(json.options);
      }
    } catch {
      toast({ variant: "destructive", title: "Could not load sites" });
    } finally {
      setSitesLoading(false);
    }
  };

  // ── GPS ──────────────────────────────────────────────────────────────────
  const captureGps = useCallback(() => {
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  useEffect(() => {
    if (step === "form" && !gps) {
      captureGps();
    }
  }, [step, gps, captureGps]);

  // ── Auto-select site by distance ─────────────────────────────────────────
  useEffect(() => {
    if (!gps || sites.length === 0 || selectedSite) return;

    let best: SiteOption | null = null;
    let bestDist = Infinity;

    for (const site of sites) {
      if (!site.lat || !site.lng) continue;
      const d = haversineDistanceMeters(gps.lat, gps.lon, site.lat, site.lng);
      if (d < bestDist) {
        bestDist = d;
        best = site;
      }
    }

    if (best) {
      setSelectedSite(best);
      // Auto-select duty point
      if (best.dutyPoints.length === 1) {
        setSelectedDutyPoint(best.dutyPoints[0]);
      }
    }
  }, [gps, sites, selectedSite]);

  // ── Resolve shift ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDutyPoint && !selectedSite) return;
    const templates = selectedDutyPoint?.shiftTemplates ?? selectedSite?.shiftTemplates ?? [];
    if (templates.length === 0) return;

    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes();

    for (const t of templates as ShiftTemplate[]) {
      const [sh, sm] = t.startTime.split(":").map(Number);
      const [eh, em] = t.endTime.split(":").map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      const crossesMidnight = start >= end;
      const inShift = crossesMidnight
        ? totalMinutes >= start || totalMinutes < end
        : totalMinutes >= start && totalMinutes < end;
      if (inShift) {
        setSelectedShift(t);
        return;
      }
    }
    setSelectedShift(templates[0] as ShiftTemplate);
  }, [selectedDutyPoint, selectedSite]);

  // ── Photo Capture ────────────────────────────────────────────────────────
  const capturePhoto = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
    });
    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Watermark
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.roundRect(16, canvas.height - 80, 420, 60, 8);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(`${employee?.fullName} · ${status} · ${selectedSite?.siteName}`, 28, canvas.height - 48);
    ctx.font = "14px sans-serif";
    ctx.fillText(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), 28, canvas.height - 28);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setPhotoDataUrl(dataUrl);

    stream.getTracks().forEach((t) => t.stop());
  };

  // ── Geofence check ───────────────────────────────────────────────────────
  const distance = selectedSite && gps && selectedSite.lat && selectedSite.lng
    ? haversineDistanceMeters(gps.lat, gps.lon, selectedSite.lat, selectedSite.lng)
    : null;
  const isOutOfZone = distance !== null && distance > (selectedDutyPoint?.geofenceRadiusMeters ?? selectedSite?.geofenceRadiusMeters ?? 150);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!employee || !selectedSite || !gps) return;
    if (!photoDataUrl) {
      toast({ variant: "destructive", title: "Photo required", description: "Please capture a photo before submitting." });
      return;
    }
    if (isOutOfZone && !overrideReason) {
      setShowOverride(true);
      toast({ variant: "destructive", title: "Out of zone", description: `You are ${Math.round(distance!)}m away. Provide a reason or move closer.` });
      return;
    }

    setSubmitting(true);
    try {
      // Upload photo
      const uploadRes = await fetch("/api/public/attendance/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: `employees/${employee.id}/attendance/${Date.now()}_attendance.jpg`,
          photoDataUrl,
        }),
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadJson.error || "Photo upload failed");

      const clientRequestId = crypto.randomUUID();
      const parsedQr = parseQrContent(qrText);

      const payload = {
        employeeId: employee.employeeId,
        employeeName: employee.fullName,
        employeeDocId: employee.id,
        employeePhoneNumber: employee.phoneNumber,
        employeeClientName: employee.clientName,
        status,
        district: selectedSite.district,
        siteId: selectedSite.id,
        siteName: selectedSite.siteName,
        clientName: selectedSite.clientName,
        dutyPointId: selectedDutyPoint?.id ?? null,
        dutyPointName: selectedDutyPoint?.name ?? null,
        shiftCode: selectedShift?.code ?? null,
        shiftLabel: selectedShift?.label ?? null,
        shiftStartTime: selectedShift?.startTime ?? null,
        shiftEndTime: selectedShift?.endTime ?? null,
        siteCoords: { lat: selectedSite.lat ?? 0, lng: selectedSite.lng ?? 0 },
        locationText: `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}`,
        locationCoords: { lat: gps.lat, lon: gps.lon, accuracyMeters: gps.accuracy },
        distanceMeters: distance ?? 0,
        gpsAccuracyMeters: gps.accuracy,
        geofenceRadiusAtTime: selectedDutyPoint?.geofenceRadiusMeters ?? selectedSite.geofenceRadiusMeters ?? 150,
        sourceCollection: "sites" as const,
        photoUrl: uploadJson.url,
        photoCapturedAt: new Date().toISOString(),
        deviceInfo: { userAgent: navigator.userAgent },
        clientRequestId,
        overrideReason: overrideReason || undefined,
        qrToken: parsedQr.token || undefined,
      };

      const res = await fetch("/api/attendance/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Submission failed");

      setResult(json);
      setStep("confirm");
      toast({ title: "Attendance Recorded", description: json.autoClosed ? json.message : `Attendance ${status} marked successfully.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Submission Failed", description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render Steps ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <div className="bg-brand-blue text-white px-4 py-5">
        <div className="flex items-center gap-3">
          <ScanLine size={24} />
          <div>
            <h1 className="text-lg font-bold">Record Attendance</h1>
            <p className="text-xs text-white/80">Scan employee QR to mark attendance</p>
          </div>
        </div>
      </div>

      {step === "scan" && (
        <div className="p-4 space-y-4">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!scanning && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <Button onClick={startScanning} className="gap-2">
                  <ScanLine size={18} />
                  Start QR Scanner
                </Button>
              </div>
            )}
            {scanning && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-[15%] border-2 border-white/50 rounded-lg">
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-brand-gold" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-brand-gold" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-brand-gold" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-brand-gold" />
                </div>
              </div>
            )}
          </div>

          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Point camera at the employee&apos;s QR code
            </p>
            <p className="text-xs text-muted-foreground">
              Or ask the employee to open their profile QR
            </p>
          </div>
        </div>
      )}

      {step === "verify" && (
        <div className="p-8 text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-brand-blue" />
          <p className="text-sm text-muted-foreground">Verifying employee...</p>
        </div>
      )}

      {step === "form" && employee && (
        <div className="p-4 space-y-4 pb-24">
          {/* Employee Card */}
          <Card className="border-l-4 border-l-brand-gold">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <ShieldCheck size={22} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{employee.fullName}</p>
                  <p className="text-xs text-muted-foreground">{employee.employeeId}</p>
                  <p className="text-xs text-muted-foreground">{employee.clientName} · {employee.district}</p>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {hint?.lastStatus === "In" ? "Clocked IN" : "Clocked OUT"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Status Toggle */}
          <div className="flex gap-2">
            {(["In", "Out"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-all ${
                  status === s
                    ? s === "In"
                      ? "bg-green-500 text-white shadow-sm"
                      : "bg-orange-500 text-white shadow-sm"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {s === "In" ? "Clock IN" : "Clock OUT"}
              </button>
            ))}
          </div>

          {/* Site Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Site</label>
            {sitesLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : (
              <select
                value={selectedSite?.id ?? ""}
                onChange={(e) => {
                  const site = sites.find((s) => s.id === e.target.value) ?? null;
                  setSelectedSite(site);
                  setSelectedDutyPoint(site?.dutyPoints.length === 1 ? site.dutyPoints[0] : null);
                }}
                className="w-full h-12 px-3 rounded-xl border border-input bg-background text-sm"
              >
                <option value="">Select site...</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.siteName} ({site.district})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Duty Point */}
          {selectedSite && selectedSite.dutyPoints.length > 1 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Duty Point</label>
              <select
                value={selectedDutyPoint?.id ?? ""}
                onChange={(e) => {
                  const dp = selectedSite.dutyPoints.find((d) => d.id === e.target.value) ?? null;
                  setSelectedDutyPoint(dp);
                }}
                className="w-full h-12 px-3 rounded-xl border border-input bg-background text-sm"
              >
                <option value="">Select duty point...</option>
                {selectedSite.dutyPoints.map((dp) => (
                  <option key={dp.id} value={dp.id}>{dp.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Shift */}
          {selectedShift && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock size={14} />
              <span>Shift: {selectedShift.label} ({selectedShift.startTime} - {selectedShift.endTime})</span>
            </div>
          )}

          {/* GPS */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-1">
                <MapPin size={14} /> Location
              </label>
              <button onClick={captureGps} className="text-xs text-brand-blue font-medium">
                Refresh
              </button>
            </div>
            {gpsError ? (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">
                {gpsError}
              </div>
            ) : gps ? (
              <div className={`p-3 rounded-xl border text-sm ${
                isOutOfZone
                  ? "bg-amber-50 border-amber-200 text-amber-800"
                  : "bg-green-50 border-green-200 text-green-800"
              }`}>
                <div className="flex items-center gap-2">
                  {isOutOfZone ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                  <span>
                    {isOutOfZone
                      ? `Out of zone — ${Math.round(distance!)}m from site`
                      : `Within zone — ${Math.round(distance!)}m from site`}
                  </span>
                </div>
                {gps.accuracy > 50 && (
                  <p className="text-xs mt-1 opacity-75">GPS accuracy: ±{Math.round(gps.accuracy)}m</p>
                )}
              </div>
            ) : (
              <Skeleton className="h-12 w-full" />
            )}
          </div>

          {/* Override Reason */}
          {isOutOfZone && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-amber-700">Override Reason (required)</label>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Why are you outside the geofence? e.g., 'Site gate is 200m from checkpoint'"
                className="w-full p-3 rounded-xl border border-input bg-background text-sm min-h-[80px]"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground">This will be flagged for supervisor review.</p>
            </div>
          )}

          {/* Photo */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1">
              <Camera size={14} /> Photo Evidence
            </label>
            {photoDataUrl ? (
              <div className="relative rounded-xl overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoDataUrl} alt="Attendance" className="w-full h-48 object-cover" />
                <button
                  onClick={() => setPhotoDataUrl(null)}
                  className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-md"
                >
                  Retake
                </button>
              </div>
            ) : (
              <Button variant="outline" onClick={capturePhoto} className="w-full h-24 gap-2">
                <Camera size={20} />
                <span>Capture Photo</span>
              </Button>
            )}
          </div>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={submitting || !gps || !photoDataUrl || (isOutOfZone && !overrideReason)}
            className="w-full h-14 text-base font-semibold bg-primary"
          >
            {submitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                {status === "In" ? "Mark Attendance IN" : "Mark Attendance OUT"}
                <ChevronRight size={18} className="ml-1" />
              </>
            )}
          </Button>
        </div>
      )}

      {step === "confirm" && result && (
        <div className="p-8 text-center space-y-6">
          <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle2 size={32} className="text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Attendance Recorded</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {result.autoClosed ? result.message : `Successfully marked ${status}`}
            </p>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Log ID: <span className="font-mono">{result.id}</span></p>
            <p>Employee: {employee?.fullName}</p>
            <p>Site: {selectedSite?.siteName}</p>
          </div>
          <Button onClick={() => {
            setStep("scan");
            setEmployee(null);
            setSelectedSite(null);
            setSelectedDutyPoint(null);
            setPhotoDataUrl(null);
            setOverrideReason("");
            setResult(null);
            setQrText("");
          }} className="w-full">
            Record Another Attendance
          </Button>
        </div>
      )}
    </div>
  );
}
