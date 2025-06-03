
const CACHE_NAME = 'ciss-workforce-cache-v1';
const urlsToCache = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/globals.css', // Assuming this is your main CSS, adjust if needed
  // Add other critical assets like logo, main JS bundles if known and static
  '/ciss-logo.png' 
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.error('Failed to cache resources during install:', err);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle navigation requests for offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return caches.match('/offline.html');
        })
    );
  } else {
    // For other requests (CSS, JS, images), try cache first, then network
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          return response || fetch(event.request).then((fetchResponse) => {
            // Optionally, cache new assets dynamically
            // return caches.open(CACHE_NAME).then((cache) => {
            //   cache.put(event.request, fetchResponse.clone());
            //   return fetchResponse;
            // });
            return fetchResponse;
          });
        })
        .catch(() => {
          // If an image or other asset is not found in cache and network fails,
          // you might want a placeholder, but for now, let it fail.
          if (event.request.destination === 'image') {
            // return caches.match('/placeholder-image.png'); // Example
          }
        })
    );
  }
});
