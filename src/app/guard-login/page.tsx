"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, QrCode, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { signInWithCustomToken } from "firebase/auth";
import { requestNotificationPermission, registerFCMToken } from "@/lib/fcm";

export default function GuardLoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);

  const handleLogin = async () => {
    if (!phoneNumber || pin.length < 4) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/guard/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, pin }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Login Failed",
          description: data.error ?? "Could not sign in.",
        });
        return;
      }

      await signInWithCustomToken(auth, data.token as string);
      
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
      
      toast({ title: `Welcome, ${data.employeeName ?? "Guard"}!` });
      router.push("/guard/dashboard");
    } catch (err: unknown) {
      console.error("[guard-login]", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "An unexpected error occurred.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto px-4 py-8">
      {/* Header */}
      <header className="text-center mb-8">
        <Image
          src="/ciss-logo.png"
          alt="CISS Logo"
          width={72}
          height={72}
          className="mx-auto"
          data-ai-hint="company logo"
        />
        <h1
          className="text-2xl font-bold mt-4"
          style={{ color: "#014c85" }}
        >
          Guard Portal
        </h1>
        <p className="text-sm text-muted-foreground mt-1">CISS Workforce</p>
      </header>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-center text-lg">Sign In</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="phone">
            <TabsList className="w-full mb-6">
              <TabsTrigger value="phone" className="flex-1 gap-2">
                <Phone className="h-4 w-4" />
                Phone + PIN
              </TabsTrigger>
              <TabsTrigger value="qr" className="flex-1 gap-2">
                <QrCode className="h-4 w-4" />
                QR Login
              </TabsTrigger>
            </TabsList>

            <TabsContent value="phone" className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="guard-phone">
                  Phone Number
                </label>
                <Input
                  id="guard-phone"
                  type="tel"
                  placeholder="10-digit mobile number"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  maxLength={15}
                  disabled={isLoading}
                  className="h-12 text-base"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="guard-pin">
                  PIN
                </label>
                {/* PIN dots visual indicator */}
                <div className="flex gap-3 justify-center my-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-4 w-4 rounded-full border-2 transition-colors duration-150"
                      style={{
                        borderColor: "#014c85",
                        backgroundColor: pin.length > i ? "#014c85" : "transparent",
                      }}
                    />
                  ))}
                </div>
                <Input
                  id="guard-pin"
                  ref={pinInputRef}
                  type="password"
                  inputMode="numeric"
                  placeholder="Enter your PIN"
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  maxLength={6}
                  disabled={isLoading}
                  className="h-12 text-base text-center tracking-widest"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleLogin();
                  }}
                />
              </div>

              <Button
                className="w-full h-12 text-base font-semibold"
                style={{ backgroundColor: "#014c85" }}
                onClick={handleLogin}
                disabled={isLoading || phoneNumber.length < 10 || pin.length < 4}
              >
                {isLoading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...</>
                ) : (
                  "Sign In"
                )}
              </Button>
              <div className="text-center mt-4">
                <Link href="/guard-forgot-pin" className="text-sm text-muted-foreground hover:text-primary">
                  Forgot your PIN?
                </Link>
              </div>
            </TabsContent>

            <TabsContent value="qr" className="py-8 text-center space-y-4">
              <QrCode className="h-16 w-16 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                QR Login coming soon. Use Phone + PIN to sign in.
              </p>
            </TabsContent>
          </Tabs>

          <div className="mt-6 space-y-2 text-center text-sm">
            <p>
              <Link
                href="/guard-login/setup"
                className="font-medium hover:underline"
                style={{ color: "#014c85" }}
              >
                First time? Set up PIN
              </Link>
            </p>
            <p>
              <Link
                href="/guard-login/reset"
                className="text-muted-foreground hover:underline"
              >
                Forgot PIN?
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
