"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogIn, HomeIcon, Loader2, BarChart3, Users, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { auth, ensureAuthPersistence } from '@/lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { requestNotificationPermission, registerFCMToken } from '@/lib/fcm';
import { isLegacyAdminEmail } from '@/lib/auth/admin';
import { isFirebaseConfigured } from '@/lib/firebase';

export default function AdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    if (!isFirebaseConfigured) {
      toast({
        variant: 'destructive',
        title: 'Configuration Error',
        description:
          'Firebase is not configured in this environment. Please verify NEXT_PUBLIC_FIREBASE_* environment variables in Vercel settings.',
      });
      setIsLoading(false);
      return;
    }

    if (!email || !password) {
      toast({
        variant: 'destructive',
        title: 'Login Failed',
        description: 'Email and password are required.',
      });
      setIsLoading(false);
      return;
    }

    try {
      await ensureAuthPersistence();
      const userCredential = await signInWithEmailAndPassword(auth, email, password);

      const idTokenResult = await userCredential.user.getIdTokenResult();
      const role = idTokenResult.claims.role;
      const isAuthorized = idTokenResult.claims.admin === true
        || role === 'admin'
        || role === 'superAdmin'
        || role === 'fieldOfficer'
        || role === 'client'
        || isLegacyAdminEmail(userCredential.user.email);

      if (!isAuthorized) {
        toast({
          variant: 'destructive',
          title: 'Access Denied',
          description: 'You do not have access to this portal.',
        });
        await auth.signOut();
        return;
      }

      if (auth.currentUser) {
        try {
          const token = await requestNotificationPermission();
          if (token) {
            await registerFCMToken(auth.currentUser.uid, token);
          }
        } catch (error) {
          console.warn('Failed to register FCM token:', error);
        }
      }

      toast({
        title: 'Login Successful',
        description: 'Redirecting to your dashboard...',
      });
      router.replace('/dashboard');
    } catch (error: any) {
      let errorMessage = 'An unexpected error occurred. Please try again.';
      if (error?.code) {
        switch (error.code) {
          case 'auth/user-not-found':
          case 'auth/wrong-password':
          case 'auth/invalid-credential':
            errorMessage = 'Invalid email or password. Please try again.';
            break;
          case 'auth/invalid-email':
            errorMessage = 'Invalid email format.';
            break;
          case 'auth/too-many-requests':
            errorMessage = 'Too many login attempts. Please try again later.';
            break;
          default:
            errorMessage = `Login failed: ${error.message || 'Unknown error'}`;
            break;
        }
      }

      toast({
        variant: 'destructive',
        title: 'Login Failed',
        description: errorMessage,
      });
      console.error("Firebase Auth Error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-[100dvh] w-full flex flex-col md:flex-row text-foreground"
      style={{ background: "linear-gradient(160deg, hsl(206 98% 26%) 0%, hsl(206 98% 18%) 60%, hsl(206 98% 10%) 100%)" }}
    >
      {/* Home link */}
      <div className="absolute top-4 right-4 z-10">
        <Button
          variant="ghost"
          asChild
          size="sm"
          className="h-10 px-3 text-white/80 hover:text-white hover:bg-white/10"
        >
          <Link href="/">
            <HomeIcon className="mr-2 h-4 w-4" /> Home
          </Link>
        </Button>
      </div>

      {/* Desktop brand panel */}
      <aside className="hidden md:flex md:flex-1 md:flex-col md:justify-between md:p-12 lg:p-16 text-white relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 top-10 h-96 w-96 rounded-full bg-accent/15 blur-3xl" />
          <div className="absolute -right-20 bottom-10 h-96 w-96 rounded-full bg-white/8 blur-3xl" />
        </div>

        <div className="relative flex items-center gap-3 animate-slide-up">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15 inset-highlight">
            <Image src="/ciss-logo.png" alt="CISS Logo" width={40} height={40} data-ai-hint="company logo" unoptimized />
          </div>
          <div>
            <p className="text-base font-bold font-exo2 tracking-tight">CISS Workforce</p>
            <p className="text-xs text-white/60">Kerala security operations</p>
          </div>
        </div>

        <div className="relative max-w-md animate-slide-up stagger-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent mb-3">Admin Portal</p>
          <h1 className="text-4xl lg:text-5xl font-bold font-exo2 tracking-tight leading-[1.1]">
            Manage the entire workforce at a glance.
          </h1>
          <p className="mt-4 text-base text-white/70 leading-relaxed">
            Attendance, payroll, work orders, and field operations — all in one portal.
          </p>

          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-3 text-sm text-white/80">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 ring-1 ring-white/15">
                <Users className="h-4 w-4 text-accent" />
              </div>
              <span>Real-time guard rosters across every site</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-white/80">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 ring-1 ring-white/15">
                <BarChart3 className="h-4 w-4 text-accent" />
              </div>
              <span>Automated payroll with Kerala slab compliance</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-white/80">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 ring-1 ring-white/15">
                <ShieldCheck className="h-4 w-4 text-accent" />
              </div>
              <span>Role-based access for admins, FOs & clients</span>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-white/50 animate-slide-up stagger-2">
          &copy; {new Date().getFullYear()} CISS Workforce. All rights reserved.
        </p>
      </aside>

      {/* Login panel */}
      <main className="flex-1 flex flex-col md:items-center md:justify-center md:p-10">
        <div className="flex-1 flex flex-col w-full md:flex-none md:max-w-md">

          {/* Brand header — mobile only */}
          <div className="flex flex-col items-center justify-center pt-16 pb-7 px-6 md:hidden animate-slide-up">
            <div className="flex h-20 w-20 items-center justify-center rounded-[22px] mb-5 bg-white/10 ring-1 ring-white/15 inset-highlight">
              <Image
                src="/ciss-logo.png"
                alt="CISS Workforce Logo"
                width={50}
                height={50}
                priority
                data-ai-hint="company logo"
                unoptimized
              />
            </div>
            <h1 className="text-2xl font-bold text-white font-exo2 tracking-tight">
              Admin Portal
            </h1>
            <p className="text-sm mt-1.5 font-medium text-accent">
              CISS Workforce
            </p>
          </div>

          {/* Card */}
          <div className="flex-1 flex flex-col md:flex-none animate-slide-up stagger-2">
            <div
              className="flex-1 md:flex-none rounded-t-[28px] rounded-b-none md:rounded-3xl bg-card text-card-foreground md:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] md:ring-1 md:ring-white/10 px-6 pt-8 pb-8 sm:px-8 md:p-10"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 2rem)" }}
            >
              <div className="text-center md:text-left mb-7">
                <h2 className="text-2xl font-bold font-exo2 tracking-tight">Sign in</h2>
                <p className="text-base text-muted-foreground mt-1">
                  Enter your admin credentials to continue.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-semibold text-foreground">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    placeholder="admin@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                    className="h-12 text-base"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-semibold text-foreground">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    className="h-12 text-base"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full h-12 text-base font-semibold rounded-xl"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...
                    </>
                  ) : (
                    <>
                      <LogIn className="mr-2 h-4 w-4" /> Sign In
                    </>
                  )}
                </Button>
              </form>

              <p className="mt-6 text-center text-xs text-muted-foreground md:hidden">
                &copy; {new Date().getFullYear()} CISS Workforce
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
