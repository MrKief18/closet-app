const CACHE = 'closet-v1';
const STATIC = ['/', '/style.css', '/app.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const { pathname } = new URL(e.request.url);
  // Pass API and upload requests straight through — never cache them
  if (['/items', '/outfits', '/upload', '/stats'].some(p => pathname.startsWith(p))) return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
