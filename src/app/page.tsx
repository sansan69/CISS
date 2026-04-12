
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Phone, CalendarDays, Loader2, ShieldCheck, DownloadCloud, UserCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import Image from 'next/image';

export default function LandingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Use a ref for the deferred prompt to avoid stale-closure issues inside
  // the beforeinstallprompt event handler and the fallback timer callback.
  const deferredPromptRef = useRef<any>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showFallbackGuidance, setShowFallbackGuidance] = useState(false);

  // PWA install prompt — only shown on landing page
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return;

    const dismissed = localStorage.getItem('pwaInstallDismissed') === '1';
    const installed = localStorage.getItem('pwaInstalled') === '1';
    if (dismissed || installed) return;

    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      deferredPromptRef.current = e;
      setShowInstallPrompt(true);
    };

    // For iOS Safari and browsers that never fire beforeinstallprompt,
    // show guidance after 3 s if no native prompt appeared.
    const fallbackTimer = window.setTimeout(() => {
      if (!deferredPromptRef.current) {
        setShowInstallPrompt(true);
        setShowFallbackGuidance(true);
      }
    }, 3000);

    const handleAppInstalled = () => {
      setShowInstallPrompt(false);
      deferredPromptRef.current = null;
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
    const prompt = deferredPromptRef.current;
    if (!prompt) {
      setShowInstallPrompt(false);
      return;
    }
    try {
      prompt.prompt();
      const choiceResult = await prompt.userChoice;
      deferredPromptRef.current = null;
      if (choiceResult.outcome === 'accepted') {
        localStorage.setItem('pwaInstalled', '1');
      } else {
        localStorage.setItem('pwaInstallDismissed', '1');
      }
    } catch (err) {
      console.error('PWA: Install prompt error:', err);
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
    const normalizedPhone = phoneNumber.trim().replace(/\D/g, '');

    if (!/^\d{10}$/.test(normalizedPhone)) {
      toast({
        variant: 'destructive',
        title: 'Invalid Phone Number',
        description: 'Please enter a valid 10-digit phone number.',
      });
      setIsLoading(false);
      return;
    }

    try {
      // Use server-side lookup (rate-limited) instead of a direct Firestore
      // query to prevent phone-number enumeration from the client.
      const res = await fetch('/api/employees/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: normalizedPhone }),
      });

      if (res.status === 429) {
        toast({
          variant: 'destructive',
          title: 'Too Many Requests',
          description: 'Please wait a moment and try again.',
        });
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || 'Could not verify phone number.');
      }

      const data = await res.json() as { found: boolean; id?: string };

      if (data.found && data.id) {
        toast({ title: 'Welcome Back!', description: 'Redirecting to your profile.' });
        router.push(`/profile/${data.id}`);
      } else {
        toast({ title: 'New User', description: 'Redirecting to enrollment form.' });
        // Store phone in sessionStorage so it does not appear in browser history
        // or server access logs as a URL query parameter.
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('enroll_phone', normalizedPhone);
        }
        router.push('/enroll');
      }
    } catch (error: any) {
      console.error('Error during phone number check:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description:
          error.message ||
          'Could not verify phone number. Please check your internet connection and try again.',
      });
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
            priority
            data-ai-hint="company logo"
            className="mx-auto h-auto w-auto"
          />
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-50 mt-4">CISS Workforce</h1>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400">Employee Management System</p>
        </header>

        <Card className="shadow-lg w-full">
          <CardHeader>
            <CardTitle className="text-2xl text-center">Employee Verification</CardTitle>
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
              <Button
                onClick={handleContinue}
                className="w-full h-12 text-base"
                disabled={isLoading || phoneNumber.length < 10}
              >
                {isLoading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
                ) : (
                  'Continue'
                )}
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
            <Link href="/guard-login">
              <UserCircle2 className="mr-2 h-5 w-5" />
              Guard Portal
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
                {showFallbackGuidance && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    On iOS: tap the Share icon and choose &ldquo;Add to Home Screen&rdquo;.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleDismissInstall}>Not now</Button>
                <Button size="sm" onClick={handleInstallClick}>
                  {deferredPromptRef.current ? 'Install' : 'Got it'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
