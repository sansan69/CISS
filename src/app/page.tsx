
"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Phone, CalendarDays, ChevronRight, Loader2, KeyRound, ShieldCheck, DownloadCloud } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import Image from 'next/image';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
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
    if (window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
    }
    const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      'size': 'invisible',
      'callback': (response: any) => {},
      'expired-callback': () => {
        toast({ variant: 'destructive', title: 'reCAPTCHA Expired', description: 'Please try sending the OTP again.' });
      }
    });
    return verifier;
  };

  const handleContinue = async () => {
    setIsLoading(true);
    const normalizedPhoneNumber = phoneNumber.trim().replace(/\D/g, '');

    if (!/^\d{10}$/.test(normalizedPhoneNumber)) {
      toast({ variant: "destructive", title: "Invalid Phone Number", description: "Please enter a valid 10-digit phone number." });
      setIsLoading(false);
      return;
    }

    try {
      const employeesRef = collection(db, "employees");
      const q = query(employeesRef, where("phoneNumber", "==", normalizedPhoneNumber));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const employeeDoc = querySnapshot.docs[0];
        toast({ title: "Welcome Back!", description: "Redirecting to your profile." });
        router.push(`/profile/${employeeDoc.id}`);
      } else {
        await sendOtpForNewUser(normalizedPhoneNumber);
      }
    } catch (error: any) {
      console.error("Error during phone number check:", error);
      toast({ variant: "destructive", title: "Error", description: "Could not verify phone number. Please check your connection." });
      setIsLoading(false);
    }
  };

  const sendOtpForNewUser = async (normalizedPhoneNumber: string) => {
    if (!showOtpInput) {
       toast({ title: "New User Detected", description: "Please verify your number to continue." });
    }
    try {
      const fullPhoneNumber = `+91${normalizedPhoneNumber}`;
      const appVerifier = setupRecaptcha();
      const result = await signInWithPhoneNumber(auth, fullPhoneNumber, appVerifier);
      
      setConfirmationResult(result);
      window.confirmationResult = result;
      setShowOtpInput(true);
      setOtp('');
      toast({ title: "OTP Sent", description: "Please check your phone for the code." });

    } catch (error: any) {
      console.error("Error sending OTP:", error);
      let description = "Could not send OTP. Please try again.";
      if (error.code === 'auth/too-many-requests') {
        description = "Too many requests. Please wait before trying again.";
      }
      toast({ variant: "destructive", title: "OTP Send Error", description });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleResendOtp = () => {
     const normalizedPhoneNumber = phoneNumber.trim().replace(/\D/g, '');
     if (!/^\d{10}$/.test(normalizedPhoneNumber)) return;
     setIsLoading(true);
     sendOtpForNewUser(normalizedPhoneNumber);
  }

  const handleVerifyOtp = async () => {
    const resultToConfirm = confirmationResult || window.confirmationResult;
    if (!resultToConfirm) {
        toast({ variant: 'destructive', title: 'Verification Error', description: 'Session expired. Please try again.' });
        return;
    }
    setIsLoading(true);

    try {
      const userCredential = await resultToConfirm.confirm(otp);
      const user = userCredential.user;
      toast({ title: "Verification Successful", description: "Redirecting to enrollment form..." });

      const normalizedPhoneNumber = user.phoneNumber!.slice(3); // Remove +91
      router.push(`/enroll?phone=${normalizedPhoneNumber}`);
      
    } catch (error: any) {
      console.error("Error verifying OTP:", error);
      let description = "Failed to verify OTP.";
      if (error.code === 'auth/invalid-verification-code') description = "The code is invalid.";
      if (error.code === 'auth/code-expired') description = "The code has expired. Please request a new one.";
      toast({ variant: "destructive", title: "Verification Failed", description });
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
      <div id="recaptcha-container"></div>
      
      <div className="w-full max-w-md mx-auto">
        <header className="text-center mb-8">
          <Image
              src="/ciss-logo.png"
              alt="CISS Workforce Logo"
              width={80}
              height={80}
              data-ai-hint="company logo"
              className="mx-auto"
          />
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 mt-4">CISS Workforce</h1>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400">Employee Management System</p>
        </header>

        {deferredPrompt && (
          <Alert className="mb-8 border-primary/50 bg-primary/10">
            <DownloadCloud className="h-4 w-4" />
            <AlertTitle>Install CISS Workforce</AlertTitle>
            <AlertDescription className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <p>For the best experience, install the app on your device.</p>
              <Button onClick={handleInstallClick} className="w-full sm:w-auto shrink-0">
                  Install App
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Card className="shadow-lg w-full">
          <CardHeader>
            <CardTitle className="text-2xl text-center">
              Employee Verification
            </CardTitle>
            <CardDescription className="text-center">
              {showOtpInput ? 'Enter the OTP sent to your phone.' : 'Enter your 10-digit mobile number.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!showOtpInput ? (
              <div className="space-y-4">
                <div className="relative">
                    <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                        type="tel"
                        placeholder="Enter your 10-digit number"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        className="pl-10 h-12 text-base"
                        maxLength={10}
                        disabled={isLoading}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleContinue(); }}
                    />
                </div>
                <Button onClick={handleContinue} className="w-full h-12 text-base" disabled={isLoading || phoneNumber.length < 10}>
                    {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</> : "Continue"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                        type="tel"
                        placeholder="Enter 6-digit OTP"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        className="pl-10 h-12 text-base tracking-widest text-center"
                        maxLength={6}
                        disabled={isLoading}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp(); }}
                    />
                </div>
                <Button onClick={handleVerifyOtp} className="w-full h-12 text-base" disabled={isLoading || otp.length < 6}>
                    {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</> : "Verify & Continue"}
                </Button>
                <div className="flex justify-between items-center text-sm">
                  <Button variant="link" size="sm" onClick={() => setShowOtpInput(false)} disabled={isLoading}>
                      Change number
                  </Button>
                   <Button variant="link" size="sm" onClick={handleResendOtp} disabled={isLoading}>
                      Resend OTP
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-8 space-y-3">
            <Button variant="outline" className="w-full h-12 text-base" asChild>
                <Link href="/attendance">
                    <CalendarDays className="mr-2 h-5 w-5" />
                    Record Attendance
                </Link>
            </Button>
             <Button variant="outline" className="w-full h-12 text-base" asChild>
              <Link href="/admin-login">
                  <ShieldCheck className="mr-2 h-5 w-5" />
                  Admin Login
              </Link>
            </Button>
        </div>
      
        <footer className="mt-12 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} CISS Workforce. All rights reserved.
        </footer>
      </div>
    </div>
  );
}
