"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  DownloadCloud,
  Loader2,
  Phone,
  ShieldCheck,
  UserCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type QuickLink = {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

type BeforeInstallPromptChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void> | void;
  userChoice: Promise<BeforeInstallPromptChoice>;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

const quickLinks: QuickLink[] = [
  {
    href: "/attendance",
    label: "Record Attendance",
    description: "Fast entry for daily duty attendance.",
    icon: CalendarDays,
  },
  {
    href: "/guard-login",
    label: "Guard Portal",
    description: "Access guard actions and support tools.",
    icon: UserCircle2,
  },
  {
    href: "/admin-login",
    label: "Admin Login",
    description: "Open workforce operations and oversight.",
    icon: ShieldCheck,
  },
];

export default function LandingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showFallbackGuidance, setShowFallbackGuidance] = useState(false);
  const normalizedPhone = phoneNumber.trim().replace(/\D/g, "");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as NavigatorWithStandalone).standalone === true;
    if (isStandalone) return;

    const dismissed = localStorage.getItem("pwaInstallDismissed") === "1";
    const installed = localStorage.getItem("pwaInstalled") === "1";
    if (dismissed || installed) return;

    const handleBeforeInstallPrompt = (event: Event) => {
      const installPromptEvent = event as BeforeInstallPromptEvent;
      installPromptEvent.preventDefault();
      deferredPromptRef.current = installPromptEvent;
      setShowInstallPrompt(true);
    };

    const fallbackTimer = window.setTimeout(() => {
      if (!deferredPromptRef.current) {
        setShowInstallPrompt(true);
        setShowFallbackGuidance(true);
      }
    }, 3000);

    const handleAppInstalled = () => {
      setShowInstallPrompt(false);
      deferredPromptRef.current = null;
      localStorage.setItem("pwaInstalled", "1");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
      window.removeEventListener("appinstalled", handleAppInstalled);
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
      if (choiceResult.outcome === "accepted") {
        localStorage.setItem("pwaInstalled", "1");
      } else {
        localStorage.setItem("pwaInstallDismissed", "1");
      }
    } catch (error) {
      console.error("PWA: Install prompt error:", error);
    } finally {
      setShowInstallPrompt(false);
    }
  };

  const handleDismissInstall = () => {
    setShowInstallPrompt(false);
    localStorage.setItem("pwaInstallDismissed", "1");
  };

  const handleContinue = async () => {
    setIsLoading(true);

    if (!/^\d{10}$/.test(normalizedPhone)) {
      toast({
        variant: "destructive",
        title: "Invalid Phone Number",
        description: "Please enter a valid 10-digit phone number.",
      });
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/employees/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: normalizedPhone }),
      });

      if (response.status === 429) {
        toast({
          variant: "destructive",
          title: "Too Many Requests",
          description: "Please wait a moment and try again.",
        });
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as any).error || "Could not verify phone number.");
      }

      const data = (await response.json()) as { found: boolean; id?: string };

      if (data.found && data.id) {
        toast({ title: "Welcome Back!", description: "Redirecting to Guard Portal." });
        if (typeof window !== "undefined") {
          sessionStorage.setItem("enroll_phone", normalizedPhone);
        }
        router.push("/guard-login");
      } else {
        toast({ title: "New User", description: "Redirecting to enrollment form." });
        if (typeof window !== "undefined") {
          sessionStorage.setItem("enroll_phone", normalizedPhone);
        }
        router.push("/enroll");
      }
    } catch (error: any) {
      console.error("Error during phone number check:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error.message ||
          "Could not verify phone number. Please check your internet connection and try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main
      className="relative min-h-[100dvh] overflow-hidden bg-background text-foreground"
      data-slot="landing-shell"
    >
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-4 py-4 sm:px-6 sm:py-5 lg:justify-center lg:px-8 lg:py-10">
        <section
          data-mobile-section="header"
          className="flex items-center justify-between px-1 py-1 sm:px-0 lg:hidden"
        >
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="rounded-2xl border border-border bg-card/88 p-2 shadow-brand-xs">
              <Image
                src="/ciss-logo.png"
                alt="CISS Workforce Logo"
                width={36}
                height={36}
                priority
                className="h-9 w-9"
              />
            </div>
            <div className="min-w-0">
              <p className="text-[1.02rem] font-bold tracking-tight text-foreground font-exo2 sm:text-[1.15rem]">
                CISS Workforce
              </p>
              <p className="text-xs font-medium text-muted-foreground sm:text-sm">
                Security workforce management platform
              </p>
            </div>
          </div>
        </section>

        <div className="mt-3 grid items-start gap-3 lg:mt-0 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-14">
          <section
            data-desktop-section="brand"
            className="hidden flex-col justify-center gap-4 px-1 py-1 lg:flex lg:px-1 lg:py-6 animate-slide-up"
          >
            <div className="flex items-center gap-3.5">
              <div className="rounded-2xl border border-border bg-card/88 p-2.5 shadow-brand-sm">
                <Image
                  src="/ciss-logo.png"
                  alt="CISS Workforce Logo"
                  width={56}
                  height={56}
                  priority
                  className="h-12 w-12"
                />
              </div>
              <div>
                <p className="text-lg font-bold tracking-tight text-foreground font-exo2">
                  CISS Workforce
                </p>
                <p className="text-sm font-medium text-muted-foreground">
                  Security workforce management platform
                </p>
              </div>
            </div>

            <div className="max-w-sm space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/72">
                Verification-first access
              </p>
              <h1 className="text-[1.95rem] font-semibold leading-tight text-foreground sm:text-[2.2rem] lg:text-[2.45rem] lg:leading-[1.08] font-exo2">
                Fast mobile verification for daily workforce access.
              </h1>
            </div>
          </section>

          <div className="flex flex-col gap-3 sm:gap-4 lg:self-center">
            <section
              data-mobile-section="verification"
              className="flex flex-col rounded-3xl border border-border bg-card/92 p-4 shadow-brand-lg backdrop-blur sm:p-5 lg:p-7 animate-slide-up stagger-1"
            >
              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl font-exo2">
                  Enter mobile number.
                </h2>
                <p className="max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
                  Use your employee mobile number to continue.
                </p>
              </div>

              <div className="mt-4 rounded-2xl border border-border bg-muted/40 p-4 sm:p-5">
                <label
                  htmlFor="employee-phone"
                  className="mb-3 block text-sm font-semibold text-foreground"
                >
                  Mobile number
                </label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="employee-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="Enter your 10-digit number"
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value.replace(/\D/g, "").slice(0, 10))}
                    className="h-14 rounded-2xl bg-background pl-12 text-base shadow-none"
                    maxLength={10}
                    disabled={isLoading}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleContinue();
                    }}
                  />
                </div>

                <Button
                  onClick={handleContinue}
                  className="mt-4 h-14 w-full rounded-2xl text-base font-semibold shadow-brand-md"
                  disabled={isLoading || normalizedPhone.length < 10}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      Verify Employee
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </section>

            <section
              data-mobile-section="quick-access"
              className="rounded-3xl border border-border bg-card/74 p-3 shadow-brand-sm backdrop-blur-sm sm:p-4 animate-slide-up stagger-2"
            >
              <div className="mb-2.5">
                <h3 className="text-base font-semibold text-foreground sm:text-lg font-exo2">Quick access</h3>
              </div>
              <div className="space-y-2">
                {quickLinks.map(({ href, label, description, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="group flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 transition-all duration-200 hover:border-primary/40 hover:bg-muted/50 sm:gap-3.5 sm:px-3.5"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors duration-200 group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-5 text-foreground sm:text-base">{label}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground sm:text-sm">
                        {description}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
                  </Link>
                ))}
              </div>
            </section>

            <footer className="mt-4 text-center text-sm text-muted-foreground lg:mt-5">
              &copy; {new Date().getFullYear()} CISS Workforce. All rights reserved.
            </footer>
          </div>
        </div>
      </div>

      {showInstallPrompt && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-md rounded-2xl border border-border bg-card/96 p-4 shadow-brand-lg backdrop-blur animate-slide-up">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <DownloadCloud className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">Install CISS Workforce</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add the app to your device for faster access.
                </p>
                {showFallbackGuidance && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    On iOS, open Share and choose &ldquo;Add to Home Screen&rdquo;.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleDismissInstall} className="h-10">
                  Not now
                </Button>
                <Button size="sm" onClick={handleInstallClick} className="h-10">
                  {deferredPromptRef.current ? "Install" : "Got it"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
