"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, KeyRound, Loader2, QrCode, RotateCcw, ScanLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { parseEmployeeQrText } from "@/lib/qr/employee-qr";
import { startSafeHybridQrScanner } from "@/lib/qr/scanner-engine";
import { normalizeScannerError } from "@/lib/qr/scanner-support";
import type { QrScannerErrorCode, QrScannerSession } from "@/lib/qr/scanner-types";

type Step = 1 | 2;
type IdentifyMode = "scan" | "manual";

export default function GuardResetPinPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(1);
  const [identifyMode, setIdentifyMode] = useState<IdentifyMode>("scan");
  const [employeeId, setEmployeeId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [qrText, setQrText] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerSessionRef = useRef<QrScannerSession | null>(null);
  const scannerGenerationRef = useRef(0);
  const scannerErrorHandledRef = useRef(false);

  const normalizedEmployeeId = employeeId.trim();
  const normalizedPhone = phoneNumber.replace(/\D/g, "").slice(0, 10);
  const parsedQr = parseEmployeeQrText(qrText);
  const effectiveEmployeeId = normalizedEmployeeId || parsedQr.employeeId || "";
  const effectivePhone = normalizedPhone || parsedQr.phoneNumber || "";
  const canContinue = Boolean((effectiveEmployeeId || effectivePhone) && dateOfBirth);

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
      "permission-denied": "Could not access the camera. Please allow camera permission.",
      "no-camera": "No camera was found on this device.",
      "camera-unavailable": "The camera is currently unavailable. Please try again.",
      unsupported: "Your browser does not support QR scanning.",
      "invalid-payload": "The scanned QR code is not valid.",
      unknown: "Could not start the QR scanner.",
    };

    setScanError(descriptions[errorCode] ?? descriptions.unknown);
    toast({
      variant: "destructive",
      title: "Scanner error",
      description: descriptions[errorCode] ?? descriptions.unknown,
    });
  }, [toast]);

  const startScanner = useCallback(async () => {
    if (isScanning || scannerSessionRef.current) return;
    const generation = scannerGenerationRef.current;
    scannerErrorHandledRef.current = false;
    setScanError(null);
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
          setQrText(text);
          const parsed = parseEmployeeQrText(text);
          setEmployeeId(parsed.employeeId ?? "");
          setPhoneNumber(parsed.phoneNumber ?? "");
          setStep(1);
          setIdentifyMode("scan");
          toast({
            title: "QR captured",
            description: "We matched the guard details from the QR card.",
          });
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
  }, [handleScannerError, isScanning, toast]);

  useEffect(() => {
    if (identifyMode !== "scan") {
      stopScanner();
    }
  }, [identifyMode, stopScanner]);

  useEffect(() => () => stopScanner(), [stopScanner]);

  const goToStepTwo = () => {
    if (!canContinue) {
      toast({
        variant: "destructive",
        title: "Missing details",
        description: "Scan the QR code or enter the employee ID, then add the date of birth.",
      });
      return;
    }

    setStep(2);
  };

  const handleReset = async () => {
    if (newPin.length < 4 || newPin.length > 6) {
      toast({ variant: "destructive", title: "Invalid PIN", description: "PIN must be 4-6 digits." });
      return;
    }
    if (newPin !== confirmPin) {
      toast({ variant: "destructive", title: "PIN mismatch", description: "PINs do not match." });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/guard/auth/reset-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: effectiveEmployeeId,
          phoneNumber: effectivePhone,
          qrText,
          dateOfBirth,
          newPin,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Reset failed",
          description: data.error || "Could not reset PIN.",
        });
        return;
      }

      toast({
        title: "PIN reset",
        description: data.message || "Your PIN has been reset successfully.",
      });
      router.push("/guard-login");
    } catch {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Something went wrong while resetting the PIN.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 2) {
      setStep(1);
      return;
    }
    router.push("/guard-login");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-sky-950 px-4 py-8 text-slate-100">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-6 text-center">
          <Image
            src="/ciss-logo.png"
            alt="CISS"
            width={72}
            height={72}
            className="mx-auto mb-4"
            data-ai-hint="company logo"
          />
          <p className="text-xs uppercase tracking-[0.28em] text-sky-200/80">Guard Portal</p>
          <h1 className="mt-2 text-3xl font-bold text-white">Forgot PIN</h1>
          <p className="mt-2 text-sm text-slate-300">
            Verify your identity with QR or employee ID, then set a new PIN.
          </p>
        </header>

        <Card className="border-white/10 bg-white/95 text-slate-900 shadow-2xl shadow-sky-950/30 backdrop-blur">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-xl">
              <KeyRound className="h-5 w-5 text-sky-700" />
              Reset your PIN
            </CardTitle>
            <CardDescription>
              {step === 1 ? "Identify yourself using the card QR or employee ID." : "Choose a new PIN and confirm it."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {step === 1 ? (
              <>
                <Tabs value={identifyMode} onValueChange={(value) => setIdentifyMode(value as IdentifyMode)} className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="scan" className="gap-2">
                      <ScanLine className="h-4 w-4" />
                      Scan QR
                    </TabsTrigger>
                    <TabsTrigger value="manual" className="gap-2">
                      <QrCode className="h-4 w-4" />
                      Enter ID
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="scan" className="mt-4 space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <video ref={videoRef} className="h-64 w-full rounded-xl bg-black object-cover" muted playsInline />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" className="gap-2" onClick={startScanner} disabled={isScanning}>
                          {isScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
                          {isScanning ? "Scanning..." : "Start scanner"}
                        </Button>
                        <Button type="button" variant="outline" className="gap-2" onClick={stopScanner} disabled={!isScanning}>
                          <RotateCcw className="h-4 w-4" />
                          Stop
                        </Button>
                      </div>
                      {scanError && <p className="mt-3 text-sm text-red-600">{scanError}</p>}
                    </div>
                  </TabsContent>

                  <TabsContent value="manual" className="mt-4 space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="employee-id">Employee ID</Label>
                      <Input
                        id="employee-id"
                        placeholder="CISS/..."
                        value={employeeId}
                        onChange={(e) => setEmployeeId(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone-number">Phone Number</Label>
                      <Input
                        id="phone-number"
                        type="tel"
                        placeholder="10-digit mobile number"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        maxLength={10}
                        autoComplete="off"
                      />
                    </div>
                  </TabsContent>
                </Tabs>

                <div className="space-y-2">
                  <Label htmlFor="dob">Date of Birth</Label>
                  <Input
                    id="dob"
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                  />
                </div>

                {(effectiveEmployeeId || effectivePhone) && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                    <p className="font-medium">Matched identity</p>
                    <p className="mt-1">Employee ID: {effectiveEmployeeId || "—"}</p>
                    <p>Phone: {effectivePhone || "—"}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1" onClick={handleBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                  <Button type="button" className="flex-1 gap-2" onClick={goToStepTwo} disabled={!canContinue}>
                    Continue
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                  <p className="font-medium">Identity verified</p>
                  <p className="mt-1">Employee ID: {effectiveEmployeeId || "—"}</p>
                  <p>Date of Birth: {dateOfBirth || "—"}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-pin">New PIN</Label>
                  <Input
                    id="new-pin"
                    type="password"
                    inputMode="numeric"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    maxLength={6}
                    className="text-center tracking-[0.35em]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-pin">Confirm PIN</Label>
                  <Input
                    id="confirm-pin"
                    type="password"
                    inputMode="numeric"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    maxLength={6}
                    className="text-center tracking-[0.35em]"
                  />
                </div>

                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1" onClick={handleBack} disabled={isLoading}>
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    type="button"
                    className="flex-1 gap-2"
                    onClick={handleReset}
                    disabled={isLoading || newPin.length < 4 || newPin !== confirmPin}
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Reset PIN
                  </Button>
                </div>
              </>
            )}

            <div className="text-center">
              <Link href="/guard-login" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-sky-700">
                <ArrowLeft className="h-3 w-3" />
                Back to login
              </Link>
            </div>
          </CardContent>
        </Card>

        {step === 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-sky-100/80">
            <CheckCircle2 className="h-4 w-4" />
            No OTP required
          </div>
        )}
      </div>
    </div>
  );
}
