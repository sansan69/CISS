"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";

export default function GuardForgotPinPage() {
  const router = useRouter();
  const { toast } = useToast();
  
  const [step, setStep] = useState<'phone' | 'otp' | 'new-pin'>('phone');
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSendOtp = async () => {
    if (phoneNumber.length !== 10) {
      toast({ variant: "destructive", title: "Invalid Phone", description: "Enter 10-digit mobile number" });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/guard/auth/send-reset-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Error", description: data.error || "Could not send OTP" });
        return;
      }
      toast({ title: "OTP Sent", description: "Check your phone for the verification code" });
      setStep('otp');
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Something went wrong" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) {
      toast({ variant: "destructive", title: "Invalid OTP", description: "Enter 6-digit code" });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/guard/auth/verify-reset-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Invalid OTP", description: data.error || "OTP verification failed" });
        return;
      }
      setStep('new-pin');
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Something went wrong" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPin = async () => {
    if (newPin.length < 4 || newPin.length > 6) {
      toast({ variant: "destructive", title: "Invalid PIN", description: "PIN must be 4-6 digits" });
      return;
    }
    if (newPin !== confirmPin) {
      toast({ variant: "destructive", title: "PIN Mismatch", description: "PINs do not match" });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/guard/auth/reset-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, otp, newPin }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Error", description: data.error || "Could not reset PIN" });
        return;
      }
      toast({ title: "PIN Reset", description: "Your PIN has been reset. Please login with new PIN." });
      router.push("/guard-login");
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Something went wrong" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-blue-600 to-blue-800">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Reset PIN</CardTitle>
          <CardDescription>
            {step === 'phone' && "Enter your phone number"}
            {step === 'otp' && "Enter the OTP sent to your phone"}
            {step === 'new-pin' && "Set your new PIN"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'phone' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="10-digit mobile number"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  maxLength={10}
                />
              </div>
              <Button onClick={handleSendOtp} disabled={isLoading || phoneNumber.length !== 10} className="w-full">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send OTP
              </Button>
            </>
          )}
          
          {step === 'otp' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="otp">Enter OTP</Label>
                <Input
                  id="otp"
                  type="text"
                  placeholder="6-digit code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  className="text-center tracking-widest text-lg"
                />
              </div>
              <Button onClick={handleVerifyOtp} disabled={isLoading || otp.length !== 6} className="w-full">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify OTP
              </Button>
              <Button variant="link" onClick={() => setStep('phone')} className="w-full">
                Resend OTP
              </Button>
            </>
          )}
          
          {step === 'new-pin' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="newPin">New PIN (4-6 digits)</Label>
                <Input
                  id="newPin"
                  type="password"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPin">Confirm PIN</Label>
                <Input
                  id="confirmPin"
                  type="password"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                />
              </div>
              <Button onClick={handleResetPin} disabled={isLoading || newPin !== confirmPin} className="w-full">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reset PIN
              </Button>
            </>
          )}
          
          <div className="text-center">
            <Link href="/guard-login" className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Back to Login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}