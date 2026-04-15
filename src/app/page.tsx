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
  tone: string;
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
    tone:
      "border-[#bfd6ee] bg-white text-[#0c2842] hover:border-[#2c6ea3] hover:bg-[#f3f8fd]",
  },
  {
    href: "/guard-login",
    label: "Guard Portal",
    description: "Access guard actions and support tools.",
    icon: UserCircle2,
    tone:
      "border-[#cce6dc] bg-white text-[#0c2842] hover:border-[#1f8a68] hover:bg-[#f4fbf8]",
  },
  {
    href: "/admin-login",
    label: "Admin Login",
    description: "Open workforce operations and oversight.",
    icon: ShieldCheck,
    tone:
      "border-[#eadcae] bg-white text-[#0c2842] hover:border-[#bd9c55] hover:bg-[#fffaf0]",
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
      className="relative min-h-screen overflow-hidden bg-[#f5f8fc] text-[#0c2842]"
      data-slot="landing-shell"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-16 top-0 h-72 w-72 rounded-full bg-[#bd9c55]/20 blur-3xl" />
        <div className="absolute right-[-6rem] top-24 h-80 w-80 rounded-full bg-[#2c6ea3]/18 blur-3xl" />
        <div className="absolute bottom-[-5rem] left-1/3 h-72 w-72 rounded-full bg-[#014c85]/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 sm:px-6 sm:py-5 lg:justify-center lg:px-8 lg:py-10">
        <section
          data-mobile-section="header"
          className="flex items-center justify-between px-1 py-1 sm:px-0 lg:hidden"
        >
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="rounded-[1.15rem] border border-[#d8e5f1] bg-white/88 p-2 shadow-[0_16px_30px_-24px_rgba(1,76,133,0.24)]">
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
              <p className="text-[1.02rem] font-bold tracking-tight text-[#0c2842] sm:text-[1.15rem]">
                CISS Workforce
              </p>
              <p className="text-xs font-medium text-[#5c7086] sm:text-sm">
                Security workforce management platform
              </p>
            </div>
          </div>
        </section>

        <div className="mt-3 grid items-start gap-3 lg:mt-0 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-14">
          <section
            data-desktop-section="brand"
            className="hidden flex-col justify-center gap-4 px-1 py-1 lg:flex lg:px-1 lg:py-6"
          >
            <div className="flex items-center gap-3.5">
              <div className="rounded-[1.3rem] border border-[#d8e5f1] bg-white/88 p-2.5 shadow-[0_18px_36px_-26px_rgba(1,76,133,0.28)]">
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
                <p className="text-[1.05rem] font-bold tracking-tight text-[#0c2842]">
                  CISS Workforce
                </p>
                <p className="text-[0.92rem] font-medium text-[#5c7086]">
                  Security workforce management platform
                </p>
              </div>
            </div>

            <div className="max-w-sm space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#014c85]/72">
                Verification-first access
              </p>
              <h1 className="text-[1.95rem] font-semibold leading-tight text-[#0c2842] sm:text-[2.2rem] lg:text-[2.45rem] lg:leading-[1.08]">
                Fast mobile verification for daily workforce access.
              </h1>
            </div>
          </section>

          <div className="flex flex-col gap-3 sm:gap-4 lg:self-center">
            <section
              data-mobile-section="verification"
              className="flex flex-col rounded-[1.55rem] border border-[#d8e3ee] bg-white/92 p-4 shadow-[0_20px_44px_-34px_rgba(1,76,133,0.32)] backdrop-blur sm:p-5 lg:rounded-[1.8rem] lg:p-7"
            >
              <div className="space-y-2">
                <h2 className="text-[1.5rem] font-bold tracking-tight text-[#0c2842] sm:text-[1.9rem]">
                  Enter mobile number.
                </h2>
                <p className="max-w-md text-sm leading-6 text-[#5c7086] sm:text-[0.98rem]">
                  Use employee mobile number to continue.
                </p>
              </div>

              <div className="mt-4 rounded-[1.35rem] border border-[#dbe5ef] bg-[#f9fbfe] p-4 sm:p-5">
                <label
                  htmlFor="employee-phone"
                  className="mb-3 block text-sm font-semibold text-[#4a6178]"
                >
                  Mobile number
                </label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#5c7086]" />
                  <Input
                    id="employee-phone"
                    type="tel"
                    inputMode="numeric"
                    placeholder="Enter your 10-digit number"
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    className="h-14 rounded-2xl border-[#cedcea] bg-white pl-12 text-base shadow-none focus-visible:ring-[#014c85]"
                    maxLength={10}
                    disabled={isLoading}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleContinue();
                    }}
                  />
                </div>

                <Button
                  onClick={handleContinue}
                  className="mt-4 h-14 w-full rounded-2xl bg-[#014c85] text-base font-semibold text-white shadow-[0_18px_38px_-18px_rgba(1,76,133,0.7)] hover:bg-[#0c5d98]"
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
              className="rounded-[1.35rem] border border-[#dbe7f2] bg-white/74 p-3 shadow-[0_14px_32px_-28px_rgba(1,76,133,0.2)] backdrop-blur-sm sm:rounded-[1.5rem] sm:p-4"
            >
              <div className="mb-2.5">
                <h3 className="text-base font-semibold text-[#0c2842] sm:text-lg">Quick access</h3>
              </div>
              <div className="space-y-2">
                {quickLinks.map(({ href, label, description, icon: Icon, tone }) => (
                  <Link
                    key={href}
                    href={href}
                    className={`group flex items-center gap-3 rounded-[1rem] border px-3 py-2.5 transition-all duration-200 sm:gap-3.5 sm:px-3.5 sm:py-3 ${tone}`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.95rem] bg-[#edf5fc] text-[#014c85] transition-colors duration-200 group-hover:bg-[#014c85] group-hover:text-white sm:h-10 sm:w-10">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-5 sm:text-[0.98rem]">{label}</p>
                      <p className="mt-0.5 text-[0.78rem] leading-5 text-[#5c7086] sm:text-[0.82rem]">
                        {description}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#7d91a7] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#014c85]" />
                  </Link>
                ))}
              </div>
            </section>

            <footer className="mt-4 text-center text-sm text-[#6a7d92] lg:mt-5">
              &copy; {new Date().getFullYear()} CISS Workforce. All rights reserved.
            </footer>
          </div>
        </div>
      </div>

      {showInstallPrompt && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-md rounded-2xl border border-[#d8e5f1] bg-white/96 p-4 shadow-[0_24px_60px_-36px_rgba(1,76,133,0.55)] backdrop-blur">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#edf5fc] text-[#014c85]">
                <DownloadCloud className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#0c2842]">Install CISS Workforce</p>
                <p className="mt-1 text-xs text-[#5c7086]">
                  Add the app to your device for faster access.
                </p>
                {showFallbackGuidance && (
                  <p className="mt-2 text-[11px] text-[#6f8297]">
                    On iOS, open Share and choose &ldquo;Add to Home Screen&rdquo;.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleDismissInstall}>
                  Not now
                </Button>
                <Button size="sm" onClick={handleInstallClick} className="bg-[#014c85] hover:bg-[#0c5d98]">
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
