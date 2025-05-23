
"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Phone, CalendarDays, QrCode, ChevronRight, Sun } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { mockEmployees } from '@/types/employee';
import Link from 'next/link';
// Removed next/image import as we are using standard <img> for diagnostics

export default function LandingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState('');

  const handleContinue = () => {
    if (!/^\d{10}$/.test(phoneNumber)) {
      toast({
        variant: "destructive",
        title: "Invalid Phone Number",
        description: "Please enter a 10-digit phone number.",
      });
      return;
    }

    const employee = mockEmployees.find(emp => emp.mobileNumber === phoneNumber);

    if (employee) {
      toast({
        title: "Login Successful",
        description: `Welcome back, ${employee.fullName}!`,
      });
      router.push(`/employees/${employee.id}`);
    } else {
      toast({
        title: "Employee Not Found",
        description: "Redirecting to enrollment page.",
      });
      router.push('/employees/enroll');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background text-foreground">
      <div className="absolute top-4 right-4">
        <Button variant="ghost" size="icon" onClick={() => alert("Theme toggle clicked!")}>
          <Sun className="h-6 w-6" />
        </Button>
      </div>

      <header className="text-center mb-8">
        {/* Standard HTML img tag for diagnostics */}
        <img
            src="/ciss-logo.png"
            alt="CISS Workforce Logo - If broken, check public/ciss-logo.png"
            width={80}
            height={80}
            data-ai-hint="company logo"
            className="border-2 border-red-500 text-red-500 text-xs mx-auto" // Added mx-auto for centering
        />
        <h1 className="text-4xl font-bold text-foreground mt-4">CISS Workforce</h1>
        <p className="text-lg text-muted-foreground">Employee Management System</p>
      </header>

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
              maxLength={10}
            />
          </div>
          <Button onClick={handleContinue} className="w-full text-base py-3" variant="default">
            Continue
          </Button>
        </CardContent>
      </Card>

      <div className="mt-8 w-full max-w-md space-y-3">
        <Button variant="accent" className="w-full text-base py-3 justify-center" asChild>
          <Link href="/attendance">
            <CalendarDays className="mr-2 h-5 w-5" />
            Record Attendance
            <QrCode className="ml-2 h-5 w-5" />
          </Link>
        </Button>
        <Button variant="outline" className="w-full text-base py-3 border-accent text-accent hover:bg-accent/10 hover:text-accent" asChild>
          <Link href="/admin-login">
            Admin Dashboard
            <ChevronRight className="ml-2 h-5 w-5" />
          </Link>
        </Button>
      </div>
      
      <footer className="mt-12 text-center text-sm text-muted-foreground">
        &copy; {new Date().getFullYear()} CISS Workforce. All rights reserved.
      </footer>
    </div>
  );
}
