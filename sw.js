// ============================================================
// SERVICE WORKER - UNION14 ORE DIPENDENTI
// ============================================================

const CACHE_NAME = 'union14-ore-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/pocketbase-service.js',
  '/pocketbase.umd.min.js',
  '/logo.png',
  '/manifest.json'
];

// Installazione
self.addEventListener('install', (event) => {
  console.log('📦 Service Worker: installazione...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Cache aperta');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Attivazione
self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker: attivato');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Cache vecchia rimossa:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request)
          .then((networkResponse) => {
            // Non mettere in cache le chiamate API
            if (event.request.url.includes('/api/')) {
              return networkResponse;
            }
            return caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, networkResponse.clone());
                return networkResponse;
              });
          })
          .catch(() => {
            return caches.match('/index.html');
          });
      })
  );
});