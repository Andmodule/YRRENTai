/**
 * Minimal SW for PWA installability only.
 * Do NOT intercept fetch — it breaks POST/multipart (see frontend-user/public/sw.js).
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
