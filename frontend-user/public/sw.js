/* Minimal SW for PWA installability; forwards all requests to network. */
const CACHE = 'rentai-user-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.delete(CACHE).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
