
"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Phone, CalendarDays, QrCode, ChevronRight, Sun, HomeIcon, DownloadCloud, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import Image from 'next/image';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import type { Employee } from '@/types/employee';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: Array<string>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed',
    platform: string
  }>;
  prompt(): Promise<void>;
}

declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier;
    confirmationResult?: ConfirmationResult;
  }
}

export default function LandingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  // Setup reCAPTCHA verifier
  useEffect(() => {
    if (!window.recaptchaVerifier) {
      // Ensure the container exists and is visible before initializing
      const recaptchaContainer = document.getElementById('recaptcha-container');
      if (recaptchaContainer) {
        // Styling to make the reCAPTCHA badge visible as required by Google's policy
        recaptchaContainer.style.position = 'fixed';
        recaptchaContainer.style.bottom = '1rem';
        recaptchaContainer.style.right = '1rem';
        recaptchaContainer.style.zIndex = '1000';
        
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          'size': 'invisible',
          'callback': (response: any) => {
            // reCAPTCHA solved, you can proceed with sign-in
            console.log("reCAPTCHA solved");
          },
          'expired-callback': () => {
            // Response expired. Ask user to solve reCAPTCHA again.
            toast({ variant: "destructive", title: "reCAPTCHA Expired", description: "Please try sending the OTP again." });
          }
        });
      }
    }
    
    // Cleanup function
    return () => {
        if (window.recaptchaVerifier) {
            window.recaptchaVerifier.clear();
        }
    };
  }, []);

  const handleSendOtp = async () => {
    const normalizedPhoneNumber = phoneNumber.trim().replace(/\D/g, '');
    if (!/^\d{10}$/.test(normalizedPhoneNumber)) {
      toast({ variant: "destructive", title: "Invalid Phone Number", description: "Please enter a valid 10-digit phone number." });
      return;
    }

    setIsLoading(true);
    toast({ title: "Checking Your Status & Sending OTP...", description: "Please wait." });

    try {
      // 1. Check if employee exists
      const employeesRef = collection(db, "employees");
      const q = query(employeesRef, where("phoneNumber", "==", normalizedPhoneNumber));
      const querySnapshot = await getDocs(q);

      const appVerifier = window.recaptchaVerifier;
      if (!appVerifier) {
          throw new Error("reCAPTCHA verifier not initialized.");
      }
      
      const fullPhoneNumber = `+91${normalizedPhoneNumber}`;

      // 2. Send OTP
      const result = await signInWithPhoneNumber(auth, fullPhoneNumber, appVerifier);
      setConfirmationResult(result);
      setShowOtpInput(true);
      toast({ title: "OTP Sent", description: "Please check your phone for the verification code." });

    } catch (error: any) {
      console.error("Error sending OTP:", error);
      let description = "Could not send OTP. Please try again later.";
      if (error.code === 'auth/too-many-requests') {
        description = "Too many requests. Please wait a while before trying again.";
      } else if (error.code === 'auth/invalid-phone-number') {
        description = "The phone number format is invalid.";
      }
      toast({ variant: "destructive", title: "An Error Occurred", description });
      setShowOtpInput(false); // Hide OTP field on error
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleVerifyOtp = async () => {
      if (!otp || otp.length !== 6) {
          toast({ variant: "destructive", title: "Invalid OTP", description: "Please enter a valid 6-digit OTP." });
          return;
      }
      if (!confirmationResult) {
          toast({ variant: "destructive", title: "Verification Error", description: "No confirmation result found. Please try sending OTP again." });
          return;
      }

      setIsLoading(true);
      toast({ title: "Verifying OTP...", description: "Please wait." });
      
      try {
          await confirmationResult.confirm(otp);
          // OTP is correct. Now, find the user and redirect.
          const normalizedPhoneNumber = phoneNumber.trim().replace(/\D/g, '');
          const employeesRef = collection(db, "employees");
          const q = query(employeesRef, where("phoneNumber", "==", normalizedPhoneNumber));
          const querySnapshot = await getDocs(q);

          if (!querySnapshot.empty) {
              const employeeDoc = querySnapshot.docs[0];
              toast({ title: "Verification Successful", description: `Welcome back, ${employeeDoc.data().fullName}! Redirecting...` });
              router.push(`/profile/${employeeDoc.id}`);
          } else {
              toast({ title: "New User Verified", description: "Redirecting to enrollment page." });
              router.push(`/enroll?phone=${normalizedPhoneNumber}`);
          }

      } catch (error: any) {
          console.error("Error verifying OTP:", error);
          let description = "Could not verify OTP.";
          if (error.code === 'auth/invalid-verification-code') {
              description = "The OTP you entered is incorrect. Please try again.";
          }
          toast({ variant: "destructive", title: "Verification Failed", description });
      } finally {
          setIsLoading(false);
      }
  };


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

      <p className="max-w-xl text-center text-muted-foreground mb-10">
        Welcome to CISS Workforce. Please enter your mobile number to get an OTP to view your profile or to register.
      </p>

      <Card className="w-full max-w-md shadow-2xl bg-card">
        <CardHeader>
          <CardTitle className="text-2xl text-center text-card-foreground">
            Employee Access
          </CardTitle>
          <CardDescription className="text-center">
            {showOtpInput ? 'Enter the OTP sent to your number.' : 'Enter your 10-digit mobile number.'}
          </CardDescription>
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
                        {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending OTP...</> : "Send OTP"}
                    </Button>
                </>
            ) : (
                 <>
                    <div className="relative">
                        <Input
                            type="tel"
                            placeholder="Enter 6-digit OTP"
                            value={otp}
                            onChange={(e) => setOtp(e.target.value)}
                            className="text-base tracking-widest text-center"
                            maxLength={6}
                            disabled={isLoading}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp(); }}
                        />
                    </div>
                    <Button onClick={handleVerifyOtp} className="w-full text-base py-3" variant="default" disabled={isLoading}>
                        {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</> : "Verify OTP & Continue"}
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
