
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
import { collection, query, where, getDocs, type QuerySnapshot } from 'firebase/firestore';
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
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
    // Moved initialization to a useEffect to ensure 'recaptcha-container' exists.
    const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      'size': 'invisible',
      'callback': (response: any) => {
        // reCAPTCHA solved, allow signInWithPhoneNumber.
      },
      'expired-callback': () => {
        toast({ variant: 'destructive', title: 'reCAPTCHA Expired', description: 'Please try sending the OTP again.' });
        if (window.recaptchaVerifier) {
            window.recaptchaVerifier.render().then(widgetId => {
              window.recaptchaVerifier?.clear();
            });
        }
      }
    });

    window.recaptchaVerifier = verifier;
    return verifier;
  };

  // Setup reCAPTCHA in a useEffect to ensure the container is mounted
  useEffect(() => {
    if (!window.recaptchaVerifier) {
      setupRecaptcha();
    }
  }, []);


  const handleSendOtp = async () => {
    setIsLoading(true);
    const normalizedPhoneNumber = phoneNumber.trim().replace(/\D/g, '');
    if (!/^\d{10}$/.test(normalizedPhoneNumber)) {
      toast({ variant: "destructive", title: "Invalid Phone Number", description: "Please enter a valid 10-digit phone number." });
      setIsLoading(false);
      return;
    }
  
    try {
      const fullPhoneNumber = `+91${normalizedPhoneNumber}`;
      const appVerifier = window.recaptchaVerifier;
      if (!appVerifier) {
        throw new Error("reCAPTCHA Verifier is not initialized.");
      }

      const result = await signInWithPhoneNumber(auth, fullPhoneNumber, appVerifier);
      setConfirmationResult(result);
      window.confirmationResult = result;
      setShowOtpInput(true);
      toast({ title: "OTP Sent", description: "Please check your phone for the verification code." });
    } catch (error: any) {
      console.error("Error sending OTP:", error);
      let description = "Could not send OTP. Please try again later.";
      if (error.code === 'auth/too-many-requests') {
        description = "Too many requests. Please wait a while before trying again.";
      } else if (error.code === 'auth/invalid-phone-number') {
        description = "The phone number provided is not valid.";
      }
      toast({ variant: "destructive", title: "OTP Send Error", description });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const resultToConfirm = confirmationResult || window.confirmationResult;
    if (!resultToConfirm) return;
    setIsLoading(true);

    try {
      const userCredential = await resultToConfirm.confirm(otp);
      const user = userCredential.user;
      toast({ title: "Verification Successful", description: "Checking your registration status..." });

      const normalizedPhoneNumber = user.phoneNumber!.slice(3); // Remove +91
      const employeesRef = collection(db, "employees");
      const q = query(employeesRef, where("phoneNumber", "==", normalizedPhoneNumber));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const employeeDoc = querySnapshot.docs[0];
        router.push(`/profile/${employeeDoc.id}`);
      } else {
        router.push(`/enroll?phone=${normalizedPhoneNumber}`);
      }
    } catch (error: any) {
      console.error("Error verifying OTP:", error);
      let description = "Failed to verify OTP. Please try again.";
      if (error.code === 'auth/invalid-verification-code') {
        description = "The verification code is invalid. Please check and try again.";
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
        Welcome! Please enter your mobile number to log in or register.
      </p>

      <Card className="w-full max-w-md shadow-2xl bg-card">
        <CardHeader>
          <CardTitle className="text-2xl text-center text-card-foreground">
            Employee Verification
          </CardTitle>
          <CardDescription className="text-center">
            {showOtpInput ? 'Enter the OTP sent to your phone.' : 'Enter your 10-digit mobile number.'}
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
                  <KeyRound className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                      type="tel"
                      placeholder="Enter 6-digit OTP"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      className="pl-10 text-base tracking-widest"
                      maxLength={6}
                      disabled={isLoading}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp(); }}
                  />
              </div>
              <Button onClick={handleVerifyOtp} className="w-full text-base py-3" variant="default" disabled={isLoading || otp.length < 6}>
                  {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</> : "Verify & Continue"}
              </Button>
              <Button variant="link" size="sm" onClick={() => setShowOtpInput(false)} disabled={isLoading}>
                Change phone number
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
