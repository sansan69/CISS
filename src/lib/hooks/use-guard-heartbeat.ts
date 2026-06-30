"use client";

import { useEffect, useRef } from "react";
import type { User } from "firebase/auth";

const HEARTBEAT_INTERVAL_MS = 60_000;
const WATCH_INTERVAL_MS = 30_000;

export function useGuardHeartbeat(
  user: User | null | undefined,
  isClockedIn: boolean,
  siteId: string | null | undefined,
) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastPositionRef = useRef<GeolocationPosition | null>(null);

  useEffect(() => {
    if (!user || !isClockedIn || !siteId) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    const sendHeartbeat = async (position?: GeolocationPosition) => {
      const pos = position ?? lastPositionRef.current;
      if (!pos) return;
      try {
        const token = await user.getIdToken();
        await fetch("/api/guard/tracking/heartbeat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            siteId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            distanceFromSite: null,
            batteryLevel: null,
            speed: pos.coords.speed,
          }),
        });
      } catch {
        // Heartbeat failures are non-critical
      }
    };

    // Start watching position
    if (navigator.geolocation && watchIdRef.current === null) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          lastPositionRef.current = pos;
        },
        () => {
          // Location permission denied or unavailable
        },
        {
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 60_000,
        },
      );
    }

    // Send heartbeat immediately then on interval
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          lastPositionRef.current = pos;
          sendHeartbeat(pos);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 15_000 },
      );
    }

    intervalRef.current = setInterval(() => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            lastPositionRef.current = pos;
            sendHeartbeat(pos);
          },
          () => sendHeartbeat(),
          { enableHighAccuracy: true, timeout: 15_000 },
        );
      } else {
        sendHeartbeat();
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [user, isClockedIn, siteId]);
}
