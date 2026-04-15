"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CheckCircle2, ChevronRight, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function GuardSetupPage() {
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
          title: "Setup Failed",
          description: data.error ?? "Could not set up PIN.",
        });
        return;
      }

      setSuccess(true);
    } catch (err: unknown) {
      console.error("[guard-setup]", err);
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
          Guard Portal Setup
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Set up your PIN to get started</p>
      </header>

      {success ? (
        <Card className="shadow-lg text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <CheckCircle2 className="h-14 w-14 mx-auto text-green-500" />
            <h2 className="text-lg font-semibold">PIN Set Successfully!</h2>
            <p className="text-sm text-muted-foreground">
              You can now sign in to the Guard Portal using your phone number and PIN.
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
              {step === 1 ? "Step 1 of 2 — Verify Identity" : "Step 2 of 2 — Choose PIN"}
            </CardTitle>
            <CardDescription className="text-center">
              {step === 1
                ? "Enter your employee details to verify your identity."
                : "Choose a 4-6 digit PIN you will use to log in."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 1 ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="setup-emp-id">
                    Employee ID
                  </label>
                  <Input
                    id="setup-emp-id"
                    type="text"
                    placeholder=" "
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value.trim())}
                    className="h-12"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="setup-phone">
                    Phone Number
                  </label>
                  <Input
                    id="setup-phone"
                    type="tel"
                    placeholder=" "
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    maxLength={15}
                    className="h-12"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="setup-dob">
                    Date of Birth
                  </label>
                  <Input
                    id="setup-dob"
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
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="setup-pin">
                    Choose PIN (4-6 digits)
                  </label>
                  <Input
                    id="setup-pin"
                    type="password"
                    inputMode="numeric"
                    placeholder=" "
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    maxLength={6}
                    className="h-12 text-center tracking-widest text-base"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="setup-pin-confirm">
                    Confirm PIN
                  </label>
                  <Input
                    id="setup-pin-confirm"
                    type="password"
                    inputMode="numeric"
                    placeholder=" "
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
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Setting up...</>
                    ) : (
                      "Set PIN"
                    )}
                  </Button>
                </div>
              </>
            )}

            {step === 1 && (
              <p className="text-center text-sm mt-4">
                Already set up?{" "}
                <Link
                  href="/guard-login"
                  className="font-medium hover:underline"
                  style={{ color: "#014c85" }}
                >
                  Go to Login
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
