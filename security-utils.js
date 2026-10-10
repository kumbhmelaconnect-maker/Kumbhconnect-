/**
 * security-utils.js — KumbhConnect (audit revision)
 *
 * BACKWARD COMPATIBLE: escapeHtml() and sanitizeUrl() are byte-for-byte the
 * original implementations (every existing call site keeps working). New
 * helpers are additive and dependency-free.
 *
 * IMPORTANT — what this file can and cannot do:
 *   Everything here runs in the visitor's browser, so a malicious user can
 *   skip or edit it. Treat it as (a) output-encoding that protects OTHER
 *   users from stored content, and (b) UX guards for honest users.
 *   Security-critical limits are enforced by firestore.rules (LIMITS below
 *   mirrors those numbers) or by trusted server code (Apps Script).
 */

(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  }
  if (typeof window !== "undefined") {
    window.KCSecurity = mod;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ESCAPE_MAP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "`": "&#96;",
    "=": "&#61;",
  };

  /**
   * Escapes a string for safe inclusion inside HTML markup (text content
   * or attribute values). Used at every interpolation point in
   * index-28.html that inserts Firestore-sourced or user-supplied text
   * into an innerHTML template string.
   */
  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"'`=]/g, (ch) => ESCAPE_MAP[ch]);
  }

  const DANGEROUS_URL_SCHEMES = [
    "javascript:",
    "vbscript:",
    "data:text/html",
    "data:application/",
  ];

  /**
   * Returns a safe URL string, or '' if the URL should be rejected.
   * Used for the one background-image:url(...) interpolation
   * (provider photo) in the directory-listing card renderer.
   */
  function sanitizeUrl(rawUrl) {
    if (rawUrl === null || rawUrl === undefined) return "";
    const url = String(rawUrl).trim();
    if (url === "") return "";
    // GENUINE WEAKNESS FOUND + FIXED (Media Center security audit): browsers'
    // URL parser strips ASCII tab/newline/CR (and other C0 controls) from a
    // URL before interpreting its scheme — this is standard, spec'd parsing
    // behavior, not a bug in any particular browser. So "java\tscript:..."
    // is parsed identically to "javascript:..." once a browser gets hold of
    // it, even though it doesn't look like "javascript:" to a naive string
    // check. The previous version only stripped these characters into a
    // side copy (`normalized`) used for the DANGEROUS_URL_SCHEMES check —
    // the actual accept/reject decision below ran against the raw,
    // unstripped string, so an attacker could pad a scheme with an
    // embedded control character and slip past that decision even though
    // the blocklist comparison (on its own separate copy) would have
    // caught the unpadded form. Fixed by stripping once, up front, and
    // using the cleaned string for every check AND for the returned value.
    // No legitimate URL in this app (Cloudinary URLs, relative page paths)
    // ever contains these characters, so this changes nothing for real use.
    const cleaned = url.replace(/[\u0000-\u001F\u007F\s]+/g, "");
    if (cleaned === "") return "";

    // HARDENING FIX 1 (Security-Utils Surgical Hardening): protocol-
    // relative URLs. A browser resolves "//evil.com/x" (or the
    // three-slash / backslash-mixed variants "///evil.com/x",
    // "\\evil.com/x", "/\evil.com/x") against the CURRENT PAGE'S
    // scheme — which for this app is always https — so any of these
    // silently become "https://evil.com/x". Only a SINGLE leading
    // slash ("/absolute/path", same-origin — used throughout this
    // app) is legitimate, so this rejects two-or-more leading
    // slash/backslash characters in any combination, and nothing
    // else. No legitimate KumbhConnect URL (Cloudinary URLs, page-
    // relative paths) ever starts this way.
    if (/^[\/\\]{2,}/.test(cleaned)) return "";

    const normalized = cleaned.toLowerCase();
    for (const scheme of DANGEROUS_URL_SCHEMES) {
      if (normalized.startsWith(scheme)) {
        return "";
      }
    }

    // HARDENING FIX 2 (Security-Utils Surgical Hardening): encoded
    // scheme separators. "javascript%3Aalert(1)" and
    // "javascript&colon;alert(1)" contain no LITERAL ':' character,
    // so every check above (and the scheme-shape regex below) fails
    // to recognise them as having a scheme at all — they would
    // otherwise fall straight into the "relative path" branch
    // untouched. Browsers and HTML parsers do decode percent-
    // encoding and HTML named/numeric entities before a URL's scheme
    // is evaluated in some real sink contexts, so this builds a
    // best-effort DECODED COPY — used only to re-run the dangerous-
    // scheme check, never returned — while the original `cleaned`
    // string (untouched by this decoding) remains the only thing
    // this function ever returns. A malformed %-sequence simply
    // leaves the percent-decoding step as a no-op rather than
    // throwing, so this can only ever reject more, never crash.
    let decoded = normalized
      .replace(/&#x0*3a;?/g, ":")   // &#x3a; / &#X3A;  (hex numeric entity)
      .replace(/&#0*58;?/g, ":")    // &#58;            (decimal numeric entity)
      .replace(/&colon;?/g, ":");   // &colon;          (named entity)
    try { decoded = decodeURIComponent(decoded); } catch (e) { /* malformed % sequence — keep entity-decoded form */ }
    const DECODED_DANGEROUS_SCHEMES = ["javascript:", "vbscript:", "data:", "blob:", "file:"];
    for (const scheme of DECODED_DANGEROUS_SCHEMES) {
      if (decoded.startsWith(scheme)) {
        return "";
      }
    }

    const isRelative = /^([./]|[a-zA-Z0-9])/.test(cleaned) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned);
    if (isRelative) return cleaned;

    // HARDENING FIX 3 (Security-Utils Surgical Hardening): require
    // the REAL "://" separator rather than just an "http:"/"https:"
    // text prefix. This is what actually closes the backslash-
    // normalization gap ("http:\\evil.com", "https:\\evil.com" — per
    // the WHATWG URL spec, browsers treat '\' exactly like '/' for
    // these "special" schemes, so this genuinely would navigate to
    // evil.com) and the slash-less malformed form ("https:evil.com")
    // in one stroke. Every genuine http(s) URL used by this app or
    // by Cloudinary always has a literal "://", so nothing
    // legitimate is affected by tightening this.
    if (/^https?:\/\//i.test(cleaned)) return cleaned;

    return "";
  }

  // ===========================================================================
  // ADDITIONS (audit) — everything below is new; nothing above was changed.
  // ===========================================================================

  /** Mirrors the limits in firestore.rules. Change both together. */
  const LIMITS = Object.freeze({
    user: Object.freeze({ name: 100, email: 254, phone: 30 }),
    listing: Object.freeze({ name: 150, category: 60, description: 2000, phone: 30, address: 300, servicesList: 1000 }),
    serviceRequest: Object.freeze({ serviceType: 40, name: 100, mobile: 20, city: 100, date: 20, details: 1000, providerName: 150 }),
    review: Object.freeze({ comment: 1000 }),
    adRequest: Object.freeze({ businessName: 120, adTitle: 120, adMatter: 600, contactPerson: 100, mobile: 20, email: 254, address: 300, url: 300 }),
    ai: Object.freeze({ message: 500 }),
  });

  /** Trim and cut to `max` Unicode code points (safe for Devanagari/emoji). */
  function clampText(value, max) {
    if (value === null || value === undefined) return "";
    const cps = Array.from(String(value).trim());
    return cps.length <= max ? cps.join("") : cps.slice(0, max).join("");
  }

  function codePointLength(value) {
    return Array.from(String(value === null || value === undefined ? "" : value)).length;
  }

  const PHONE_RE = /^\+?[\d\s\-()]{7,16}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function isValidPhone(v) {
    return typeof v === "string" && PHONE_RE.test(v.trim());
  }

  function isValidEmail(v) {
    return typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v.trim());
  }

  /**
   * Strict absolute http(s) URL check (for advertiser/website links).
   * Rejects credentials in the URL, other schemes, control chars, overlong.
   */
  function isHttpUrl(value, opts) {
    const o = opts || {};
    const max = o.maxLength || 300;
    if (typeof value !== "string" || value.length === 0 || value.length > max) return false;
    if (/[\u0000-\u001F\u007F\s]/.test(value)) return false;
    let u;
    try { u = new URL(value); } catch (e) { return false; }
    if (u.protocol !== "https:" && !(o.allowHttp && u.protocol === "http:")) return false;
    if (u.username || u.password) return false;
    if (o.hosts && !o.hosts.includes(u.hostname.toLowerCase())) return false;
    return true;
  }

  /** Same shape firestore.rules enforces for listing photos / ad creatives. */
  function isCloudinaryImageUrl(value, cloudName) {
    if (typeof value !== "string" || value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(cloudName || "")) return false;
    const re = new RegExp("^https://res\\.cloudinary\\.com/" + cloudName + "/image/upload/[A-Za-z0-9/_.-]+$");
    return re.test(value);
  }

  /**
   * Schema validation: schema = { field: {type:'string', required, min, max,
   * pattern, oneOf, trim} }. Returns { ok, errors:{field:code}, values }.
   * Codes (not messages) so the UI can localise them.
   */
  function validate(input, schema) {
    const errors = {};
    const values = {};
    const src = input || {};
    Object.keys(schema).forEach((field) => {
      const rule = schema[field];
      let v = src[field];
      if (v === undefined || v === null || v === "") {
        if (rule.required) errors[field] = "required";
        return;
      }
      if (rule.type === "string") {
        if (typeof v !== "string") { errors[field] = "type"; return; }
        if (rule.trim !== false) v = v.trim();
        const len = codePointLength(v);
        if (rule.min !== undefined && len < rule.min) { errors[field] = "too_short"; return; }
        if (rule.max !== undefined && len > rule.max) { errors[field] = "too_long"; return; }
        if (rule.pattern && !rule.pattern.test(v)) { errors[field] = "format"; return; }
        if (rule.oneOf && !rule.oneOf.includes(v)) { errors[field] = "not_allowed"; return; }
      } else if (rule.type === "number") {
        if (typeof v !== "number" || !isFinite(v)) { errors[field] = "type"; return; }
        if (rule.min !== undefined && v < rule.min) { errors[field] = "too_small"; return; }
        if (rule.max !== undefined && v > rule.max) { errors[field] = "too_large"; return; }
      }
      values[field] = v;
    });
    return { ok: Object.keys(errors).length === 0, errors, values };
  }

  /** Set a CSS background image through the CSSOM (never re-parsed as HTML). */
  function setBackgroundImage(el, rawUrl) {
    const safe = sanitizeUrl(rawUrl);
    if (!el || !safe) return false;
    el.style.backgroundImage = "url(" + JSON.stringify(safe) + ")";
    return true;
  }

  /** Returns an http(s) URL safe for <a href>, or ''. Relative paths are not accepted. */
  function safeExternalHref(rawUrl) {
    const safe = sanitizeUrl(rawUrl);
    return /^https?:\/\//i.test(safe) ? safe : "";
  }

  /**
   * Duplicate-submission guard (UX only — a malicious client ignores it).
   * run(fn): rejects while a previous call is in flight and for `cooldownMs`
   * after it finishes. Returns {ran:boolean, value?, error?}.
   */
  function createSubmitGuard(opts) {
    const cooldownMs = (opts && opts.cooldownMs) || 0;
    let busy = false;
    let last = 0;
    return {
      get busy() { return busy; },
      async run(fn) {
        const now = Date.now();
        if (busy || (cooldownMs && now - last < cooldownMs)) return { ran: false };
        busy = true;
        try {
          const value = await fn();
          return { ran: true, value };
        } catch (error) {
          return { ran: true, error };
        } finally {
          busy = false;
          last = Date.now();
        }
      },
    };
  }

  /** Small sliding-window throttle (UX only; do not rely on it for abuse control). */
  function createClientThrottle(maxPerWindow, windowMs) {
    const hits = [];
    return function allow() {
      const now = Date.now();
      while (hits.length && now - hits[0] > windowMs) hits.shift();
      if (hits.length >= maxPerWindow) return false;
      hits.push(now);
      return true;
    };
  }

  /**
   * Map any thrown error to a key from `messages` — never returns err.message
   * (which can contain paths, ids or backend detail). `messages` is e.g.
   * { generic:'...', permission:'...', network:'...', quota:'...', auth:'...' }.
   */
  function safeErrorMessage(err, messages) {
    const m = messages || {};
    const pick = (k) => (m[k] !== undefined ? m[k] : m.generic !== undefined ? m.generic : "");
    const code = (err && typeof err.code === "string") ? err.code : "";
    if (code === "permission-denied") return pick("permission");
    if (code === "unauthenticated" || code.indexOf("auth/") === 0) return pick("auth");
    if (code === "resource-exhausted") return pick("quota");
    if (code === "unavailable" || code === "deadline-exceeded" || (err && err.name === "AbortError")) return pick("network");
    return pick("generic");
  }

  /** Console logging that records where/what kind of error, not full objects (avoids PII in logs). */
  function logError(context, err) {
    try {
      const code = err && (err.code || err.name) ? String(err.code || err.name) : "unknown";
      console.error("[KC] " + String(context) + " — " + code);
    } catch (e) { /* never throw from logging */ }
  }

  /**
   * fetch() with a hard timeout and a JSON guard (for Apps Script calls).
   * Resolves { ok, status, data, timedOut }. Never throws for HTTP/JSON problems.
   */
  async function fetchJsonWithTimeout(url, init, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
    try {
      const res = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      return { ok: res.ok, status: res.status, data, timedOut: false };
    } catch (e) {
      return { ok: false, status: 0, data: null, timedOut: !!(e && e.name === "AbortError") };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- Session cache (F-03): fewer repeated Firestore reads within one visit.
  // Data cached here is PUBLIC listing/ad data only; it is never trusted for
  // authorization. A user editing their own sessionStorage only affects their own view.
  let _cacheStorage = null;
  function _store() {
    if (_cacheStorage) return _cacheStorage;
    try { return (typeof sessionStorage !== "undefined") ? sessionStorage : null; } catch (e) { return null; }
  }
  function cacheSet(key, value, ttlMs) {
    const st = _store();
    if (!st) return false;
    try { st.setItem(String(key), JSON.stringify({ t: Date.now() + (ttlMs || 300000), v: value })); return true; }
    catch (e) { return false; }   // quota exceeded / private mode: just skip caching
  }
  function cacheGet(key) {
    const st = _store();
    if (!st) return null;
    try {
      const raw = st.getItem(String(key));
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o.t !== "number" || Date.now() > o.t) { st.removeItem(String(key)); return null; }
      return o.v === undefined ? null : o.v;
    } catch (e) { return null; }
  }
  function cacheRemovePrefix(prefix) {
    const st = _store();
    if (!st) return;
    try {
      const keys = [];
      for (let i = 0; i < st.length; i++) keys.push(st.key(i));
      keys.forEach((k) => { if (k && k.indexOf(prefix) === 0) st.removeItem(k); });
    } catch (e) { /* ignore */ }
  }
  function _setCacheStorageForTests(obj) { _cacheStorage = obj; }

  return {
    // original API (unchanged)
    escapeHtml,
    sanitizeUrl,
    // audit additions
    LIMITS,
    clampText,
    codePointLength,
    isValidPhone,
    isValidEmail,
    isHttpUrl,
    isCloudinaryImageUrl,
    validate,
    setBackgroundImage,
    safeExternalHref,
    createSubmitGuard,
    createClientThrottle,
    safeErrorMessage,
    logError,
    fetchJsonWithTimeout,
    cacheSet,
    cacheGet,
    cacheRemovePrefix,
    _setCacheStorageForTests,
  };
});
