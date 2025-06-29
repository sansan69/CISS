// A robust, production-ready service worker.
// See: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API

const CACHE_NAME = 'ciss-workforce-cache-v2'; // Increment version to force update
const APP_SHELL_URLS = [
  '/',
  '/admin-login',
  '/enroll',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
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
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
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
      fetch(event.request).catch(() => {
        // If the network fails, serve the cached root page as a fallback.
        return caches.match('/');
      })
    );
    return;
  }

  // For all other requests (JS, CSS, images, etc.), use a stale-while-revalidate strategy.
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
