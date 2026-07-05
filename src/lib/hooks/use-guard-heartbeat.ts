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
        (err) => {
          // Location permission denied or unavailable
          if (!sessionStorage.getItem('heartbeat-location-warned')) {
            sessionStorage.setItem('heartbeat-location-warned', 'true');
            console.warn(
              '[heartbeat] Location tracking is unavailable — ' +
              (err.code === err.PERMISSION_DENIED
                ? 'permission denied. Enable location access in browser settings.'
                : `error code ${err.code}: ${err.message}`),
            );
          }
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
        (err) => {
          if (!sessionStorage.getItem('heartbeat-location-warned')) {
            sessionStorage.setItem('heartbeat-location-warned', 'true');
            console.warn(
              '[heartbeat] Could not get current position — ' +
              (err.code === err.PERMISSION_DENIED
                ? 'location permission denied.'
                : `error code ${err.code}: ${err.message}`),
            );
          }
        },
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
          (err) => {
            if (!sessionStorage.getItem('heartbeat-location-warned')) {
              sessionStorage.setItem('heartbeat-location-warned', 'true');
              console.warn(
                '[heartbeat] Interval position lookup failed — ' +
                (err.code === err.PERMISSION_DENIED
                  ? 'location permission denied.'
                  : `error code ${err.code}: ${err.message}`),
              );
            }
            sendHeartbeat();
          },
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
