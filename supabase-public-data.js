/* KCSupabase: read-only adapter for the public listing replica (see supabase/migrations).
   - Off by default (feature flag). Firebase stays the source of truth and the fallback.
   - Sends only the PUBLISHABLE key in the `apikey` header. No writes, no Firebase auth changes.
   - Re-validates every row client-side; invalid rows are dropped. */
(function (root) {
  'use strict';
  var TYPES = ['business', 'service', 'guide', 'volunteer'];
  var COLS = 'id,type,name,category,description,address,services_list,photos,lat,lng,' +
             'public_listing_review_aggregates(review_count,avg_rating)';
  var LIMIT = 1000;

  function create(opts) {
    var cfg = opts.config || {};
    var fetchFn = opts.fetch;
    var storage = opts.storage || null;
    var rnd = opts.random || function () { return Math.floor(Math.random() * 100); };
    var cloud = opts.cloudName || 'fzntl3lv';
    var photoRe = new RegExp('^https://res\\.cloudinary\\.com/' + cloud + '/image/upload/[A-Za-z0-9/_.-]+$');
    var state = { status: 'idle', lastError: null };

    function keyLooksPrivate(k) {
      if (typeof k !== 'string') return true;
      if (k.indexOf('sb_secret_') === 0) return true;
      var p = k.split('.');
      if (p.length === 3) {
        try {
          var role = JSON.parse(atob(p[1].replace(/-/g, '+').replace(/_/g, '/'))).role;
          if (role && role !== 'anon') return true;
        } catch (e) { /* not a JWT */ }
      }
      return false;
    }
    function configValid() {
      return /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(cfg.url || '') &&
             typeof cfg.publishableKey === 'string' && cfg.publishableKey.length > 20 &&
             !keyLooksPrivate(cfg.publishableKey);
    }
    function store(op, k, v) {
      try { return op === 'get' ? storage.getItem(k) : storage.setItem(k, v); } catch (e) { return null; }
    }
    function isEnabled() {
      if (!configValid()) return false;
      if (storage) {
        var o = store('get', 'kc_supabase');
        if (o === 'off') return false;
        if (o === 'on') return true;      // tester override; data is public and read-only
      }
      if (cfg.enabled !== true) return false;
      var pct = Number(cfg.rolloutPercent);
      if (!(pct > 0)) return false;
      if (pct >= 100) return true;
      var b = storage ? parseInt(store('get', 'kc_sb_bucket'), 10) : NaN;
      if (!(b >= 0 && b < 100)) { b = rnd(); if (storage) store('set', 'kc_sb_bucket', String(b)); }
      return b < pct;
    }

    function str(v, max) { return typeof v === 'string' && v.length <= max ? v : ''; }
    function mapRow(r) {
      if (!r || typeof r !== 'object') return null;
      if (typeof r.id !== 'string' || !r.id || r.id.length > 100) return null;
      if (TYPES.indexOf(r.type) < 0) return null;
      if (typeof r.name !== 'string' || !r.name || r.name.length > 150) return null;
      var photos = Array.isArray(r.photos) ? r.photos.filter(function (u) {
        return typeof u === 'string' && u.length <= 300 && photoRe.test(u) && u.indexOf('..') < 0;
      }).slice(0, 3) : [];
      var lat = typeof r.lat === 'number' && isFinite(r.lat) && r.lat >= -90 && r.lat <= 90 ? r.lat : null;
      var lng = typeof r.lng === 'number' && isFinite(r.lng) && r.lng >= -180 && r.lng <= 180 ? r.lng : null;
      if (lat === null || lng === null) { lat = null; lng = null; }
      var a = r.public_listing_review_aggregates;
      if (Array.isArray(a)) a = a[0];
      var cnt = a && Number.isInteger(a.review_count) && a.review_count >= 0 ? a.review_count : 0;
      var avg = a ? Number(a.avg_rating) : 0;
      if (!(avg >= 0 && avg <= 5) || cnt === 0) avg = 0;
      return {                                    // same shape the app builds from Firestore docs
        id: r.id, type: r.type, name: r.name,
        category: str(r.category, 60), description: str(r.description, 2000),
        address: str(r.address, 300), servicesList: str(r.services_list, 1000),
        photos: photos, lat: lat, lng: lng,
        phone: '',                                // private contact is intentionally not replicated
        _liveAvgRating: avg, _liveReviewCount: cnt, _source: 'supabase'
      };
    }

    async function query(filters) {
      if (!isEnabled()) throw new Error('supabase disabled');
      if (typeof fetchFn !== 'function') throw new Error('no fetch');
      state.status = 'loading';
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, cfg.timeoutMs || 8000) : null;
      try {
        var qs = new URLSearchParams();
        qs.set('select', COLS);
        qs.set('status', 'eq.approved');
        Object.keys(filters).forEach(function (k) { qs.set(k, 'eq.' + filters[k]); });
        qs.set('order', 'name.asc');
        qs.set('limit', String(LIMIT));
        var res = await fetchFn(cfg.url + '/rest/v1/public_listings?' + qs.toString(), {
          method: 'GET',
          headers: { apikey: cfg.publishableKey, accept: 'application/json' },
          signal: ctrl ? ctrl.signal : undefined
        });
        if (!res.ok) throw new Error('supabase HTTP ' + res.status);
        var body = await res.json();
        if (!Array.isArray(body)) throw new Error('supabase unexpected response');
        if (body.length >= LIMIT) throw new Error('supabase result truncated');
        var rows = body.map(mapRow).filter(Boolean);
        state.status = 'ok'; state.lastError = null;
        return rows;
      } catch (e) {
        state.status = 'error'; state.lastError = e && e.message ? String(e.message) : 'error';
        throw e;
      } finally { if (timer) clearTimeout(timer); }
    }

    function fetchProviders(typeId) {
      if (typeof typeId !== 'string' || !typeId || typeId.length > 60) return Promise.reject(new Error('bad type'));
      var f = (typeId === 'guide' || typeId === 'volunteer') ? { type: typeId } : { category: typeId };
      return query(f);
    }
    async function fetchApprovedForMap() {
      var rows = await query({});
      return rows.filter(function (r) { return r.lat !== null; }).map(function (r) {
        return { id: r.id, d: { name: r.name, address: r.address, phone: '', category: r.category, lat: r.lat, lng: r.lng } };
      });
    }
    /* Generic helper: Supabase first (if enabled), Firebase otherwise or on error/empty. */
    async function withFallback(sbFn, firebaseFn) {
      if (isEnabled()) {
        try {
          var out = await sbFn();
          if (out && out.length) return out;
        } catch (e) { state.status = 'fallback'; }
      }
      return firebaseFn();
    }

    return { isEnabled: isEnabled, fetchProviders: fetchProviders, fetchApprovedForMap: fetchApprovedForMap,
             withFallback: withFallback, getState: function () { return { status: state.status, lastError: state.lastError }; },
             _mapRow: mapRow };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { create: create };
  if (root && root.window === root) {
    var ls = null; try { ls = root.localStorage; } catch (e) { ls = null; }
    root.KCSupabase = create({
      config: root.KC_SUPABASE_CONFIG, fetch: root.fetch ? root.fetch.bind(root) : null, storage: ls,
      cloudName: (root.CLOUDINARY_CONFIG && root.CLOUDINARY_CONFIG.cloudName) || undefined
    });
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
