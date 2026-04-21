"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, QrCode, Phone, ScanLine, RotateCcw, ArrowRight, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { parseEmployeeIdFromQrText } from "@/lib/qr/employee-qr";
import { normalizeScannerError } from "@/lib/qr/scanner-support";
import { startSafeHybridQrScanner } from "@/lib/qr/scanner-engine";
import type { QrScannerErrorCode, QrScannerSession } from "@/lib/qr/scanner-types";
import { signInWithCustomToken } from "firebase/auth";
import { requestNotificationPermission, registerFCMToken } from "@/lib/fcm";

type PhoneStep = "phone" | "pin";

export default function GuardLoginPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [phoneNumber, setPhoneNumber] = useState("");
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("phone");
  const pinInputRef = useRef<HTMLInputElement>(null);

  const [qrStep, setQrStep] = useState<"scan" | "pin">("scan");
  const [scannedEmployeeId, setScannedEmployeeId] = useState("");
  const [scannedEmployeeName, setScannedEmployeeName] = useState("");
  const [qrPin, setQrPin] = useState("");
  const [isQrLoading, setIsQrLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [activeTab, setActiveTab] = useState("phone");
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerSessionRef = useRef<QrScannerSession | null>(null);
  const scannerGenerationRef = useRef(0);
  const scannerErrorHandledRef = useRef(false);

  const handlePhoneContinue = async () => {
    if (phoneNumber.replace(/\D/g, "").length < 10) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/guard/auth/pin-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      const data = await res.json();

      if (!data.found) {
        toast({
          variant: "destructive",
          title: "Not Registered",
          description: "No employee found with this phone number. Please contact your administrator.",
        });
        return;
      }

      if (!data.hasPin) {
        router.push("/guard-login/setup");
        return;
      }

      setPhoneStep("pin");
      setTimeout(() => pinInputRef.current?.focus(), 100);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not verify phone number." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!phoneNumber || pin.length < 4) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/guard/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Login Failed", description: data.error ?? "Could not sign in." });
        return;
      }
      await signInWithCustomToken(auth, data.token as string);

      if (auth.currentUser) {
        try {
          const token = await requestNotificationPermission();
          if (token) {
            await registerFCMToken(auth.currentUser.uid, token);
          }
        } catch {
          // FCM registration optional — non-fatal
        }
      }

      toast({ title: `Welcome, ${data.employeeName ?? "Guard"}!` });
      router.push("/guard/dashboard");
    } catch {
      toast({ variant: "destructive", title: "Error", description: "An unexpected error occurred." });
    } finally {
      setIsLoading(false);
    }
  };

  const stopScanner = useCallback(() => {
    scannerGenerationRef.current += 1;
    scannerSessionRef.current?.stop();
    scannerSessionRef.current = null;
    scannerErrorHandledRef.current = false;
    setIsScanning(false);
  }, []);

  const handleScannerError = useCallback((errorCode: QrScannerErrorCode) => {
    scannerErrorHandledRef.current = true;

    const descriptions: Record<string, string> = {
      "permission-denied": "Could not access camera. Please allow camera permission.",
      "no-camera": "No camera was found on this device.",
      "camera-unavailable": "The camera is currently unavailable. Please try again.",
      "unsupported": "Your browser does not support QR scanning.",
      "invalid-payload": "The scanned QR code is not valid.",
      unknown: "Could not start the QR scanner.",
    };

    toast({
      variant: "destructive",
      title: "Camera error",
      description: descriptions[errorCode] ?? descriptions.unknown,
    });
  }, [toast]);

  const startScanner = useCallback(async () => {
    if (isScanning || scannerSessionRef.current) return;
    const generation = scannerGenerationRef.current;
    scannerErrorHandledRef.current = false;
    setIsScanning(true);

    const video = videoRef.current;
    if (!video) {
      handleScannerError("unsupported");
      setIsScanning(false);
      return;
    }

    let session: QrScannerSession | null = null;
    try {
      session = await startSafeHybridQrScanner({
        video,
        onResult: async ({ text }) => {
          if (!session) return;

          scannerGenerationRef.current += 1;
          session.stop();
        if (scannerSessionRef.current === session) {
          scannerSessionRef.current = null;
        }
        setIsScanning(false);
        setScannedEmployeeId(parseEmployeeIdFromQrText(text) ?? text.trim());
        setQrStep("pin");
      },
        onError: handleScannerError,
      });

      if (generation !== scannerGenerationRef.current) {
        session.stop();
        setIsScanning(false);
        return;
      }

      scannerSessionRef.current = session;
    } catch (error) {
      if (!scannerErrorHandledRef.current) {
        handleScannerError(normalizeScannerError(error));
      }
      if (session) {
        session.stop();
        if (scannerSessionRef.current === session) {
          scannerSessionRef.current = null;
        }
      }
      setIsScanning(false);
    }
  }, [handleScannerError, isScanning]);

  useEffect(() => {
    if (activeTab !== "qr") stopScanner();
  }, [activeTab, stopScanner]);

  useEffect(() => () => stopScanner(), [stopScanner]);

  const resetQrFlow = useCallback(() => {
    stopScanner();
    setQrStep("scan");
    setScannedEmployeeId("");
    setScannedEmployeeName("");
    setQrPin("");
  }, [stopScanner]);

  const handleQrPinStep = useCallback(async () => {
    if (!scannedEmployeeId) return;
    setIsQrLoading(true);
    try {
      const employeeId = parseEmployeeIdFromQrText(scannedEmployeeId) ?? scannedEmployeeId;
      const res = await fetch("/api/guard/auth/pin-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      const data = await res.json();

      if (!data.found) {
        toast({
          variant: "destructive",
          title: "Not Registered",
          description: "No employee found for this QR code.",
        });
        resetQrFlow();
        return;
      }

      if (!data.hasPin) {
        toast({
          title: "PIN Not Set",
          description: "Please set up your PIN first before logging in.",
        });
        router.push("/guard-login/setup");
        return;
      }

      setScannedEmployeeName(data.employeeName ?? "");
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not verify employee." });
      resetQrFlow();
    } finally {
      setIsQrLoading(false);
    }
  }, [resetQrFlow, router, scannedEmployeeId, toast]);

  const handleQrLogin = async () => {
    if (!scannedEmployeeId || qrPin.length < 4) return;
    setIsQrLoading(true);
    try {
      const employeeId = parseEmployeeIdFromQrText(scannedEmployeeId) ?? scannedEmployeeId;
      const res = await fetch("/api/guard/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, pin: qrPin }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Login Failed", description: data.error ?? "Could not sign in." });
        return;
      }
      await signInWithCustomToken(auth, data.token as string);
      toast({ title: `Welcome, ${data.employeeName ?? "Guard"}!` });
      router.push("/guard/dashboard");
    } catch {
      toast({ variant: "destructive", title: "Error", description: "An unexpected error occurred." });
    } finally {
      setIsQrLoading(false);
    }
  };

  useEffect(() => {
    if (qrStep === "pin" && scannedEmployeeId && !scannedEmployeeName) {
      handleQrPinStep();
    }
  }, [handleQrPinStep, qrStep, scannedEmployeeId, scannedEmployeeName]);

  return (
    <div
      className="min-h-[100dvh] w-full flex flex-col md:flex-row text-foreground"
      style={{ background: "linear-gradient(160deg, hsl(206 98% 26%) 0%, hsl(206 98% 18%) 60%, hsl(206 98% 10%) 100%)" }}
    >
      {/* Desktop brand panel — hidden on mobile */}
      <aside className="hidden md:flex md:flex-1 md:flex-col md:justify-between md:p-12 lg:p-16 text-white relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 top-10 h-96 w-96 rounded-full bg-accent/15 blur-3xl" />
          <div className="absolute -right-20 bottom-10 h-96 w-96 rounded-full bg-white/8 blur-3xl" />
        </div>

        <div className="relative flex items-center gap-3 animate-slide-up">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15 inset-highlight">
            <Image src="/ciss-logo.png" alt="CISS Logo" width={40} height={40} data-ai-hint="company logo" />
          </div>
          <div>
            <p className="text-base font-bold font-exo2 tracking-tight">CISS Workforce</p>
            <p className="text-xs text-white/60">Kerala security operations</p>
          </div>
        </div>

        <div className="relative max-w-md animate-slide-up stagger-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent mb-3">Guard Portal</p>
          <h1 className="text-4xl lg:text-5xl font-bold font-exo2 tracking-tight leading-[1.1]">
            Sign in to start your duty.
          </h1>
          <p className="mt-4 text-base text-white/70 leading-relaxed">
            Mark attendance, check your schedule, and stay connected with your team.
          </p>

          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-3 text-sm text-white/80">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 ring-1 ring-white/15">
                <ShieldCheck className="h-4 w-4 text-accent" />
              </div>
              <span>Secure PIN login — no password required</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-white/80">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 ring-1 ring-white/15">
                <QrCode className="h-4 w-4 text-accent" />
              </div>
              <span>Or scan your CISS QR ID card</span>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-white/50 animate-slide-up stagger-2">
          &copy; {new Date().getFullYear()} CISS Workforce. All rights reserved.
        </p>
      </aside>

      {/* Login panel */}
      <main className="flex-1 flex flex-col md:items-center md:justify-center md:p-10">
        <div className="flex-1 flex flex-col w-full md:flex-none md:max-w-md">

          {/* Brand header — mobile only */}
          <div className="flex flex-col items-center justify-center pt-14 pb-7 px-6 md:hidden animate-slide-up">
            <div
              className="flex h-20 w-20 items-center justify-center rounded-[22px] mb-5 bg-white/10 ring-1 ring-white/15 inset-highlight"
            >
              <Image src="/ciss-logo.png" alt="CISS Logo" width={50} height={50} data-ai-hint="company logo" />
            </div>
            <h1 className="text-2xl font-bold text-white font-exo2 tracking-tight">
              Guard Portal
            </h1>
            <p className="text-sm mt-1.5 font-medium text-accent">
              CISS Workforce
            </p>
          </div>

          {/* Card — bottom-sheet on mobile, centered card on desktop */}
          <div className="flex-1 flex flex-col md:flex-none animate-slide-up stagger-2">
            <div
              className="flex-1 md:flex-none rounded-t-[28px] rounded-b-none md:rounded-3xl bg-card text-card-foreground md:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] md:ring-1 md:ring-white/10 px-6 pt-7 pb-8 sm:px-8 md:p-10"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 2rem)" }}
            >
              <div className="text-center md:text-left mb-6">
                <h2 className="text-2xl font-bold font-exo2 tracking-tight">Welcome back</h2>
                <p className="text-base text-muted-foreground mt-1">
                  Sign in to continue.
                </p>
              </div>

              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="w-full h-12 p-1 mb-6">
                  <TabsTrigger value="phone" className="flex-1 gap-2 h-10 text-sm font-semibold">
                    <Phone className="h-4 w-4" />
                    Phone + PIN
                  </TabsTrigger>
                  <TabsTrigger value="qr" className="flex-1 gap-2 h-10 text-sm font-semibold">
                    <QrCode className="h-4 w-4" />
                    QR Login
                  </TabsTrigger>
                </TabsList>

                {/* Phone + PIN */}
                <TabsContent value="phone" className="space-y-5 mt-0">
                  {phoneStep === "phone" ? (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-foreground" htmlFor="guard-phone">
                          Phone Number
                        </label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-base font-medium select-none">+91</span>
                          <Input
                            id="guard-phone"
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                            maxLength={10}
                            disabled={isLoading}
                            className="h-14 text-lg pl-14 tracking-wide"
                            placeholder="10-digit mobile"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") handlePhoneContinue(); }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Use the mobile number registered by your admin.
                        </p>
                      </div>

                      <Button
                        className="w-full h-14 text-base font-semibold rounded-xl"
                        onClick={handlePhoneContinue}
                        disabled={isLoading || phoneNumber.replace(/\D/g, "").length < 10}
                      >
                        {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</> : <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>}
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="rounded-xl border bg-muted/50 px-4 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground">Signing in as</p>
                          <p className="text-base font-semibold tabular-nums">+91 {phoneNumber}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 text-xs"
                          onClick={() => { setPhoneStep("phone"); setPin(""); }}
                          disabled={isLoading}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Change
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-foreground" htmlFor="guard-pin">
                          Enter PIN
                        </label>
                        <Input
                          id="guard-pin"
                          ref={pinInputRef}
                          type="password"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={pin}
                          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          maxLength={6}
                          disabled={isLoading}
                          className="h-14 text-2xl text-center tracking-[0.5em] font-semibold"
                          placeholder="••••"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
                        />
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">4 to 6 digit PIN</p>
                          <Link href="/guard-forgot-pin" className="text-xs font-medium text-primary hover:underline">
                            Forgot PIN?
                          </Link>
                        </div>
                      </div>

                      <Button
                        className="w-full h-14 text-base font-semibold rounded-xl"
                        onClick={handleLogin}
                        disabled={isLoading || pin.length < 4}
                      >
                        {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...</> : <>Sign In <ArrowRight className="ml-2 h-4 w-4" /></>}
                      </Button>
                    </>
                  )}
                </TabsContent>

                {/* QR Login */}
                <TabsContent value="qr" className="space-y-5 mt-0">
                  {qrStep === "scan" ? (
                    <div className="space-y-4">
                      <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-black ring-1 ring-border">
                        <video
                          ref={videoRef}
                          className="absolute inset-0 w-full h-full object-cover"
                          muted
                          playsInline
                        />
                        {isScanning && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-3/5 h-3/5 border-2 border-white/80 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
                              <ScanLine className="absolute -top-3 left-1/2 -translate-x-1/2 h-5 w-5 text-accent animate-bounce" />
                            </div>
                          </div>
                        )}
                        {!isScanning && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80 bg-gradient-to-b from-white/5 to-black/30">
                            <QrCode className="h-14 w-14" />
                            <p className="text-sm">Tap below to start scanning</p>
                          </div>
                        )}
                      </div>

                      <Button
                        className="w-full h-14 text-base font-semibold rounded-xl"
                        onClick={startScanner}
                        disabled={isScanning}
                      >
                        {isScanning
                          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning…</>
                          : <><QrCode className="mr-2 h-4 w-4" /> Scan QR Card</>}
                      </Button>
                      <p className="text-xs text-center text-muted-foreground">
                        Hold your CISS QR card in front of the camera
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div className="rounded-xl border bg-muted/50 px-4 py-3">
                        <p className="text-xs text-muted-foreground">Employee</p>
                        <p className="text-base font-semibold truncate">
                          {scannedEmployeeName || scannedEmployeeId}
                        </p>
                        {scannedEmployeeName && (
                          <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{scannedEmployeeId}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-foreground" htmlFor="qr-pin">
                          Enter your PIN
                        </label>
                        <Input
                          id="qr-pin"
                          type="password"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={qrPin}
                          onChange={(e) => setQrPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          maxLength={6}
                          disabled={isQrLoading}
                          className="h-14 text-2xl text-center tracking-[0.5em] font-semibold"
                          placeholder="••••"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === "Enter") handleQrLogin(); }}
                        />
                        <p className="text-xs text-muted-foreground">4 to 6 digit PIN</p>
                      </div>

                      <Button
                        className="w-full h-14 text-base font-semibold rounded-xl"
                        onClick={handleQrLogin}
                        disabled={isQrLoading || qrPin.length < 4}
                      >
                        {isQrLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</> : <>Sign In <ArrowRight className="ml-2 h-4 w-4" /></>}
                      </Button>

                      <Button
                        variant="ghost"
                        className="w-full h-11 text-sm"
                        onClick={resetQrFlow}
                        disabled={isQrLoading}
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Scan a different QR
                      </Button>
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              <div className="divider-text mt-7 text-xs uppercase tracking-widest text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
              </div>

              <Link
                href="/guard-login/setup"
                className="mt-5 w-full flex items-center justify-center gap-2 h-12 rounded-xl border border-border bg-background hover:bg-muted text-sm font-semibold text-foreground transition-colors"
              >
                <KeyRound className="h-4 w-4 text-primary" />
                First time? Set up PIN
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
