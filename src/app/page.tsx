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
  {
    href: "/download",
    label: "Download App",
    description: "Get the Android app for guards and field officers.",
    icon: DownloadCloud,
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
  const [portalContext, setPortalContext] = useState<PortalContext | null>(null);
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
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#f5f8fc] text-foreground" data-slot="landing-shell">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 top-[-8rem] h-[24rem] w-[24rem] rounded-full bg-brand-blue/12 blur-3xl" />
        <div className="absolute right-[-10rem] top-24 h-[34rem] w-[34rem] rounded-full bg-brand-gold/12 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(11,79,130,0.08),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(201,167,91,0.08),transparent_24%)]" />
        <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(to_right,rgba(20,33,51,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(20,33,51,0.06)_1px,transparent_1px)] [background-size:72px_72px]" />
      </div>

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-8">
        <section
          data-mobile-section="header"
          className="flex items-center justify-between gap-4 px-1 py-1 sm:px-0 lg:hidden"
        >
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="rounded-2xl border border-border/80 bg-white/85 p-2 shadow-brand-xs backdrop-blur">
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
          <div className="hidden rounded-full border border-border/70 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-blue shadow-brand-xs sm:inline-flex">
            Live backend
          </div>
        </section>

        {portalContext?.isClientPortal && portalContext.client ? (
          <section className="mt-3 rounded-[1.75rem] border border-brand-blue/10 bg-white/82 p-4 shadow-brand-sm backdrop-blur sm:p-5 lg:mt-0">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-blue">
                  Client portal
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-[2rem]">
                  {portalContext.client.name}
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  This subdomain is assigned by the admin for the {portalContext.client.name} client dashboard.
                </p>
              </div>
              <Button asChild className="h-11 rounded-xl px-4">
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
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-white/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-blue shadow-brand-xs backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" />
              Security workforce management platform
            </div>

            <div className="flex items-center gap-3.5">
              <div className="rounded-[1.4rem] border border-border/80 bg-white/80 p-2.5 shadow-brand-sm backdrop-blur">
                <Image
                  src="/ciss-logo.png"
                  alt="CISS Workforce Logo"
                  width={60}
                  height={60}
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

            <div className="max-w-2xl space-y-4">
              <h1
                className="text-[clamp(2.9rem,5.2vw,5.1rem)] font-bold leading-[0.96] tracking-[-0.055em] text-foreground font-exo2"
                style={{ textWrap: "balance" }}
              >
                Fast mobile verification for daily workforce access.
              </h1>
              <p className="max-w-xl text-base leading-7 text-muted-foreground lg:text-[1.03rem]">
                Use your mobile number to verify attendance, or open the guard and admin portals in one step.
              </p>
            </div>

            <div className="grid max-w-2xl gap-3 sm:grid-cols-3">
              {[
                { label: "Attendance", value: "Fast mobile check-in" },
                { label: "Guard portal", value: "PIN and QR access" },
                { label: "Admin oversight", value: "Client dashboards and reports" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-[1.4rem] border border-border/70 bg-white/76 p-4 shadow-brand-xs backdrop-blur"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-foreground">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="max-w-2xl rounded-[1.75rem] border border-border/70 bg-white/78 p-5 shadow-brand-sm backdrop-blur">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-blue/10 text-brand-blue">
                  <Phone className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Company contact
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Use this channel for portal access, deployment issues, and guard support.
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <div className="rounded-2xl border border-border/70 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Address
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">CISS Services Ltd</p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Green Earth Building, Poriyampadam Link Road, Padivattom, Ernakulam - 24
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <a
                    href="mailto:am.kerala@cissindia.co.in"
                    className="group flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-white px-4 py-3 transition-all duration-200 hover:border-brand-blue/30 hover:bg-brand-blue/5"
                  >
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Support email
                      </p>
                      <p className="mt-1 text-sm font-medium text-foreground">am.kerala@cissindia.co.in</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-blue" />
                  </a>
                  <a
                    href="tel:04842943262"
                    className="group flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-white px-4 py-3 transition-all duration-200 hover:border-brand-blue/30 hover:bg-brand-blue/5"
                  >
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Phone
                      </p>
                      <p className="mt-1 text-sm font-medium text-foreground">0484 2943262</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-blue" />
                  </a>
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-4 lg:self-center">
            <section
              data-mobile-section="verification"
              className="flex flex-col rounded-[2rem] border border-border/70 bg-white/86 p-4 shadow-brand-lg backdrop-blur sm:p-5 lg:p-8 animate-slide-up stagger-1"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="max-w-md space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-blue">
                    Verification first
                  </p>
                  <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl font-exo2">
                    Enter mobile number.
                  </h2>
                  <p className="max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
                    Fast mobile verification for daily workforce access.
                  </p>
                </div>
                <div className="hidden rounded-[1.5rem] border border-brand-blue/10 bg-brand-blue/5 px-4 py-3 text-right sm:block">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-blue">
                    One login
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">Right portal, right role.</p>
                </div>
              </div>

              <div className="mt-5 rounded-[1.5rem] border border-border/80 bg-[#fbfcfe] p-4 sm:p-5">
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
                    onChange={(event) =>
                      setPhoneNumber(event.target.value.replace(/\D/g, "").slice(0, 10))
                    }
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

                <div className="mt-4 rounded-2xl border border-dashed border-brand-blue/15 bg-brand-blue/5 px-4 py-3 text-sm leading-6 text-muted-foreground">
                  We check whether the number exists, then route you to the guard portal or enrollment flow.
                </div>
              </div>
            </section>

            <section
              data-mobile-section="quick-access"
              className="rounded-[2rem] border border-border/70 bg-white/76 p-4 shadow-brand-sm backdrop-blur-sm sm:p-5 animate-slide-up stagger-2"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-foreground sm:text-lg font-exo2">
                    Quick access
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Direct links for common portal actions.
                  </p>
                </div>
                <span className="rounded-full border border-border/70 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  3 links
                </span>
              </div>
              <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-[1.5rem] border border-border/70 bg-white">
                {quickLinks.map(({ href, label, description, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="group flex items-center gap-3 px-4 py-4 transition-colors duration-200 hover:bg-brand-blue/5 sm:gap-3.5"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-blue/10 text-brand-blue transition-colors duration-200 group-hover:bg-brand-blue group-hover:text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-5 text-foreground sm:text-base">
                        {label}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground sm:text-sm">
                        {description}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-blue" />
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
