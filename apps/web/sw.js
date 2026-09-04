const CACHE_NAME = 'rydesync-shell-2026-09-04-2';
const SHELL_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-maskable.svg',
  '/styles.css',
  '/product-ui.css',
  '/catalog-bridge.js',
  '/app.js',
  '/ui-shell.js',
  '/dashboard.js',
  '/dashboard-core.js',
  '/dashboard.css',
  '/library-ui.js',
  '/library-core.js',
  '/map.js',
  '/map-core.js',
  '/sync-core.js',
  '/audio-engine.js',
  '/voice.js',
  '/qr-lite.js'
];
const SHELL_PATHS = new Set(SHELL_ASSETS.map((entry) => new URL(entry, self.location.origin).pathname));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('rydesync-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

function protectedNetworkPath(pathname) {
  return pathname === '/health' || pathname.startsWith('/v1/') || pathname.startsWith('/auth/');
}

async function shellResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    }).catch(() => {});
    return cached;
  }
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (protectedNetworkPath(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }

  if (SHELL_PATHS.has(url.pathname)) {
    event.respondWith(shellResponse(request));
  }
});
