
"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Briefcase, LogIn } from 'lucide-react'; // Added LogIn icon

export default function AdminLoginPage() {
  const router = useRouter();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Add actual login logic here in the future
    // For now, simulate login and redirect
    alert("Simulating admin login...");
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background text-foreground">
      <header className="text-center mb-8">
         <div className="inline-block p-3 bg-gray-700/30 rounded-lg mb-4" data-ai-hint="company logo">
          <Briefcase className="h-12 w-12 text-primary" />
        </div>
        <h1 className="text-4xl font-bold text-foreground">CISS Workforce</h1>
        <p className="text-lg text-muted-foreground">Admin Portal</p>
      </header>

      <Card className="w-full max-w-md shadow-2xl bg-card">
        <CardHeader>
          <CardTitle className="text-2xl text-center text-card-foreground">Admin Login</CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            Enter your credentials to access the admin dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="username">Username / Email</Label>
              <Input id="username" type="text" placeholder="admin@example.com" required className="text-base"/>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" placeholder="••••••••" required className="text-base"/>
            </div>
            <Button type="submit" className="w-full text-base py-3" variant="default">
              <LogIn className="mr-2 h-5 w-5" />
              Login
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
