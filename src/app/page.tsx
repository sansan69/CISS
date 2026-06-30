"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  DownloadCloud,
  Loader2,
  Phone,
  QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { parseEmployeeIdFromQrText } from "@/lib/qr/employee-qr";
import { QrScannerDialog } from "@/components/qr-scanner-dialog";

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

type PortalContext = {
  isClientPortal: boolean;
  client: null | {
    id: string;
    name: string;
    portalSubdomain: string;
    portalEnabled: boolean;
    portalUrl: string | null;
  };
};


export default function LandingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showFallbackGuidance, setShowFallbackGuidance] = useState(false);
  const [portalContext, setPortalContext] = useState<PortalContext | null>(null);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
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

  useEffect(() => {
    let active = true;
    fetch("/api/public/portal-context")
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        setPortalContext(data);
        if (data?.isClientPortal) {
          router.replace("/admin-login");
        }
      })
      .catch(() => {
        if (active) setPortalContext(null);
      });
    return () => {
      active = false;
    };
  }, [router]);

  if (portalContext?.isClientPortal) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-6">
        <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-5 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">Opening client portal</p>
            <p className="text-sm text-muted-foreground">
              Redirecting to the login page for {portalContext.client?.name ?? "this client"}.
            </p>
          </div>
        </div>
      </div>
    );
  }

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

  const handleQrScan = async (text: string) => {
    const employeeId = parseEmployeeIdFromQrText(text);
    if (!employeeId) {
      toast({
        variant: "destructive",
        title: "Invalid QR",
        description: "Could not parse employee ID from the scanned code.",
      });
      return;
    }

    try {
      const res = await fetch(`/api/public/attendance/employee?employeeId=${encodeURIComponent(employeeId)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data.found) {
        toast({ title: "Employee found", description: "Opening attendance..." });
        router.push(`/attendance?employeeId=${encodeURIComponent(employeeId)}`);
      } else {
        toast({
          variant: "destructive",
          title: "Unknown QR Code",
          description: "This employee was not found. Try entering your phone number.",
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Lookup Failed",
        description: error?.message || "Could not verify employee from QR code.",
      });
    }
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

      const data = (await response.json()) as { found: boolean; id?: string; fullName?: string; employeeId?: string };

      if (data.found && data.employeeId) {
        toast({ title: "Welcome!", description: "Opening attendance..." });
        router.push(`/attendance?employeeId=${encodeURIComponent(data.employeeId)}`);
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
    <main className="relative min-h-[100dvh] overflow-hidden text-white" data-slot="landing-shell" style={{ background: "linear-gradient(160deg, hsl(206 98% 10%) 0%, hsl(206 98% 18%) 60%, hsl(206 98% 14%) 100%)" }}>
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:repeating-linear-gradient(45deg,transparent,transparent_12px,rgba(255,255,255,0.03)_12px,rgba(255,255,255,0.03)_13px)]" />

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-5 py-4 sm:px-6 lg:px-8 lg:py-8">

        {/* Mobile hero */}
        <section className="flex flex-col gap-4 py-5 lg:hidden animate-slide-up">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
              <Image src="/ciss-logo.png" alt="CISS Workforce Logo" width={32} height={32} priority className="h-8 w-8" />
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight font-exo2 text-white">CISS Workforce</p>
              <p className="text-xs text-white/50">Security workforce platform</p>
            </div>
          </div>
          <h1 className="text-3xl font-bold leading-[1.05] tracking-[-0.04em] font-exo2 text-white">
            Fast verification for daily workforce access.
          </h1>
          <p className="text-sm leading-6 text-white/55">
            Mark attendance with your phone number or scan your QR card for instant check-in.
          </p>
        </section>

        {portalContext?.isClientPortal && portalContext.client ? (
          <section className="mt-3 rounded-[1.75rem] border border-white/10 bg-black/20 p-4 backdrop-blur sm:p-5 lg:mt-0">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-gold">
                  Client portal
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-[2rem]">
                  {portalContext.client.name}
                </h2>
                <p className="mt-1 text-sm leading-6 text-white/60">
                  This subdomain is assigned by the admin for the {portalContext.client.name} client dashboard.
                </p>
              </div>
              <Button asChild className="h-11 rounded-xl px-4 bg-brand-gold text-black hover:bg-brand-gold-dark">
                <Link href="/admin-login">Open portal login</Link>
              </Button>
            </div>
          </section>
        ) : null}

        <div className="mt-4 grid items-start gap-6 lg:mt-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-12">
          <section
            data-desktop-section="brand"
            className="hidden flex-col justify-center gap-6 px-1 py-2 lg:flex lg:px-1 lg:py-6 animate-slide-up"
          >
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/8 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-gold backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" />
              Security workforce management platform
            </div>

            <div className="flex items-center gap-3.5">
              <div className="rounded-[1.4rem] border border-white/15 bg-white/8 p-2.5 backdrop-blur">
                <Image src="/ciss-logo.png" alt="CISS Workforce Logo" width={60} height={60} priority className="h-12 w-12" />
              </div>
              <div>
                <p className="text-lg font-bold tracking-tight font-exo2">CISS Workforce</p>
                <p className="text-sm font-medium text-white/60">Security workforce management platform</p>
              </div>
            </div>

            <div className="max-w-2xl space-y-4">
              <h1
                className="text-[clamp(2.9rem,5.2vw,5.1rem)] font-bold leading-[0.96] tracking-[-0.055em] font-exo2"
                style={{ textWrap: "balance" }}
              >
                Fast mobile verification for daily workforce access.
              </h1>
              <p className="max-w-xl text-base leading-7 text-white/60 lg:text-[1.03rem]">
                Use your mobile number to verify attendance, or scan your QR card for instant check-in.
              </p>
            </div>
          </section>

          <div className="flex flex-col gap-4 lg:self-center">
            {/* Main card */}
            <section
              data-mobile-section="verification"
              className="flex flex-col rounded-3xl border border-white/10 bg-black/15 p-5 backdrop-blur shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-6 lg:p-8 animate-slide-up stagger-1"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-gold">
                Guard attendance
              </p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl font-exo2">
                Enter phone or scan QR.
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-white/50 sm:text-base">
                Mark attendance or open the guard portal.
              </p>

              <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.04] p-4 sm:p-5">
                <label
                  htmlFor="employee-phone"
                  className="mb-2.5 block text-sm font-semibold text-white/90"
                >
                  Mobile number
                </label>
                <div className="flex gap-2.5">
                  <div className="relative flex-1">
                    <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="employee-phone"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="Mobile number"
                      value={phoneNumber}
                      onChange={(event) =>
                        setPhoneNumber(event.target.value.replace(/\D/g, "").slice(0, 10))
                      }
                      className="h-14 rounded-2xl bg-white pl-12 text-base text-foreground shadow-none placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-brand-gold/60"
                      maxLength={10}
                      disabled={isLoading}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleContinue();
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setQrDialogOpen(true)}
                    aria-label="Scan QR code"
                    className="h-14 w-14 shrink-0 rounded-2xl border border-white/[0.15] bg-white/[0.04] flex items-center justify-center text-white/50 transition-all duration-200 hover:bg-white/[0.1] hover:text-white hover:border-white/30 active:scale-[0.95]"
                  >
                    <QrCode className="h-6 w-6" />
                  </button>
                </div>

                <Button
                  onClick={handleContinue}
                  className="mt-4 h-14 w-full rounded-2xl text-base font-bold bg-brand-gold text-black shadow-lg shadow-brand-gold/20 hover:bg-brand-gold-dark hover:shadow-xl hover:shadow-brand-gold/25 active:scale-[0.98] transition-all duration-200"
                  disabled={isLoading || normalizedPhone.length < 10}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      Continue
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </section>

            {/* Secondary links */}
            <div className="flex flex-col items-center gap-3 text-sm animate-slide-up stagger-2">
              <Link
                href="/enroll"
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3 font-medium text-white/70 transition-all hover:bg-white/[0.08] hover:text-white active:scale-[0.98]"
              >
                New guard? <span className="text-brand-gold font-semibold">Enroll here</span>
              </Link>
              <Link
                href="/guard-login"
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3 font-medium text-white/70 transition-all hover:bg-white/[0.08] hover:text-white active:scale-[0.98]"
              >
                Guard Portal
              </Link>
            </div>

            {/* Footer */}
            <footer className="mt-4 flex flex-col items-center gap-2 text-center text-xs text-white/30">
              <div className="flex items-center gap-3">
                <Link href="/admin-login" className="rounded-lg px-3 py-1.5 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70">
                  Admin
                </Link>
                <span className="text-white/15">|</span>
                <Link href="/download" className="rounded-lg px-3 py-1.5 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70">
                  Download App
                </Link>
              </div>
              <p className="text-white/20">&copy; {new Date().getFullYear()} CISS Workforce</p>
            </footer>
          </div>
        </div>
      </div>

      <QrScannerDialog
        open={qrDialogOpen}
        onOpenChange={setQrDialogOpen}
        onScan={handleQrScan}
      />

      {showInstallPrompt && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-[env(safe-area-inset-bottom)] animate-slide-up">
          <div className="mx-auto max-w-md rounded-2xl border border-white/[0.12] bg-black/90 p-4 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold">
                <DownloadCloud className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">Install CISS Workforce</p>
                <p className="mt-0.5 text-xs text-white/45">
                  Add the app to your device for faster access.
                </p>
                {showFallbackGuidance && (
                  <p className="mt-1.5 text-xs text-white/35">
                    On iOS, tap Share and choose &ldquo;Add to Home Screen&rdquo;.
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={handleDismissInstall}
                  className="h-9 rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 text-xs font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white/80"
                >
                  Not now
                </button>
                <button
                  onClick={handleInstallClick}
                  className="h-9 rounded-lg bg-brand-gold px-3 text-xs font-semibold text-black transition-all duration-200 hover:bg-brand-gold-dark active:scale-[0.97]"
                >
                  {deferredPromptRef.current ? "Install" : "Got it"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
