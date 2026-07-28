"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  Clock3,
  DownloadCloud,
  Fingerprint,
  Globe2,
  Loader2,
  MapPinned,
  Phone,
  QrCode,
  ShieldCheck,
  Smartphone,
  Users,
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

      const data = (await response.json()) as { found: boolean };

      if (data.found) {
        toast({ title: "Welcome!", description: "Opening attendance..." });
        router.push(`/attendance?phoneNumber=${encodeURIComponent(normalizedPhone)}`);
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
      id="main-content"
      className="relative min-h-[100dvh] overflow-hidden bg-background text-foreground"
      data-slot="landing-shell"
    >
      <a
        href="#attendance-access"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to attendance access
      </a>

      <div className="pointer-events-none absolute inset-0 hidden overflow-hidden xl:block" aria-hidden="true">
        <div className="absolute -right-28 -top-36 h-[34rem] w-[34rem] rounded-full bg-primary/[0.09] blur-3xl dark:bg-primary/[0.13]" />
        <div className="absolute -left-48 top-[42%] h-[30rem] w-[30rem] rounded-full bg-accent/[0.10] blur-3xl dark:bg-accent/[0.07]" />
        <div className="absolute inset-0 opacity-[0.22] [background-image:linear-gradient(hsl(var(--border)/0.55)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.55)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_72%)]" />
      </div>

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[90rem] flex-col px-4 sm:px-6 lg:px-10">
        <header
          data-mobile-section="header"
          className="flex min-h-20 items-center justify-between border-b border-border/60 py-4 lg:h-[4.75rem] lg:py-0"
        >
          <Link href="/" className="group flex min-w-0 items-center gap-3.5" aria-label="CISS Workforce home">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-brand-gold/35 bg-brand-blue-darker shadow-brand-sm transition-transform duration-200 group-hover:-translate-y-0.5 lg:h-10 lg:w-10">
              <Image
                src="/ciss-logo.png"
                alt="CISS Workforce Logo"
                width={40}
                height={40}
                priority
                className="h-9 w-9 lg:h-7 lg:w-7"
              />
            </span>
            <span className="min-w-0">
              <span className="block font-exo2 text-[1.15rem] font-bold leading-none tracking-[-0.035em] text-brand-blue-darker dark:text-white lg:text-xl">
                CISS Workforce
              </span>
              <span className="mt-1.5 block text-[9px] font-bold uppercase tracking-[0.18em] text-brand-gold-dark dark:text-brand-gold-light">
                CISS Services Limited
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-2 xl:flex" aria-label="Public navigation">
            <a
              href="https://cissindia.co.in"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              CISS India
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
            <Button asChild variant="outline" size="sm" className="bg-card/70 backdrop-blur">
              <Link href="/admin-login">
                Staff sign in
              </Link>
            </Button>
          </nav>
        </header>

        <div className="grid flex-1 items-start gap-6 py-6 sm:py-8 xl:grid-cols-[minmax(0,1.05fr)_minmax(25rem,0.95fr)] xl:items-center xl:gap-16 xl:py-14">
          <section
            data-desktop-section="brand"
            className="hidden animate-slide-up xl:block xl:pr-4"
            aria-labelledby="landing-title"
          >
            <div className="inline-flex items-center gap-2 border-l-2 border-accent pl-3 text-[11px] font-bold uppercase tracking-[0.22em] text-brand-blue dark:text-accent">
              <BadgeCheck className="h-4 w-4 text-accent" />
              CISS Services · Secure workforce operations
            </div>

            <h1
              id="landing-title"
              className="mt-6 max-w-3xl font-exo2 text-[clamp(2.8rem,7vw,6.4rem)] font-bold leading-[0.92] tracking-[-0.065em] text-brand-blue-darker dark:text-white"
            >
              Duty, verified.
              <span className="mt-2 block text-brand-gold-dark dark:text-brand-gold-light">
                Operations, connected.
              </span>
            </h1>

            <p className="mt-7 max-w-[62ch] text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              The operational workspace for CISS guards, field officers, clients, and administrators.
              Record attendance, coordinate sites, and keep every deployment visible.
            </p>

            <div className="mt-8 grid max-w-2xl grid-cols-3 divide-x divide-border border-y border-border/70 py-4">
              <div className="pr-4">
                <p className="font-exo2 text-xl font-bold tabular-nums text-foreground sm:text-2xl">1985</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Established</p>
              </div>
              <div className="px-4">
                <p className="font-exo2 text-xl font-bold text-foreground sm:text-2xl">Pan-India</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Operations</p>
              </div>
              <div className="pl-4">
                <p className="font-exo2 text-xl font-bold tabular-nums text-foreground sm:text-2xl">24×365</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Operational focus</p>
              </div>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
              <Link
                href="/guard-login"
                className="group inline-flex min-h-11 items-center gap-2 font-semibold text-primary hover:text-brand-blue-dark dark:hover:text-primary/80"
              >
                Open guard portal
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/enroll"
                className="inline-flex min-h-11 items-center text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
              >
                Enrol as a new guard
              </Link>
            </div>
          </section>

          <section
            id="attendance-access"
            data-mobile-section="verification"
            className="relative mx-auto w-full max-w-xl animate-slide-up xl:max-w-none"
            aria-labelledby="attendance-title"
          >
            <div
              className="absolute -inset-3 -z-10 hidden translate-x-3 translate-y-3 rounded-[2rem] border border-primary/15 bg-primary/[0.05] dark:border-white/[0.06] dark:bg-white/[0.025] xl:block"
              aria-hidden="true"
            />
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-brand-md lg:rounded-[1.75rem] lg:bg-card/95 lg:shadow-[0_30px_90px_-42px_hsl(var(--primary)/0.55)] lg:backdrop-blur-xl dark:bg-card/90">
              <div className="relative overflow-hidden border-b border-border/70 bg-brand-blue-darker px-5 py-5 text-white sm:px-7 lg:py-6">
                <div className="absolute inset-0 hidden opacity-40 [background-image:radial-gradient(circle_at_85%_10%,rgba(189,156,85,0.34),transparent_34%),linear-gradient(115deg,transparent_48%,rgba(255,255,255,0.05)_48%,rgba(255,255,255,0.05)_49%,transparent_49%)] lg:block" />
                <div className="relative flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-brand-gold-light">
                      CISS Workforce
                    </p>
                    <h2 id="attendance-title" className="mt-2 font-exo2 text-2xl font-bold tracking-tight lg:text-[2rem]">
                      Your duty starts here
                    </h2>
                    <p className="mt-1 max-w-md text-sm leading-5 text-white/70 lg:leading-6 lg:text-white/62">
                      Mark attendance, enrol as a new guard, and access duty services securely.
                    </p>
                  </div>
                  <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.07] sm:flex">
                    <Fingerprint className="h-6 w-6 text-brand-gold-light" />
                  </div>
                </div>
              </div>

              <div className="p-5 sm:p-7">
                <label htmlFor="employee-phone" className="text-sm font-semibold text-foreground">
                  Mobile number
                </label>
                <p className="mt-1 hidden text-xs leading-5 text-muted-foreground xl:block">
                  Enter the 10-digit number linked to the guard profile.
                </p>

                <div className="mt-3 flex gap-2.5">
                  <div className="relative min-w-0 flex-1">
                    <Phone className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="employee-phone"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="10-digit mobile number"
                      value={phoneNumber}
                      onChange={(event) =>
                        setPhoneNumber(event.target.value.replace(/\D/g, "").slice(0, 10))
                      }
                      className="h-14 rounded-xl bg-background/65 pl-12 pr-4 text-base shadow-inner focus-visible:border-accent focus-visible:ring-accent/25 dark:bg-background/45"
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
                    aria-label="Scan employee QR code"
                    className="group flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-border bg-background/65 text-primary shadow-inner transition-all duration-200 hover:-translate-y-0.5 hover:border-accent hover:text-accent-foreground hover:shadow-brand-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:bg-background/45 dark:hover:text-accent"
                  >
                    <QrCode className="h-6 w-6 transition-transform duration-200 group-hover:scale-105" />
                  </button>
                </div>

                <Button
                  variant="brand"
                  onClick={handleContinue}
                  className="mt-4 h-14 w-full rounded-xl text-sm font-bold shadow-gold sm:text-base"
                  disabled={isLoading || normalizedPhone.length < 10}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Verifying
                    </>
                  ) : (
                    <>
                      Continue to attendance / enrolment
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>

                <p className="mt-3 text-center text-xs leading-5 text-muted-foreground xl:hidden">
                  Not registered? Continue with your mobile number. We&apos;ll open the enrolment form.
                </p>

                <div className="mt-4 flex items-start gap-3 rounded-xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground lg:mt-5">
                  <MapPinned className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="leading-5">
                    Keep location permission on. A live photo is also required.
                  </p>
                </div>
              </div>
            </div>

            <nav className="mt-5 grid grid-cols-2 gap-3 text-sm xl:hidden" aria-label="Guard access">
              <Link
                href="/guard-login"
                data-action="guard-portal"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-primary/35 bg-primary/10 px-3 py-2.5 text-center font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Guard portal
              </Link>
              <Link
                href="/enroll"
                data-action="new-guard-enrollment"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-card px-3 py-2.5 text-center font-semibold leading-5 text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                New guard enrollment
              </Link>
            </nav>

            <section
              data-mobile-section="android-download"
              className="mt-4 border-y border-border/70 py-4 xl:hidden"
              aria-labelledby="android-download-title"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-blue-darker text-brand-gold-light">
                  <Smartphone className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 id="android-download-title" className="text-sm font-bold text-foreground">
                    CISS Workforce for Android
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Version 1.0.16 · Official guard app
                  </p>
                </div>
                <a
                  href="/api/public/download/android"
                  download
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-brand-gold/45 bg-brand-gold/15 px-3 text-xs font-bold text-brand-gold-dark transition-colors hover:bg-brand-gold/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-gold-light"
                >
                  <DownloadCloud className="h-4 w-4" />
                  Download
                </a>
              </div>
            </section>
          </section>
        </div>

        <section
          data-mobile-section="quick-access"
          className="mb-8 hidden overflow-hidden rounded-2xl border border-border/70 bg-card/65 backdrop-blur xl:grid xl:grid-cols-[1.15fr_0.85fr_1fr]"
          aria-label="Platform capabilities"
        >
          <div className="flex gap-4 border-b border-border/70 p-5 lg:border-b-0 lg:border-r">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Clock3 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-exo2 text-sm font-bold">Verified attendance</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Identity, live location, photo, shift, and audit trail.</p>
            </div>
          </div>
          <div className="flex gap-4 border-b border-border/70 p-5 lg:border-b-0 lg:border-r">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-brand-gold-dark dark:text-accent">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-exo2 text-sm font-bold">Field coordination</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Guard rosters, duty sites, revisions, and field reporting.</p>
            </div>
          </div>
          <div className="flex gap-4 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-exo2 text-sm font-bold">Role-controlled visibility</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Purpose-built views for guards, officers, clients, and administrators.</p>
            </div>
          </div>
        </section>

        <footer className="hidden flex-col gap-5 border-t border-border/60 py-6 text-xs text-muted-foreground xl:flex xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="h-4 w-4 text-accent" />
            <p>
              &copy; {new Date().getFullYear()} CISS Services Ltd. Workforce operations.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/download" className="inline-flex items-center gap-1.5 hover:text-foreground">
              <Smartphone className="h-3.5 w-3.5" />
              Download app
            </Link>
            <a href="https://cissindia.co.in/privacy-policy/" target="_blank" rel="noreferrer" className="hover:text-foreground">
              Privacy
            </a>
            <a href="https://cissindia.co.in/terms-conditions/" target="_blank" rel="noreferrer" className="hover:text-foreground">
              Terms
            </a>
            <a href="https://cissindia.co.in" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-primary hover:text-brand-blue-dark dark:hover:text-primary/80">
              <Globe2 className="h-3.5 w-3.5" />
              Official website
            </a>
          </div>
        </footer>

        <footer
          data-mobile-section="staff-access"
          className="border-t border-border/70 pb-[max(env(safe-area-inset-bottom),1rem)] pt-5 xl:hidden"
        >
          <Link
            href="/admin-login"
            className="group flex min-h-14 items-center gap-3 rounded-xl bg-muted/55 px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-primary shadow-sm">
              <Building2 className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-foreground">Staff login</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                Field officers, clients and administrators
              </span>
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </Link>

          <div className="flex items-center justify-between gap-4 py-4 text-[11px] text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} CISS Services Ltd.</p>
            <a
              href="https://cissindia.co.in"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary"
            >
              <Globe2 className="h-3.5 w-3.5" />
              Official website
            </a>
          </div>
        </footer>
      </div>

      <QrScannerDialog
        open={qrDialogOpen}
        onOpenChange={setQrDialogOpen}
        onScan={handleQrScan}
      />

      {showInstallPrompt && (
        <div className="fixed inset-x-0 bottom-0 z-50 hidden px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] animate-slide-up xl:block">
          <div className="mx-auto max-w-md rounded-2xl border border-border/80 bg-card/95 p-4 text-card-foreground shadow-brand-lg backdrop-blur-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-brand-gold-dark dark:text-accent">
                <DownloadCloud className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Install CISS Workforce</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  Add the app to this device for quicker duty access.
                </p>
                {showFallbackGuidance && (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    On iOS, tap Share and choose &ldquo;Add to Home Screen&rdquo;.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={handleDismissInstall}
                  className="h-9 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Not now
                </button>
                <button
                  onClick={handleInstallClick}
                  className="h-9 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-foreground shadow-brand-sm hover:bg-accent/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
