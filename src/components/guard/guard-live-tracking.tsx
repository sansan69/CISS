"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  LocateFixed,
  MapPinOff,
  RefreshCw,
} from "lucide-react";

import { useAppAuth } from "@/context/auth-context";
import { useGuardHeartbeat } from "@/lib/hooks/use-guard-heartbeat";

type ActiveSession = {
  isClockedIn: boolean;
  siteId: string | null;
};

const STATUS_REFRESH_MS = 60_000;

export function GuardLiveTracking() {
  const { user } = useAppAuth();
  const [session, setSession] = useState<ActiveSession>({
    isClockedIn: false,
    siteId: null,
  });

  const refreshSession = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/guard/tracking/status", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as ActiveSession;
      setSession({
        isClockedIn: payload.isClockedIn === true,
        siteId: payload.siteId || null,
      });
    } catch {
      // The next foreground or timed refresh will try again.
    }
  }, [user]);

  useEffect(() => {
    void refreshSession();
    const intervalId = setInterval(refreshSession, STATUS_REFRESH_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshSession();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshSession]);

  const tracking = useGuardHeartbeat(
    user,
    session.isClockedIn,
    session.siteId,
  );

  if (!session.isClockedIn) return null;

  const isHealthy = tracking.status === "active";
  const needsAction = [
    "permission_denied",
    "unavailable",
    "error",
  ].includes(tracking.status);
  const Icon =
    tracking.status === "requesting"
      ? LoaderCircle
      : isHealthy
        ? CheckCircle2
        : tracking.status === "permission_denied"
          ? MapPinOff
          : needsAction
            ? AlertTriangle
            : LocateFixed;

  return (
    <section
      aria-live="polite"
      className={`border-b px-4 py-3 ${
        isHealthy
          ? "border-emerald-200 bg-emerald-50"
          : needsAction
            ? "border-red-200 bg-red-50"
            : "border-amber-200 bg-amber-50"
      }`}
    >
      <div className="mx-auto flex max-w-md items-start gap-3">
        <Icon
          aria-hidden="true"
          className={`mt-0.5 h-5 w-5 shrink-0 ${
            tracking.status === "requesting" ? "animate-spin" : ""
          }`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {isHealthy ? "Location sharing on" : "Live location needs attention"}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-foreground/75">
            {tracking.message}
          </p>
          {tracking.accuracy !== null && (
            <p className="mt-1 text-[11px] text-foreground/60">
              GPS accuracy ±{tracking.accuracy} m
              {tracking.distanceFromSite !== null
                ? ` · ${tracking.distanceFromSite} m from site`
                : ""}
            </p>
          )}
          <p className="mt-1 text-[11px] text-foreground/60">
            Keep this app open during duty. Browser tracking pauses when the app
            is fully closed.
          </p>
        </div>
        {needsAction && (
          <button
            type="button"
            onClick={tracking.retry}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-current px-3 text-xs font-semibold"
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
            Retry
          </button>
        )}
      </div>
    </section>
  );
}
