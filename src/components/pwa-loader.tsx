"use client";

import { useEffect } from 'react';

export default function PwaLoader() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Register ASAP; no need to wait for window load. Works on HTTPS or localhost.
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('SW registered:', registration.scope);
        })
        .catch(err => {
          console.log('SW registration failed:', err);
        });
    }
  }, []);

  return null;
}
