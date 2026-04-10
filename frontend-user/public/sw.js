/**
 * Minimal SW for PWA installability only.
 * Do NOT intercept fetch: `event.respondWith(fetch(request))` breaks POST bodies
 * (multipart uploads, streams) and surfaces as `TypeError: Failed to fetch` in sw.js.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.delete('rentai-user-v1').then(() => self.clients.claim()),
  );
});
