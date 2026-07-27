"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";

const HEARTBEAT_INTERVAL_MS = 60_000;

export type GuardTrackingStatus =
  | "idle"
  | "requesting"
  | "active"
  | "out_of_zone"
  | "poor_accuracy"
  | "permission_denied"
  | "unavailable"
  | "error";

export type GuardTrackingState = {
  status: GuardTrackingStatus;
  message: string;
  lastUpdatedAt: string | null;
  accuracy: number | null;
  distanceFromSite: number | null;
};

const IDLE_STATE: GuardTrackingState = {
  status: "idle",
  message: "Live location starts after you mark IN.",
  lastUpdatedAt: null,
  accuracy: null,
  distanceFromSite: null,
};

function locationErrorState(error: GeolocationPositionError): GuardTrackingState {
  if (error.code === error.PERMISSION_DENIED) {
    return {
      ...IDLE_STATE,
      status: "permission_denied",
      message:
        "Location permission is off. Open this browser's site settings, allow Location, then tap Retry.",
    };
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return {
      ...IDLE_STATE,
      status: "unavailable",
      message:
        "Your location is unavailable. Turn on device Location/GPS, move to an open area, then retry.",
    };
  }
  return {
    ...IDLE_STATE,
    status: "error",
    message:
      "Location took too long to respond. Check GPS and mobile data, then retry.",
  };
}

export function useGuardHeartbeat(
  user: User | null | undefined,
  isClockedIn: boolean,
  siteId: string | null | undefined,
) {
  const [state, setState] = useState<GuardTrackingState>(IDLE_STATE);
  const [retryKey, setRetryKey] = useState(0);
  const watchIdRef = useRef<number | null>(null);
  const lastPositionRef = useRef<GeolocationPosition | null>(null);

  const retry = useCallback(() => {
    lastPositionRef.current = null;
    setRetryKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!user || !isClockedIn || !siteId) {
      setState(IDLE_STATE);
      return;
    }

    if (!("geolocation" in navigator)) {
      setState({
        ...IDLE_STATE,
        status: "unavailable",
        message:
          "This browser cannot share location. Use an updated Chrome or Safari browser.",
      });
      return;
    }

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    setState((current) => ({
      ...current,
      status: "requesting",
      message: "Getting your live location…",
    }));

    const sendHeartbeat = async (position: GeolocationPosition) => {
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/guard/tracking/heartbeat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            siteId,
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: new Date(position.timestamp).toISOString(),
            batteryLevel: null,
            speed: position.coords.speed,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
              updatedAt?: string;
              distanceFromSite?: number;
              zoneStatus?: "in_zone" | "out_of_zone" | "poor_accuracy";
            }
          | null;
        if (!response.ok) {
          throw new Error(payload?.error || "Live location could not be saved.");
        }
        if (cancelled) return;

        const nextStatus =
          payload?.zoneStatus === "out_of_zone"
            ? "out_of_zone"
            : payload?.zoneStatus === "poor_accuracy"
              ? "poor_accuracy"
              : "active";
        const nextMessage =
          nextStatus === "out_of_zone"
            ? "Live location is sharing, but you appear outside the duty-site zone."
            : nextStatus === "poor_accuracy"
              ? "Location is sharing, but GPS accuracy is weak. Move to an open area."
              : "Live location is sharing with your supervisor.";
        setState({
          status: nextStatus,
          message: nextMessage,
          lastUpdatedAt: payload?.updatedAt ?? new Date().toISOString(),
          accuracy: Math.round(position.coords.accuracy),
          distanceFromSite:
            typeof payload?.distanceFromSite === "number"
              ? payload.distanceFromSite
              : null,
        });
      } catch (error) {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Live location could not be saved. Check mobile data and retry.",
        }));
      }
    };

    const handlePosition = (position: GeolocationPosition) => {
      lastPositionRef.current = position;
      void sendHeartbeat(position);
    };
    const handleError = (error: GeolocationPositionError) => {
      if (!cancelled) setState(locationErrorState(error));
    };
    const requestPosition = () => {
      navigator.geolocation.getCurrentPosition(handlePosition, handleError, {
        enableHighAccuracy: true,
        timeout: 20_000,
        maximumAge: 30_000,
      });
    };

    requestPosition();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        lastPositionRef.current = position;
      },
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 20_000,
        maximumAge: 30_000,
      },
    );
    intervalId = setInterval(() => {
      if (document.visibilityState === "visible") {
        requestPosition();
      }
    }, HEARTBEAT_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") requestPosition();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [user, isClockedIn, siteId, retryKey]);

  return { ...state, retry };
}
