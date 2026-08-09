"use client";

import { useEffect } from 'react';

export default function PwaLoader() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      // Register after the first page has loaded so installation does not
      // compete with critical HTML, CSS, and JavaScript requests.
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('SW registered:', registration.scope);
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                window.dispatchEvent(new CustomEvent('ciss-pwa-update-ready'));
              }
            });
          });
        })
        .catch(err => {
          console.log('SW registration failed:', err);
        });

    };

    if (document.readyState === 'complete') {
      window.setTimeout(register, 0);
    } else {
      window.addEventListener('load', register, { once: true });
    }

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
