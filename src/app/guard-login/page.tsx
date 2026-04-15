"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, QrCode, Phone, ScanLine, RotateCcw, ArrowRight, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
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
        } catch (error) {
          console.warn("Failed to register FCM token:", error);
        }
      }

      toast({ title: `Welcome, ${data.employeeName ?? "Guard"}!` });
      router.push("/guard/dashboard");
    } catch (err: unknown) {
      console.error("[guard-login]", err);
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
          setScannedEmployeeId(text);
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

  const handleQrPinStep = async () => {
    if (!scannedEmployeeId) return;
    setIsQrLoading(true);
    try {
      const res = await fetch("/api/guard/auth/pin-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: scannedEmployeeId }),
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
  };

  const handleQrLogin = async () => {
    if (!scannedEmployeeId || qrPin.length < 4) return;
    setIsQrLoading(true);
    try {
      const res = await fetch("/api/guard/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: scannedEmployeeId, pin: qrPin }),
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
  }, [qrStep, scannedEmployeeId]);

  return (
    <div className="w-full max-w-sm mx-auto px-4 py-8">
      <header className="text-center mb-8">
        <Image
          src="/ciss-logo.png"
          alt="CISS Logo"
          width={72}
          height={72}
          className="mx-auto"
          data-ai-hint="company logo"
        />
        <h1
          className="text-2xl font-bold mt-4"
          style={{ color: "#014c85" }}
        >
          Guard Portal
        </h1>
        <p className="text-sm text-muted-foreground mt-1">CISS Workforce</p>
      </header>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-center text-lg">Sign In</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full mb-6">
              <TabsTrigger value="phone" className="flex-1 gap-2">
                <Phone className="h-4 w-4" />
                Phone + PIN
              </TabsTrigger>
              <TabsTrigger value="qr" className="flex-1 gap-2">
                <QrCode className="h-4 w-4" />
                QR Login
              </TabsTrigger>
            </TabsList>

            {/* Phone + PIN */}
            <TabsContent value="phone" className="space-y-4">
              {phoneStep === "phone" ? (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="guard-phone">
                      Phone Number
                    </label>
                    <Input
                      id="guard-phone"
                      type="tel"
                      inputMode="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      maxLength={15}
                      disabled={isLoading}
                      className="h-12 text-base"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") handlePhoneContinue(); }}
                    />
                  </div>

                  <Button
                    className="w-full h-12 text-base font-semibold"
                    style={{ backgroundColor: "#014c85" }}
                    onClick={handlePhoneContinue}
                    disabled={isLoading || phoneNumber.replace(/\D/g, "").length < 10}
                  >
                    {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</> : <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>}
                  </Button>
                </>
              ) : (
                <>
                  <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-center">
                    <p className="text-muted-foreground text-xs mb-0.5">Phone Number</p>
                    <p className="font-semibold">{phoneNumber}</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="guard-pin">
                      PIN
                    </label>
                    <div className="flex gap-3 justify-center my-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-4 w-4 rounded-full border-2 transition-colors duration-150"
                          style={{
                            borderColor: "#014c85",
                            backgroundColor: pin.length > i ? "#014c85" : "transparent",
                          }}
                        />
                      ))}
                    </div>
                    <Input
                      id="guard-pin"
                      ref={pinInputRef}
                      type="password"
                      inputMode="numeric"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      maxLength={6}
                      disabled={isLoading}
                      className="h-12 text-base text-center tracking-widest"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
                    />
                  </div>

                  <Button
                    className="w-full h-12 text-base font-semibold"
                    style={{ backgroundColor: "#014c85" }}
                    onClick={handleLogin}
                    disabled={isLoading || pin.length < 4}
                  >
                    {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...</> : "Sign In"}
                  </Button>

                  <Button
                    variant="ghost"
                    className="w-full text-sm text-muted-foreground"
                    onClick={() => { setPhoneStep("phone"); setPin(""); }}
                    disabled={isLoading}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Use a different number
                  </Button>
                </>
              )}

              <div className="text-center mt-4">
                <Link href="/guard-forgot-pin" className="text-sm text-muted-foreground hover:text-primary">
                  Forgot your PIN?
                </Link>
              </div>
            </TabsContent>

            {/* QR Login */}
            <TabsContent value="qr" className="space-y-4">
              {qrStep === "scan" ? (
                <div className="space-y-4">
                  <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-black">
                    <video
                      ref={videoRef}
                      className="absolute inset-0 w-full h-full object-cover"
                      muted
                      playsInline
                    />
                    {isScanning && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-3/5 h-3/5 border-2 border-white/70 rounded-lg relative">
                          <ScanLine className="absolute -top-3 left-1/2 -translate-x-1/2 h-5 w-5 text-white animate-bounce" />
                        </div>
                      </div>
                    )}
                    {!isScanning && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
                        <QrCode className="h-12 w-12" />
                        <p className="text-sm">Tap below to start scanning</p>
                      </div>
                    )}
                  </div>

                  <Button
                    className="w-full h-12 text-base font-semibold"
                    style={{ backgroundColor: "#014c85" }}
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
                <div className="space-y-4">
                  <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-center">
                    <p className="text-muted-foreground text-xs mb-0.5">Scanned employee ID</p>
                    <p className="font-semibold">{scannedEmployeeId}</p>
                  </div>

                  {scannedEmployeeName && (
                    <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-center">
                      <p className="text-muted-foreground text-xs mb-0.5">Employee</p>
                      <p className="font-semibold">{scannedEmployeeName}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="qr-pin">
                      Enter your PIN
                    </label>
                    <div className="flex gap-3 justify-center my-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-4 w-4 rounded-full border-2 transition-colors duration-150"
                          style={{
                            borderColor: "#014c85",
                            backgroundColor: qrPin.length > i ? "#014c85" : "transparent",
                          }}
                        />
                      ))}
                    </div>
                    <Input
                      id="qr-pin"
                      type="password"
                      inputMode="numeric"
                      value={qrPin}
                      onChange={(e) => setQrPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      maxLength={6}
                      disabled={isQrLoading}
                      className="h-12 text-base text-center tracking-widest"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") handleQrLogin(); }}
                    />
                  </div>

                  <Button
                    className="w-full h-12 text-base font-semibold"
                    style={{ backgroundColor: "#014c85" }}
                    onClick={handleQrLogin}
                    disabled={isQrLoading || qrPin.length < 4}
                  >
                    {isQrLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</> : "Sign In"}
                  </Button>

                  <Button
                    variant="ghost"
                    className="w-full text-sm text-muted-foreground"
                    onClick={resetQrFlow}
                    disabled={isQrLoading}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Scan a different QR
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <div className="mt-6 text-center text-sm">
            <Link
              href="/guard-login/setup"
              className="font-medium hover:underline inline-flex items-center gap-1.5"
              style={{ color: "#014c85" }}
            >
              <KeyRound className="h-3.5 w-3.5" />
              First time? Set up PIN
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
