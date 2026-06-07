// ================================================================
// KumbhConnect — Service Worker v4.1
// GitHub Pages: kumbhmelaconnect-maker.github.io/Kumbhconnect-/
// Founder: Prasad Arvind Bhalekar
// Fix: Relative paths — no hardcoded BASE
// ================================================================

const CACHE = 'kumbhconnect-v4';

// Detect base path automatically from SW location
const SW_URL   = self.location.href;
const BASE_URL = SW_URL.substring(0, SW_URL.lastIndexOf('/') + 1);

const STATIC = [
  BASE_URL,
  BASE_URL + 'index.html',
  BASE_URL + 'privacy-policy.html',
  BASE_URL + 'terms.html',
  BASE_URL + 'manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Khand:wght@400;500;600;700&family=Mukta:wght@400;500;600;700;800&family=Poppins:wght@400;500;600;700&display=swap',
];

// ================================================================
// INSTALL
// ================================================================
self.addEventListener('install', e => {
  console.log('[KC SW v4.1] Installing... BASE:', BASE_URL);
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled(
        STATIC.map(url =>
          c.add(url).catch(err =>
            console.warn('[SW] Skip cache:', url.split('/').pop() || url, err.message)
          )
        )
      )
    )
  );
  self.skipWaiting();
});

// ================================================================
// ACTIVATE
// ================================================================
self.addEventListener('activate', e => {
  console.log('[KC SW v4.1] Activating...');
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    )
  );
  self.clients.claim();
});

// ================================================================
// FETCH — Network First for HTML, Cache First for assets
// ================================================================
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;

  // Skip — never cache these external calls
  if (
    url.includes('firestore') ||
    url.includes('script.google.com') ||
    url.includes('wa.me') ||
    url.includes('api.whatsapp') ||
    url.includes('maps.app.goo.gl') ||
    url.includes('nominatim.openstreetmap.org') ||
    url.includes('ibb.co')
  ) return;

  // HTML pages — Network First, fallback to cache
  if (
    e.request.headers.get('accept')?.includes('text/html') ||
    url.endsWith('.html') ||
    url.endsWith('/')   ||
    url === BASE_URL.slice(0,-1) // handle no-trailing-slash
  ) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request)
            .then(cached => cached ||
              caches.match(BASE_URL + 'index.html') ||
              caches.match(BASE_URL)
            )
        )
    );
    return;
  }

  // Everything else — Cache First, Network Fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() =>
        new Response('', { status: 503, statusText: 'Offline' })
      );
    })
  );
});

// ================================================================
// PUSH NOTIFICATIONS (Future ready)
// ================================================================
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'KumbhConnect', {
      body  : data.body  || 'नाशिक कुंभमेळा अपडेट',
      icon  : 'https://i.ibb.co/Y9pWnQJ/file-000000002a5c7208ab4c69ebcffadb76.png',
      badge : 'https://i.ibb.co/Y9pWnQJ/file-000000002a5c7208ab4c69ebcffadb76.png',
      tag   : 'kc-notif',
      data  : data.url || BASE_URL
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(wcs => {
      for (const c of wcs) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(e.notification.data);
    })
  );
});

// ================================================================
// BACKGROUND SYNC
// ================================================================
self.addEventListener('sync', e => {
  if (e.tag === 'kc-sos-queue')   console.log('[SW] Sync: SOS queue');
  if (e.tag === 'kc-analytics')   console.log('[SW] Sync: Analytics');
});

console.log('[KumbhConnect SW v4.1] Loaded ✓ BASE:', BASE_URL);
