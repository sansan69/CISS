
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
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, DocumentData } from 'firebase/firestore';
import type { Employee } from '@/types/employee';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
  const [isLoading, setIsLoading] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = () => {
    if (!deferredPrompt) {
      return;
    }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('User accepted the install prompt');
      } else {
        console.log('User dismissed the install prompt');
      }
      setDeferredPrompt(null);
    });
  };

  const handleContinue = async () => {
    let normalizedPhoneNumber = phoneNumber.trim();

    if (normalizedPhoneNumber.startsWith('+91')) {
      normalizedPhoneNumber = normalizedPhoneNumber.substring(3);
    } else if (normalizedPhoneNumber.startsWith('91')) {
      normalizedPhoneNumber = normalizedPhoneNumber.substring(2);
    }
    normalizedPhoneNumber = normalizedPhoneNumber.replace(/\D/g, '');

    if (!/^\d{10}$/.test(normalizedPhoneNumber)) {
      toast({
        variant: "destructive",
        title: "Invalid Phone Number",
        description: "Please enter a valid 10-digit phone number.",
      });
      return;
    }

    setIsLoading(true);
    toast({
      title: "Searching...",
      description: "Looking up employee details.",
    });

    try {
      const employeesRef = collection(db, "employees");
      const q = query(employeesRef, where("phoneNumber", "==", normalizedPhoneNumber));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const employeeDoc = querySnapshot.docs[0];
        const employeeData = employeeDoc.data() as Employee;
        
        toast({
          title: "Employee Found",
          description: `Welcome back, ${employeeData.fullName || employeeData.firstName}! Redirecting...`,
        });
        // Redirect to the new public profile page
        router.push(`/profile/${employeeDoc.id}`);
      } else {
        toast({
          title: "New User Detected",
          description: "This phone number is not registered. Redirecting to enrollment page.",
        });
        router.push(`/enroll?phone=${normalizedPhoneNumber}`);
      }
    } catch (error: any) {
      console.error("Error searching for employee:", error);
      let description = "Could not perform search. Please check your network connection.";
      
      // Improved error detection for Firestore permissions
      if (error.code === 'permission-denied') {
        description = "This search is being blocked by your database security rules. Please update your Firestore rules to allow public 'list' access on the 'employees' collection for this feature to work.";
      }
      
      toast({
        variant: "destructive",
        title: "Search Error",
        description: description,
        duration: 10000, // Increased duration for this important message
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background text-foreground">
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
        Welcome to CISS Workforce, a comprehensive solution for employee management and
        attendance tracking. Our platform streamlines workforce operations with secure authentication,
        real-time attendance monitoring, and centralized employee data management.
      </p>

      <Card className="w-full max-w-md shadow-2xl bg-card">
        <CardHeader>
          <CardTitle className="text-2xl text-center text-card-foreground">Employee Login</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="tel"
              placeholder="Enter your phone number"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="pl-10 text-base"
              maxLength={13} 
              disabled={isLoading}
              onKeyDown={(e) => { if (e.key === 'Enter') handleContinue(); }}
            />
          </div>
          <Button onClick={handleContinue} className="w-full text-base py-3" variant="default" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Searching...
              </>
            ) : (
              "Continue"
            )}
          </Button>
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
