// ================================================================
// KumbhConnect — Service Worker v4
// GitHub: kumbhmelaconnect-maker.github.io/kumbhconnect
// Founder: Prasad Arvind Bhalekar
// Updated: June 2026
// ================================================================

const CACHE   = 'kumbhconnect-v4';
const BASE    = '/kumbhconnect';

const STATIC = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/privacy-policy.html',
  BASE + '/terms.html',
  BASE + '/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Khand:wght@400;500;600;700&family=Mukta:wght@400;500;600;700;800&family=Poppins:wght@400;500;600;700&display=swap',
];

// ================================================================
// INSTALL — Pre-cache all static files
// ================================================================
self.addEventListener('install', e => {
  console.log('[KC SW v4] Installing...');
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled(
        STATIC.map(url => c.add(url).catch(err =>
          console.warn('[SW] Skip cache:', url.split('/').pop(), err.message)
        ))
      )
    )
  );
  self.skipWaiting();
});

// ================================================================
// ACTIVATE — Remove old caches
// ================================================================
self.addEventListener('activate', e => {
  console.log('[KC SW v4] Activating...');
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
// FETCH — Cache First for assets, Network First for HTML
// ================================================================
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;

  // Skip — never cache these
  if (
    url.includes('firestore') ||
    url.includes('script.google.com') ||
    url.includes('wa.me') ||
    url.includes('api.whatsapp') ||
    url.includes('maps.app.goo.gl') ||
    url.includes('nominatim.openstreetmap.org') ||
    url.includes('ibb.co')
  ) return;

  // HTML pages — Network First (always get latest), fallback to cache
  if (e.request.headers.get('accept')?.includes('text/html') ||
      url.endsWith('.html') || url.endsWith('/')) {
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
            .then(cached => cached || caches.match(BASE + '/index.html'))
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
      }).catch(() => {
        // Return empty 503 for non-HTML offline failures
        return new Response('', { status: 503, statusText: 'Offline' });
      });
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
      data  : data.url || BASE + '/'
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(wcs => {
      for (const c of wcs) {
        if ('focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(e.notification.data);
    })
  );
});

// ================================================================
// BACKGROUND SYNC (Future: queue offline SOS)
// ================================================================
self.addEventListener('sync', e => {
  if (e.tag === 'kc-sos-queue') {
    console.log('[SW] Background sync: SOS queue');
  }
  if (e.tag === 'kc-analytics') {
    console.log('[SW] Background sync: Analytics');
  }
});

console.log('[KumbhConnect SW v4] Loaded ✓');
