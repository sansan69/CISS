"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CheckCircle2, ChevronRight, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function GuardResetPinPage() {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Step 1 fields
  const [employeeId, setEmployeeId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  // Step 2 fields
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const handleStep1Next = () => {
    if (!employeeId || !phoneNumber || !dateOfBirth) {
      toast({
        variant: "destructive",
        title: "All fields are required",
        description: "Please fill in Employee ID, Phone Number, and Date of Birth.",
      });
      return;
    }
    setStep(2);
  };

  const handleSubmit = async () => {
    if (pin.length < 4) {
      toast({ variant: "destructive", title: "PIN must be at least 4 digits." });
      return;
    }
    if (pin !== confirmPin) {
      toast({ variant: "destructive", title: "PINs do not match." });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/guard/auth/setup-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, phoneNumber, dateOfBirth, pin }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Reset Failed",
          description: data.error ?? "Could not reset PIN.",
        });
        return;
      }

      setSuccess(true);
    } catch (err: unknown) {
      console.error("[guard-reset]", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "An unexpected error occurred.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto px-4 py-8">
      <header className="text-center mb-8">
        <Image
          src="/ciss-logo.png"
          alt="CISS Logo"
          width={64}
          height={64}
          className="mx-auto"
          data-ai-hint="company logo"
        />
        <h1 className="text-2xl font-bold mt-4" style={{ color: "#014c85" }}>
          Reset PIN
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Verify your identity to reset your PIN</p>
      </header>

      {success ? (
        <Card className="shadow-lg text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <CheckCircle2 className="h-14 w-14 mx-auto text-green-500" />
            <h2 className="text-lg font-semibold">PIN Reset Successfully!</h2>
            <p className="text-sm text-muted-foreground">
              Your new PIN is active. You can now sign in with your updated PIN.
            </p>
            <Button className="w-full" style={{ backgroundColor: "#014c85" }} asChild>
              <Link href="/guard-login">Go to Login</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-center text-lg">
              {step === 1 ? "Step 1 of 2 — Verify Identity" : "Step 2 of 2 — New PIN"}
            </CardTitle>
            <CardDescription className="text-center">
              {step === 1
                ? "Enter your employee details to verify your identity."
                : "Choose a new 4-6 digit PIN."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 1 ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="reset-emp-id">
                    Employee ID
                  </label>
                  <Input
                    id="reset-emp-id"
                    type="text"
                    placeholder="e.g. EMP001"
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value.trim())}
                    className="h-12"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="reset-phone">
                    Phone Number
                  </label>
                  <Input
                    id="reset-phone"
                    type="tel"
                    placeholder="10-digit mobile number"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    maxLength={15}
                    className="h-12"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="reset-dob">
                    Date of Birth
                  </label>
                  <Input
                    id="reset-dob"
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="h-12"
                  />
                </div>
                <Button
                  className="w-full h-12 font-semibold"
                  style={{ backgroundColor: "#014c85" }}
                  onClick={handleStep1Next}
                >
                  Next <ChevronRight className="ml-2 h-4 w-4" />
                </Button>

                <p className="text-center text-sm mt-2">
                  <Link
                    href="/guard-login"
                    className="text-muted-foreground hover:underline"
                  >
                    Back to Login
                  </Link>
                </p>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="reset-pin">
                    New PIN (4-6 digits)
                  </label>
                  <Input
                    id="reset-pin"
                    type="password"
                    inputMode="numeric"
                    placeholder="Enter new PIN"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    maxLength={6}
                    className="h-12 text-center tracking-widest text-base"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="reset-pin-confirm">
                    Confirm New PIN
                  </label>
                  <Input
                    id="reset-pin-confirm"
                    type="password"
                    inputMode="numeric"
                    placeholder="Re-enter new PIN"
                    value={confirmPin}
                    onChange={(e) =>
                      setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    maxLength={6}
                    className="h-12 text-center tracking-widest text-base"
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1 h-12"
                    onClick={() => setStep(1)}
                    disabled={isLoading}
                  >
                    <ChevronLeft className="mr-2 h-4 w-4" /> Back
                  </Button>
                  <Button
                    className="flex-1 h-12 font-semibold"
                    style={{ backgroundColor: "#014c85" }}
                    onClick={handleSubmit}
                    disabled={isLoading || pin.length < 4 || confirmPin.length < 4}
                  >
                    {isLoading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resetting...</>
                    ) : (
                      "Reset PIN"
                    )}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
