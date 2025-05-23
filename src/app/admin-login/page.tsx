
"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogIn } from 'lucide-react'; 
import Link from 'next/link'; 
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';

export default function AdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Simulate API call / authentication
    setTimeout(() => {
      if (username === 'admin' && password === 'admin123') {
        toast({
          title: 'Login Successful',
          description: 'Welcome, Super Admin!',
        });
        router.push('/dashboard');
      } else {
        toast({
          variant: 'destructive',
          title: 'Login Failed',
          description: 'Invalid username or password. Please try again.',
        });
      }
      setIsLoading(false);
    }, 1000); // Simulate network delay
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background text-foreground">
      <header className="text-center mb-8">
         <Image
            src="/ciss-logo.png"
            alt="CISS Workforce Logo"
            width={80}
            height={80}
            data-ai-hint="company logo"
            unoptimized={true}
            className="mx-auto"
            style={{ border: '1px solid red', color: 'red', display: password === 'debug' ? 'none' : 'block' }} // Temporary debug style
        />
        <h1 className="text-4xl font-bold text-foreground mt-4">CISS Workforce</h1>
        <p className="text-lg text-muted-foreground">Admin Portal</p>
      </header>

      <Card className="w-full max-w-md shadow-2xl bg-card">
        <CardHeader>
          <CardTitle className="text-2xl text-center text-card-foreground">Admin Login</CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            Enter your credentials to access the admin dashboard.
            Super Admin: admin / admin123
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="username">Username / Email</Label>
              <Input 
                id="username" 
                type="text" 
                placeholder="admin" 
                required 
                className="text-base"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
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
                className="text-base"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <Button type="submit" className="w-full text-base py-3" variant="default" disabled={isLoading}>
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Logging in...
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-5 w-5" />
                  Login
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
       <footer className="mt-12 text-center text-sm text-muted-foreground">
        <Link href="/" className="hover:text-primary">Back to Employee Login</Link><br/>
        &copy; {new Date().getFullYear()} CISS Workforce. All rights reserved.
      </footer>
    </div>
  );
}
