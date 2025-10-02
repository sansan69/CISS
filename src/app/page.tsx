
"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Phone, CalendarDays, Loader2, ShieldCheck, DownloadCloud } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import Image from 'next/image';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

export default function LandingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  // PWA install prompt only on landing page
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    if (isStandalone) return; // already installed

    if (localStorage.getItem('pwaInstallDismissed') === '1' || localStorage.getItem('pwaInstalled') === '1') return;

    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallPrompt(true);
    };
    // For iOS Safari and some browsers that do not fire beforeinstallprompt,
    // show a guidance banner after a small delay.
    const fallbackTimer = window.setTimeout(() => {
      if (!('BeforeInstallPromptEvent' in window) && !deferredPrompt) {
        // If still not installed or dismissed, show prompt with guidance.
        setShowInstallPrompt(true);
      }
    }, 2000);
    const handleAppInstalled = () => {
      setShowInstallPrompt(false);
      setDeferredPrompt(null);
      localStorage.setItem('pwaInstalled', '1');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  const handleInstallClick = async () => {
    try {
      if (!deferredPrompt) {
        setShowInstallPrompt(false);
        return;
      }
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (choiceResult.outcome === 'accepted') {
        localStorage.setItem('pwaInstalled', '1');
      } else {
        localStorage.setItem('pwaInstallDismissed', '1');
      }
    } finally {
      setShowInstallPrompt(false);
    }
  };

  const handleDismissInstall = () => {
    setShowInstallPrompt(false);
    localStorage.setItem('pwaInstallDismissed', '1');
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
        toast({ title: "New User", description: "Redirecting to enrollment form." });
        router.push(`/enroll?phone=${normalizedPhoneNumber}`);
      }
    } catch (error: any) {
      console.error("Error during phone number check:", error);
      let message = "Could not verify phone number. Please check your internet connection and try again.";
      if (error.code === 'permission-denied') {
          message = "Database permission denied. Please contact an administrator.";
      }
      toast({ variant: "destructive", title: "Error", description: message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
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

        <Card className="shadow-lg w-full">
          <CardHeader>
            <CardTitle className="text-2xl text-center">
              Employee Verification
            </CardTitle>
            <CardDescription className="text-center">
              Enter your 10-digit mobile number to begin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
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

      {showInstallPrompt && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-md rounded-xl border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 shadow-lg p-3 sm:p-4">
            <div className="flex items-center gap-3">
              <DownloadCloud className="h-5 w-5 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Install CISS Workforce</p>
                <p className="text-xs text-muted-foreground truncate">Add the app to your device for faster access.</p>
                {/* iOS guidance: explain manual Add to Home Screen if needed */}
                {(!('BeforeInstallPromptEvent' in window)) && (
                  <p className="text-[11px] text-muted-foreground mt-1">On iOS: tap the Share icon and choose "Add to Home Screen".</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleDismissInstall}>Not now</Button>
                <Button size="sm" onClick={handleInstallClick}>Install</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
