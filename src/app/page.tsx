
"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Phone, CalendarDays, QrCode, ChevronRight, Sun, HomeIcon, DownloadCloud, Loader2, KeyRound } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import Image from 'next/image';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import type { Employee } from '@/types/employee';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { signInWithPhoneNumber, RecaptchaVerifier, type ConfirmationResult } from "firebase/auth";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: Array<string>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed',
    platform: string
  }>;
  prompt(): Promise<void>;
}

export default function LandingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [showOtpInput, setShowOtpInput] = useState(false);
  
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      setDeferredPrompt(null);
    });
  };
  
  const setupRecaptcha = () => {
    // Ensure window.recaptchaVerifier is not already set
    if (window.recaptchaVerifier) {
      return window.recaptchaVerifier;
    }
    const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        'size': 'invisible',
        'callback': (response: any) => {
          // reCAPTCHA solved, allow signInWithPhoneNumber.
        },
        'expired-callback': () => {
           toast({ variant: "destructive", title: "reCAPTCHA Expired", description: "Please try sending the OTP again." });
        }
    });
    window.recaptchaVerifier = verifier;
    return verifier;
  }

  const handleSendOtp = async () => {
    let normalizedPhoneNumber = phoneNumber.trim();
    if (!/^\d{10}$/.test(normalizedPhoneNumber.replace(/\D/g, ''))) {
      toast({ variant: "destructive", title: "Invalid Phone Number", description: "Please enter a valid 10-digit phone number." });
      return;
    }
    
    const fullPhoneNumber = `+91${normalizedPhoneNumber.replace(/\D/g, '')}`;

    setIsLoading(true);
    toast({ title: "Sending OTP...", description: "Please wait." });
    
    try {
      const appVerifier = setupRecaptcha();
      const result = await signInWithPhoneNumber(auth, fullPhoneNumber, appVerifier);
      setConfirmationResult(result);
      setShowOtpInput(true);
      toast({ title: "OTP Sent", description: "Please check your phone for the verification code." });
    } catch (error: any) {
      console.error("Error sending OTP:", error);
      let description = "Could not send OTP. Please check the phone number and try again.";
      if (error.code === 'auth/too-many-requests') {
        description = "Too many requests. Please wait a while before trying again.";
      } else if (error.code === 'auth/invalid-phone-number') {
        description = "The phone number is not valid.";
      } else if (error.code === 'auth/captcha-check-failed') {
          description = "Verification failed. Please ensure your domain is authorized in your reCAPTCHA settings."
      } else if (error.code === 'auth/argument-error') {
          description = "Verification is required. The reCAPTCHA verifier may not be ready."
      }
      toast({ variant: "destructive", title: "OTP Send Failed", description });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length !== 6) {
      toast({ variant: "destructive", title: "Invalid OTP", description: "Please enter the 6-digit OTP." });
      return;
    }
    if (!confirmationResult) {
      toast({ variant: "destructive", title: "Verification Failed", description: "Could not verify OTP. Please try again." });
      return;
    }

    setIsLoading(true);
    toast({ title: "Verifying OTP...", description: "Please wait." });

    try {
      await confirmationResult.confirm(otp);
      toast({ title: "OTP Verified!", description: "Checking for existing registration..." });
      
      const verifiedPhoneNumber = phoneNumber.replace(/\D/g, '');
      const employeesRef = collection(db, "employees");
      const q = query(employeesRef, where("phoneNumber", "==", verifiedPhoneNumber));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const employeeDoc = querySnapshot.docs[0];
        toast({ title: "Employee Found", description: `Welcome back, ${employeeDoc.data().fullName}! Redirecting...` });
        router.push(`/profile/${employeeDoc.id}`);
      } else {
        toast({ title: "New User Detected", description: "Redirecting to enrollment page." });
        router.push(`/enroll?phone=${verifiedPhoneNumber}`);
      }

    } catch (error: any) {
      console.error("Error verifying OTP:", error);
      let description = "Failed to verify OTP. Please check the code and try again.";
      if (error.code === 'auth/invalid-verification-code') {
        description = "The OTP you entered is invalid. Please try again.";
      } else if (error.code === 'auth/code-expired') {
        description = "The OTP has expired. Please request a new one.";
      }
      toast({ variant: "destructive", title: "Verification Failed", description });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background text-foreground">
      <div id="recaptcha-container"></div>
      <div className="absolute top-4 right-4">
        <Button variant="ghost" size="icon" onClick={() => alert("Theme toggle functionality to be implemented")} title="Toggle theme">
          <Sun className="h-6 w-6" />
        </Button>
      </div>

      <header className="text-center mb-8">
        <Image
            src="/ciss-logo.png"
            alt="CISS Workforce Logo"
            width={80}
            height={80}
            unoptimized={true}
            data-ai-hint="company logo"
            className="mx-auto"
        />
        <h1 className="text-4xl font-bold text-foreground mt-4">CISS Workforce</h1>
        <p className="text-lg text-muted-foreground">Employee Management System</p>
      </header>

      {deferredPrompt && (
        <Alert className="max-w-xl w-full mb-8 border-primary/50 bg-primary/10">
          <DownloadCloud className="h-4 w-4" />
          <AlertTitle>Install CISS Workforce</AlertTitle>
          <AlertDescription className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <p>For a better experience, install the app on your device for quick, offline access.</p>
            <Button onClick={handleInstallClick} className="w-full sm:w-auto shrink-0">
                Install App
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!showOtpInput && (
        <p className="max-w-xl text-center text-muted-foreground mb-10">
          Welcome to CISS Workforce. Please enter your mobile number to log in or register.
          An OTP will be sent for verification.
        </p>
      )}

      <Card className="w-full max-w-md shadow-2xl bg-card">
        <CardHeader>
          <CardTitle className="text-2xl text-center text-card-foreground">
            {showOtpInput ? 'Verify Your Number' : 'Employee Login'}
          </CardTitle>
          {showOtpInput && (
            <CardDescription className="text-center">
              An OTP has been sent to +91 {phoneNumber}.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
            {!showOtpInput ? (
                <>
                    <div className="relative">
                        <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                        type="tel"
                        placeholder="Enter your 10-digit number"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        className="pl-10 text-base"
                        maxLength={10}
                        disabled={isLoading}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSendOtp(); }}
                        />
                    </div>
                    <Button onClick={handleSendOtp} className="w-full text-base py-3" variant="default" disabled={isLoading}>
                        {isLoading ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending OTP...
                        </>
                        ) : (
                        "Send OTP"
                        )}
                    </Button>
                </>
            ) : (
                 <>
                    <div className="relative">
                        <KeyRound className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                        type="tel"
                        placeholder="Enter 6-digit OTP"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        className="pl-10 text-base"
                        maxLength={6}
                        disabled={isLoading}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp(); }}
                        />
                    </div>
                    <Button onClick={handleVerifyOtp} className="w-full text-base py-3" variant="default" disabled={isLoading}>
                        {isLoading ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...
                        </>
                        ) : (
                        "Verify & Continue"
                        )}
                    </Button>
                    <Button variant="link" size="sm" onClick={() => setShowOtpInput(false)} disabled={isLoading}>
                        Change Number
                    </Button>
                </>
            )}
        </CardContent>
      </Card>

      <div className="mt-8 w-full max-w-md space-y-3">
        <Button variant="secondary" className="w-full text-base py-3 justify-center" asChild>
          <Link href="/attendance">
            <span className="inline-flex items-center justify-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Record Attendance
              <QrCode className="h-5 w-5" />
            </span>
          </Link>
        </Button>
        <Button variant="outline" className="w-full text-base py-3" asChild>
          <Link href="/admin-login">
            <span className="inline-flex items-center justify-center gap-2">
              Admin Dashboard
              <ChevronRight className="h-5 w-5" />
            </span>
          </Link>
        </Button>
      </div>
      
      <footer className="mt-12 text-center text-sm text-muted-foreground">
        &copy; {new Date().getFullYear()} CISS Workforce. All rights reserved.
      </footer>
    </div>
  );
}

// Extend the Window interface to include our custom property
declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier;
  }
}
