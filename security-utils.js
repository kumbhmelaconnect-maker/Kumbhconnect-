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
    // AUDIT FIX SEC-U1: the original decoded copy only recognised the COLON
    // entity forms. A scheme can equally be spelled with entity-encoded
    // LETTERS ("j&#97;vascript:") or entity-encoded whitespace
    // ("java&Tab;script:", "java&#9;script:"). Those strings are not
    // scheme-shaped to the regex below, so they used to be returned as
    // "relative paths"; an HTML parser that later decodes the attribute
    // value turns them into javascript:. Decode numeric entities (with or
    // without ';'), the named whitespace/colon entities, then strip
    // whitespace/control characters again, and re-run the scheme check.
    // The decoded copy is only ever used for rejection, never returned.
    const codePoint = (n) => {
      try { return (n > 0 && n <= 0x10FFFF) ? String.fromCodePoint(n) : ""; } catch (e) { return ""; }
    };
    // AUDIT FIX SEC-01 (round 2): the digit-count caps ({1,8} / {1,10}) let an
    // attacker pad a numeric entity with leading zeros ("&#x00000000000" + "6a;",
    // "&#000000000000106;"). The cap split the entity, the decoder produced
    // nothing, and an HTML parser (which accepts ANY number of leading zeros)
    // still decoded it to "j". Digits are now unbounded (parseInt copes; values
    // above U+10FFFF decode to nothing), and decoding is repeated (max 5 passes,
    // stops when stable) so nested forms like "&amp;#106;avascript:" are caught
    // even if a later sink decodes twice. `normalized` is already lowercase, so
    // "&#X6A;" and uppercase hex digits are covered by the lowercase patterns.
    let decoded = normalized;
    for (let pass = 0; pass < 5; pass++) {
      const before = decoded;
      decoded = decoded
        .replace(/&#x([0-9a-f]+);?/g, (m, h) => codePoint(parseInt(h, 16)))
        .replace(/&#([0-9]+);?/g, (m, d) => codePoint(parseInt(d, 10)))
        .replace(/&(?:tab|newline);/g, "")
        .replace(/&colon;?/g, ":")
        .replace(/&amp;?/g, "&");
      if (decoded === before) break;
    }
    try { decoded = decodeURIComponent(decoded); } catch (e) { /* malformed % sequence — keep entity-decoded form */ }
    decoded = decoded.replace(/[\u0000-\u001F\u007F\s]+/g, "").toLowerCase();
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
    if (typeof v !== "string" || !PHONE_RE.test(v.trim())) return false;
    // Round 3: "-------" or "(((((((" matched the shape-only regex. Require 7-15 real digits (E.164 max 15).
    const digits = v.replace(/\D/g, "").length;
    return digits >= 7 && digits <= 15;
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

  /**
   * Same shape firestore.rules enforces for listing photos / ad creatives.
   * AUDIT FIX SEC-01: the character class [A-Za-z0-9/_.-] admits ".." path
   * segments, which a browser resolves BEFORE requesting the image:
   *   https://res.cloudinary.com/<cloud>/image/upload/../../../<other>/image/upload/x.jpg
   *   -> https://res.cloudinary.com/<other>/image/upload/x.jpg
   * i.e. the cloud-name allow-list could be escaped. A ".." segment is now
   * rejected, and the URL's parsed (normalised) path must still sit under
   * /<cloudName>/image/upload/ on res.cloudinary.com.
   */
  function isCloudinaryImageUrl(value, cloudName) {
    if (typeof value !== "string" || value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(cloudName || "")) return false;
    const re = new RegExp("^https://res\\.cloudinary\\.com/" + cloudName + "/image/upload/[A-Za-z0-9/_.-]+$");
    if (!re.test(value)) return false;
    if (/(^|\/)\.\.(\/|$)/.test(value.slice(8))) return false;   // ".." path segment
    try {
      const u = new URL(value);
      return u.protocol === "https:" && u.hostname === "res.cloudinary.com" && !u.port &&
        !u.username && !u.password && !u.search && !u.hash &&
        u.pathname.indexOf("/" + cloudName + "/image/upload/") === 0;
    } catch (e) { return false; }
  }

  /**
   * Schema validation: schema = { field: {type:'string', required, min, max,
   * pattern, oneOf, trim} }. Returns { ok, errors:{field:code}, values }.
   * Codes (not messages) so the UI can localise them.
   */
  function validate(input, schema, opts) {
    const errors = {};
    const values = {};
    // Round 3: input must be a plain object (not an array / string / number).
    if (input !== undefined && input !== null && (typeof input !== "object" || Array.isArray(input))) {
      return { ok: false, errors: { _input: "type" }, values };
    }
    const src = input || {};
    // Round 3: opts.strict rejects fields that are not in the schema (field injection).
    if (opts && opts.strict) {
      Object.keys(src).forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(schema, k)) errors[k] = "unexpected";
      });
    }
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
        if (rule.integer && Math.floor(v) !== v) { errors[field] = "type"; return; }
        if (rule.min !== undefined && v < rule.min) { errors[field] = "too_small"; return; }
        if (rule.max !== undefined && v > rule.max) { errors[field] = "too_large"; return; }
      } else if (rule.type === "boolean") {
        if (typeof v !== "boolean") { errors[field] = "type"; return; }
      } else {
        // Round 3: an unknown rule type used to let ANY value through unchecked. Fail closed.
        errors[field] = "schema";
        return;
      }
      values[field] = v;
    });
    return { ok: Object.keys(errors).length === 0, errors, values };
  }

  /**
   * Round 3: untrusted text (AI replies, history, anything not typed by this user) for display.
   * Returns a plain string clamped to `max` code points with control, zero-width and bidi-override
   * characters removed (ZWNJ/ZWJ are kept: Devanagari needs them). It is NOT HTML-safe on its own:
   * show it with textContent, or pass it through escapeHtml() before any innerHTML.
   */
  function sanitizeAiText(value, max) {
    if (value === null || value === undefined) return "";
    const t = String(value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
    return clampText(t, max || 2000);
  }

  /** Set a CSS background image through the CSSOM (never re-parsed as HTML). */
  function setBackgroundImage(el, rawUrl) {
    const safe = sanitizeUrl(rawUrl);
    if (!el || !safe) return false;
    el.style.backgroundImage = "url(" + JSON.stringify(safe) + ")";
    return true;
  }

  /**
   * Pass 3 (SEC-U4): URL for a CSS url(...) value that is written as TEXT (inline style="..."
   * built into an innerHTML template). escapeHtml() does not make that safe: it leaves ")" and ";"
   * alone, so "https://a/x);position:fixed;background:url(https://b" would add CSS declarations.
   * Returns the sanitized URL only if it is plain https/relative AND contains none of the
   * characters that can end a url() token or a declaration; otherwise ''.
   * Prefer setBackgroundImage() (CSSOM, no re-parsing). A caller that must build markup should
   * use:  style="background-image:url(&quot;" + escapeHtml(sanitizeCssUrl(u)) + "&quot;)"
   */
  function sanitizeCssUrl(rawUrl) {
    const safe = sanitizeUrl(rawUrl);
    if (!safe) return "";
    if (/[()'"\\;{}<>`,*]|\/\*/.test(safe)) return "";
    return safe;
  }

  /**
   * Returns an http(s) URL safe for <a href>, or ''. Relative paths are not accepted.
   * AUDIT FIX SEC-U2: also rejects (a) URLs carrying credentials
   * ("https://trusted.example@evil.example/", a classic link-spoofing form)
   * and (b) raw  "  <  >  `  \  characters, which browsers percent-encode in
   * genuine URLs and which only matter for breaking out of an HTML attribute.
   * (b) is defence in depth: the caller must STILL escapeHtml() the value
   * (for '&' and "'") when writing it into markup.
   */
  function safeExternalHref(rawUrl) {
    const safe = sanitizeUrl(rawUrl);
    if (!/^https?:\/\//i.test(safe)) return "";
    if (/["<>`\\]/.test(safe)) return "";
    try {
      const u = new URL(safe);
      if (u.username || u.password) return "";
    } catch (e) { return ""; }
    return safe;
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
      // Pass 3: context is caller-supplied; clamp it and drop line breaks (no log injection / payload dumps).
      const ctx = String(context).replace(/[\u0000-\u001F\u007F]+/g, " ").slice(0, 80);
      console.error("[KC] " + ctx + " — " + String(code).slice(0, 60));
    } catch (e) { /* never throw from logging */ }
  }

  // Pass 3 (SEC-U3b): reads the body in chunks and stops as soon as `cap` characters are exceeded, so an
  // oversized/endless body is cancelled instead of being buffered whole by res.text() first.
  // Returns the text, or null when it is too large. Falls back to res.text() where streams are absent.
  async function _readTextCapped(res, cap) {
    if (res.body && typeof res.body.getReader === "function" && typeof TextDecoder !== "undefined") {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += dec.decode(chunk.value, { stream: true });
        if (text.length > cap) { try { await reader.cancel(); } catch (e) { /* ignore */ } return null; }
      }
      text += dec.decode();
      return text.length > cap ? null : text;
    }
    const t = await res.text();
    return t.length > cap ? null : t;
  }

  /**
   * fetch() with a hard timeout and a JSON guard (for Apps Script calls).
   * Resolves { ok, status, data, timedOut } (+ tooLarge / badJson when they apply). Never throws for
   * HTTP/JSON problems. badJson:true = a non-empty body that was not valid JSON (data is null; do not
   * treat `ok` alone as success). Error bodies are never returned or logged here.
   */
  async function fetchJsonWithTimeout(url, init, timeoutMs, maxBytes) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
    const cap = maxBytes || 1000000;   // bounded response size (characters, after decoding)
    try {
      const res = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
      const declared = Number(res.headers && res.headers.get && res.headers.get("content-length"));
      if (declared > cap) return { ok: false, status: res.status, data: null, timedOut: false, tooLarge: true };
      let data = null;
      let badJson = false;
      try {
        // The timer is still running while the body is read, so a stalled body is aborted too (SEC-U3).
        const text = await _readTextCapped(res, cap);
        if (text === null) return { ok: false, status: res.status, data: null, timedOut: false, tooLarge: true };
        if (text) {
          try { data = JSON.parse(text); } catch (e) { data = null; badJson = true; }
        }
      } catch (e) {
        if (e && e.name === "AbortError") return { ok: false, status: 0, data: null, timedOut: true };
        data = null;
      }
      const out = { ok: res.ok, status: res.status, data, timedOut: false };
      if (badJson) out.badJson = true;
      return out;
    } catch (e) {
      return { ok: false, status: 0, data: null, timedOut: !!(e && e.name === "AbortError") };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- Session cache (F-03): fewer repeated Firestore reads within one visit.
  // Data cached here is PUBLIC listing/ad data only; it is never trusted for
  // authorization. A user editing their own sessionStorage only affects their own view.
  // NEVER cache ID tokens, user profiles, phone numbers or private review data here (sessionStorage is
  // readable by any script on the origin). cacheGet() returns whatever JSON was stored: the CALLER must
  // validate its shape (e.g. with validate()/escapeHtml) before rendering it.
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
      let o = null;
      try { o = JSON.parse(raw); } catch (e) { o = null; }
      // Pass 3: a corrupt (unparseable / wrong-shape) or expired entry is deleted, not left to be re-read forever.
      if (!o || typeof o !== "object" || typeof o.t !== "number" || Date.now() > o.t) { st.removeItem(String(key)); return null; }
      return o.v === undefined ? null : o.v;
    } catch (e) { return null; }   // storage itself failing: behave as a cache miss
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
    sanitizeAiText,
    setBackgroundImage,
    sanitizeCssUrl,
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
