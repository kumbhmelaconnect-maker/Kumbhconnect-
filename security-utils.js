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
    const normalized = url.replace(/[\u0000-\u001F\u007F\s]+/g, "").toLowerCase();
    for (const scheme of DANGEROUS_URL_SCHEMES) {
      if (normalized.startsWith(scheme.replace(/[\u0000-\u001F\u007F\s]+/g, ""))) {
        return "";
      }
    }
    const allowedAbsolute = /^(https?:)/i;
    const isRelative = /^([./]|[a-zA-Z0-9])/.test(url) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
    if (isRelative) return url;
    if (allowedAbsolute.test(url)) return url;
    return "";
  }

  return {
    escapeHtml,
    sanitizeUrl,
  };
});
