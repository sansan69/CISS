// A robust, production-ready service worker.
// See: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API

const CACHE_NAME = 'ciss-workforce-cache-v4'; // Increment version to force update
const APP_SHELL_URLS = [
  '/',
  '/guard/dashboard',
  '/guard/attendance',
  '/guard/training',
  '/guard/payslips',
  '/guard/profile',
  '/admin-login',
  '/guard-login',
  '/enroll',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/offline.html',
  // Any other critical static assets for the app shell
];

// Install: Caches the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching App Shell');
        return cache.addAll(APP_SHELL_URLS);
      })
      .then(() => {
        // Force the waiting service worker to become the active service worker.
        return self.skipWaiting();
      })
  );
});

// Activate: Cleans up old caches and takes control
// Any cache matching the pattern ciss-workforce-cache-* (except the current one)
// is deleted, so the version doesn't need to be bumped manually.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName.startsWith('ciss-workforce-cache-') && cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Tell the active service worker to take control of the page immediately.
      return self.clients.claim();
    })
  );
});

// Fetch: Implements a network-first for navigation, stale-while-revalidate for others
self.addEventListener('fetch', event => {
  // We only want to cache GET requests.
  if (event.request.method !== 'GET') {
    return;
  }
  
  // For navigation requests (loading the app pages), use a network-first strategy.
  // This ensures users always get the latest HTML if they are online.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const networkResponse = await fetch(event.request, { signal: controller.signal });
          clearTimeout(timeout);
          return networkResponse;
        } catch (err) {
          // If the network fails, serve an offline fallback page if available.
          const cache = await caches.open(CACHE_NAME);
          const offline = await cache.match('/offline.html');
          if (offline) return offline;
          // Last resort, try cached root.
          const root = await cache.match('/');
          return root || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })()
    );
    return;
  }

  // For _next/static chunks (hashed filenames), use network-first to prevent
  // serving stale JS bundles after deploys.
  if (event.request.url.includes('/_next/static/')) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(event.request);
          return cached || new Response('Offline', { status: 503 });
        }
      })()
    );
    return;
  }

  // For all other requests (CSS, images, etc.), use a stale-while-revalidate strategy.
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(response => {
        // Fetch a fresh version from the network in the background.
        const fetchPromise = fetch(event.request).then(networkResponse => {
          // If we got a valid response, update the cache for next time.
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(err => {
            console.error('Service Worker: Fetch failed.', err);
            // If fetch fails, we don't do anything here, the cached response (if any) is already returned.
        });

        // Return the cached response immediately if it exists, otherwise wait for the network.
        // The user gets content fast, and the app updates in the background.
        return response || fetchPromise;
      });
    })
  );
});
