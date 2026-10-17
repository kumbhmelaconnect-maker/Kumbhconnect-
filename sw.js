// ================================================================
// KumbhConnect Service Worker v8
// Same-origin only. Network-first for HTML/JS/JSON (with a timeout), cache-first for other same-origin assets.
// SECURITY/OPERATIONS CHANGES vs v7 (see CHANGELOG.md):
//  - a failed JS/JSON/asset request is NEVER answered with index.html (only real page navigations get the app shell)
//  - push / notification-click URLs are validated against trusted origins (same-origin only) before openWindow
//  - runtime cache is bounded (MAX_RUNTIME entries, oldest evicted); obsolete caches are deleted on activate
//  - cross-origin URLs are no longer precached (this worker never serves cross-origin requests anyway)
//  - no fake background-sync stubs: offline SOS queueing is NOT implemented, so nothing here implies it
// ================================================================
const CACHE = 'kumbhconnect-v8';
const BASE = '/Kumbhconnect-';                 // GitHub Pages project path (unchanged from v7)
const MAX_RUNTIME = 80;                        // runtime (non-precache) entries kept
const NET_TIMEOUT_MS = 6000;                   // network-first waits this long before using the cache
const TRUSTED_ORIGINS = [self.location.origin];   // add other origins here ONLY after review
const STATIC = [BASE + '/', BASE + '/index.html', BASE + '/privacy-policy.html', BASE + '/terms.html', BASE + '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(STATIC.map((u) => c.add(u).catch(() => null)))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

function offline503() { return new Response('', { status: 503, statusText: 'Offline' }); }

function fetchWithTimeout(req) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), NET_TIMEOUT_MS);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
  });
}

async function putBounded(req, res) {
  try {
    const c = await caches.open(CACHE);
    await c.put(req, res);
    const keep = new Set(STATIC.map((p) => new URL(p, self.location.origin).href));
    const keys = (await c.keys()).filter((k) => !keep.has(new URL(k.url || k, self.location.origin).href));
    for (let i = 0; i < keys.length - MAX_RUNTIME; i++) await c.delete(keys[i]);   // oldest first
  } catch (_e) { /* cache full / unavailable: never break the page */ }
}

async function networkFirst(req, isNavigation) {
  try {
    const res = await fetchWithTimeout(req);
    if (res && res.status === 200 && res.type !== 'opaque') await putBounded(req, res.clone());
    if (res && res.status >= 500) { const hit = await caches.match(req); if (hit) return hit; }
    return res;                                   // 404 etc. pass through unchanged: never replaced by index.html
  } catch (_e) {
    const hit = await caches.match(req);
    if (hit) return hit;
    if (isNavigation) { const shell = await caches.match(BASE + '/index.html'); if (shell) return shell; }
    return offline503();                          // JS/JSON/other: a clean failure, not HTML
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type === 'basic') await putBounded(req, res.clone());
    return res;
  } catch (_e) { return offline503(); }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let u; try { u = new URL(req.url); } catch (_e) { return; }
  if (u.origin !== self.location.origin) return;  // cross-origin (Firebase, Cloudinary, Apps Script, CDNs...) untouched
  const isNavigation = req.mode === 'navigate' || (req.headers && (req.headers.get('accept') || '').includes('text/html'));
  const isCode = /\.(js|json)$/.test(u.pathname);
  if (isNavigation || isCode || u.pathname.endsWith('.html') || u.pathname.endsWith('/')) { e.respondWith(networkFirst(req, isNavigation)); return; }
  e.respondWith(cacheFirst(req));
});

// ---- push / notification URLs: same-origin http(s) only; anything else falls back to the app root
function safeUrl(raw) {
  try {
    const u = new URL(String(raw), self.location.origin + BASE + '/');
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return TRUSTED_ORIGINS.includes(u.origin) ? u.href : null;
  } catch (_e) { return null; }
}

self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_e) { d = {}; }
  const s = (v, max, dflt) => (typeof v === 'string' && v.length ? v.slice(0, max) : dflt);
  e.waitUntil(self.registration.showNotification(s(d.title, 100, 'KumbhConnect'), {
    body: s(d.body, 300, '\u0928\u093E\u0936\u093F\u0915 \u0915\u0941\u0902\u092D\u092E\u0947\u0933\u093E \u0905\u092A\u0921\u0947\u091F'),
    icon: BASE + '/icon-192.png', badge: BASE + '/icon-192.png', tag: 'kc-notif',
    data: safeUrl(d.url) || (self.location.origin + BASE + '/'),
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = safeUrl(e.notification.data) || (self.location.origin + BASE + '/');   // re-validate: data is not trusted
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((wcs) => {
    for (const c of wcs) if (c.url === target && 'focus' in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});
