
"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogIn, HomeIcon, Loader2 } from 'lucide-react';
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

    // Quick guard: ensure Firebase frontend config is available in this environment
    // This helps surface clear errors when env vars are misconfigured on Vercel
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
            console.log('FCM token registered');
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
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4"
      style={{ background: "linear-gradient(160deg, #014c85 0%, #012f52 100%)" }}>

      {/* Home link — subtle on dark bg */}
      <div className="absolute top-4 right-4">
        <Button
          variant="ghost"
          asChild
          size="sm"
          className="text-white/70 hover:text-white hover:bg-white/10"
        >
          <Link href="/">
            <HomeIcon className="mr-2 h-4 w-4" /> Home
          </Link>
        </Button>
      </div>

      <div className="w-full max-w-sm animate-slide-up">
        {/* Logo + wordmark above card */}
        <header className="text-center mb-8">
          <Image
            src="/ciss-logo.png"
            alt="CISS Workforce Logo"
            width={200}
            height={202}
            priority
            data-ai-hint="company logo"
            unoptimized={true}
            className="mx-auto h-16 w-auto mb-4 drop-shadow-lg"
          />
          <h1
            className="text-2xl font-bold text-white tracking-tight"
            style={{ fontFamily: "var(--font-exo-display)" }}
          >
            CISS Workforce
          </h1>
          <p className="text-sm text-white/60 mt-1 tracking-wide">Admin Portal</p>
        </header>

        {/* Login card — white with gold top accent */}
        <div
          className="bg-white rounded-2xl shadow-[0_20px_60px_rgb(0,0,0/0.35)] overflow-hidden"
          style={{ borderTop: "4px solid #bd9c55" }}
        >
          <div className="px-6 pt-6 pb-2">
            <h2
              className="text-lg font-semibold text-foreground"
              style={{ fontFamily: "var(--font-exo-display)" }}
            >
              Sign In
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Enter your credentials to continue.
            </p>
          </div>

          <div className="px-6 pb-6 pt-4">
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                  className="h-11 focus-visible:ring-[#014c85] focus-visible:border-[#014c85]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="h-11 focus-visible:ring-[#014c85] focus-visible:border-[#014c85]"
                />
              </div>
              <Button
                type="submit"
                className="w-full h-11 bg-[#014c85] hover:bg-[#013a6b] text-white font-semibold mt-2"
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="mr-2 h-4 w-4" />
                )}
                Sign In
              </Button>
            </form>
          </div>
        </div>

        <footer className="text-center text-xs text-white/40 mt-6">
          &copy; {new Date().getFullYear()} CISS Workforce. All rights reserved.
        </footer>
      </div>
    </div>
  );
}
