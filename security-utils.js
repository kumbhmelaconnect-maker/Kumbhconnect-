/**
 * security-utils.js
 * KumbhConnect — Phase 1, Item E (XSS)
 *
 * Minimal escaping utility actually wired into the real innerHTML
 * template call-sites in index-28.html that render Firestore/user-
 * controlled data (listing name/address/description, service-request
 * name/mobile/details, review comments, notification title/message).
 *
 * Scope note: this file intentionally only exposes what the actual
 * call-sites need (escapeHtml + sanitizeUrl for one background-image
 * URL interpolation). It does not attempt to convert the app's existing
 * template-literal + innerHTML rendering pattern to a DOM-builder
 * pattern — that would be a much larger, riskier rewrite of working
 * markup, which is explicitly out of scope ("do not change static
 * trusted UI unnecessarily", "make targeted changes").
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

  return {
    escapeHtml,
    sanitizeUrl,
  };
});
