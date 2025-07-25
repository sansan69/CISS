
"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogIn, HomeIcon, Loader2 } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';

export default function AdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

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
      await signInWithEmailAndPassword(auth, email, password);
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
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
       <div className="absolute top-4 right-4">
        <Button variant="ghost" asChild size="sm" title="Go to Home">
          <Link href="/">
            <HomeIcon className="mr-2 h-4 w-4" /> Home
          </Link>
        </Button>
      </div>
      <div className="w-full max-w-md space-y-8">
        <header className="text-center">
          <Image
              src="/ciss-logo.png"
              alt="CISS Workforce Logo"
              width={80}
              height={80}
              data-ai-hint="company logo"
              unoptimized={true}
              className="mx-auto"
          />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50 mt-4">CISS Workforce</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">Admin Portal</p>
        </header>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Admin Login</CardTitle>
            <CardDescription>
              Enter your credentials to access the dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="mr-2 h-4 w-4" />
                )}
                Sign In
              </Button>
            </form>
          </CardContent>
        </Card>
        <footer className="text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} CISS Workforce. All rights reserved.
        </footer>
      </div>
    </div>
  );
}
