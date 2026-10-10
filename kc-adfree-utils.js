/* =============================================================================
   KumbhConnect — Administration Free Advertisement: pure helpers
   -----------------------------------------------------------------------------
   No DOM, no Firebase, no network. Loaded by index.html (browser global
   `KCAdFree`) and by the Node test-suite (module.exports).

   CLIENT vs ENFORCED: everything here is a UX / defence-in-depth layer.
   The real controls are firestore.rules (admin-only writes, single-slot
   document, request.time window on the public read) and the Cloudinary
   upload-preset restrictions (console setting, not verifiable from source).
   ============================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KCAdFree = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IST_OFFSET_MS = 330 * 60 * 1000;           // Asia/Kolkata = UTC+05:30, no DST
  var MAX_DURATION_MS = 366 * 24 * 3600 * 1000;  // mirrors firestore.rules

  function configuredMaxBytes() {
    var g = (typeof window !== 'undefined') ? window.KC_ADFREE_MAX_BYTES : undefined;
    return (typeof g === 'number' && g > 0 && g <= 10 * 1024 * 1024) ? g : 2 * 1024 * 1024;
  }

  var LIMITS = {
    get maxImageBytes() { return configuredMaxBytes(); },
    maxTitle: 120, maxDescription: 300, maxAlt: 150, maxUrl: 300
  };

  /* ---------- image validation ---------- */
  function detectImageType(bytes) {
    if (!bytes || bytes.length < 8) return null;
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
        bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return 'png';
    return null;
  }

  function extensionOf(name) {
    if (typeof name !== 'string') return '';
    var m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
    return m ? m[1].toLowerCase() : '';
  }

  /* meta: {name, size, type}; head: first bytes of the file (Uint8Array/array).
     Returns {ok:true, kind:'jpeg'|'png', ext:'jpg'|'png'} or {ok:false, code}. */
  function validateImage(meta, head, maxBytes) {
    var max = (typeof maxBytes === 'number' && maxBytes > 0) ? maxBytes : LIMITS.maxImageBytes;
    if (!meta || typeof meta.name !== 'string') return { ok: false, code: 'no_file' };
    var ext = extensionOf(meta.name);
    if (['jpg', 'jpeg', 'png'].indexOf(ext) === -1) return { ok: false, code: 'bad_extension' };
    if (typeof meta.size !== 'number' || meta.size <= 0) return { ok: false, code: 'empty' };
    if (meta.size > max) return { ok: false, code: 'too_large' };
    var kind = detectImageType(head);
    if (!kind) return { ok: false, code: 'bad_content' };           // SVG/HTML/EXE/WEBP/GIF …
    var extKind = ext === 'png' ? 'png' : 'jpeg';
    if (kind !== extKind) return { ok: false, code: 'ext_content_mismatch' };
    var t = (meta.type || '').toLowerCase();
    if (t) {
      var tKind = (t === 'image/png') ? 'png' : (t === 'image/jpeg' || t === 'image/jpg') ? 'jpeg' : null;
      if (tKind !== kind) return { ok: false, code: 'mime_content_mismatch' };
    }
    return { ok: true, kind: kind, ext: kind === 'png' ? 'png' : 'jpg' };
  }

  function safeFileName(ext, randomHex) {
    var e = ext === 'png' ? 'png' : 'jpg';
    var r = String(randomHex || '').replace(/[^a-f0-9]/gi, '').slice(0, 24).toLowerCase();
    if (r.length < 8) throw new Error('safeFileName: need >= 8 hex chars of randomness');
    return 'kc-admin-ad-' + r + '.' + e;
  }

  /* Same shape firestore.rules accepts for admin free-ad images. */
  function isAdFreeImageUrl(u, cloudName) {
    if (typeof u !== 'string' || u.length > LIMITS.maxUrl) return false;
    var cn = String(cloudName || 'fzntl3lv').replace(/[^A-Za-z0-9_-]/g, '');
    return new RegExp('^https://res\\.cloudinary\\.com/' + cn + '/image/upload/[A-Za-z0-9/_.-]+\\.(jpg|jpeg|png)$').test(u);
  }

  /* ---------- destination URL: https only ---------- */
  function isSafeHttpsUrl(u) {
    if (typeof u !== 'string') return false;
    var t = u.trim();
    if (!t || t.length > LIMITS.maxUrl || t !== u) return false;
    if (/\s/.test(t) || !/^https:\/\/[^\s]+$/.test(t)) return false;
    try {
      var p = new URL(t);
      if (p.protocol !== 'https:') return false;
      if (p.username || p.password) return false;
      if (!p.hostname || p.hostname.indexOf('.') === -1) return false;
    } catch (e) { return false; }
    return true;
  }

  /* ---------- IST handling ---------- */
  // 'YYYY-MM-DDTHH:mm' typed by the admin is ALWAYS interpreted as IST,
  // whatever the device time-zone is.
  function parseIstLocal(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(str || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
    var utc = Date.UTC(y, mo - 1, d, h, mi);
    var chk = new Date(utc);
    if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
    return utc - IST_OFFSET_MS;
  }
  function toIstInputValue(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '';
    var d = new Date(ms + IST_OFFSET_MS);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
      'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }
  function formatIst(ms, locale) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '—';
    try {
      return new Intl.DateTimeFormat(locale || 'en-IN', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: true
      }).format(new Date(ms)) + ' IST';
    } catch (e) { return toIstInputValue(ms).replace('T', ' ') + ' IST'; }
  }
  function tsToMillis(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    return null;
  }

  /* ---------- campaign input validation (mirrors firestore.rules) ---------- */
  function validateCampaignInput(i, nowMs, opts) {
    var errors = [];
    opts = opts || {};
    var title = typeof i.title === 'string' ? i.title.trim() : '';
    if (!title) errors.push('title_required');
    else if (title.length > LIMITS.maxTitle) errors.push('title_too_long');
    var desc = typeof i.description === 'string' ? i.description.trim() : '';
    if (desc.length > LIMITS.maxDescription) errors.push('description_too_long');
    var alt = typeof i.imageAlt === 'string' ? i.imageAlt.trim() : '';
    if (alt.length > LIMITS.maxAlt) errors.push('alt_too_long');
    var url = typeof i.destinationUrl === 'string' ? i.destinationUrl.trim() : '';
    if (url && !isSafeHttpsUrl(url)) errors.push('destination_invalid');
    if (typeof i.startMs !== 'number' || !isFinite(i.startMs)) errors.push('start_invalid');
    if (typeof i.endMs !== 'number' || !isFinite(i.endMs)) errors.push('end_invalid');
    if (!errors.some(function (e) { return e === 'start_invalid' || e === 'end_invalid'; })) {
      if (i.endMs <= i.startMs) errors.push('end_before_start');
      else if (i.endMs - i.startMs > MAX_DURATION_MS) errors.push('range_too_long');
      if (opts.publish && !(i.endMs > nowMs)) errors.push('end_in_past');
    }
    if (!i.hasImage) errors.push('image_required');
    return { ok: errors.length === 0, errors: errors };
  }

  /* ---------- status model ----------
     Stored lifecycle status: draft | published | inactive.
     Effective (display) status adds the time dimension:
       draft | scheduled | active | expired | inactive                      */
  function effectiveStatus(doc, nowMs) {
    if (!doc) return null;
    if (doc.status === 'draft') return 'draft';
    if (doc.status === 'inactive') return 'inactive';
    if (doc.status !== 'published') return null;
    var s = tsToMillis(doc.startAt), e = tsToMillis(doc.endAt);
    if (s === null || e === null) return null;
    if (nowMs >= e) return 'expired';
    if (nowMs < s) return 'scheduled';
    return 'active';
  }
  function occupiesSlot(doc, nowMs) {
    var st = effectiveStatus(doc, nowMs);
    return st === 'scheduled' || st === 'active';
  }
  /* Client-side hint only; firestore.rules is the authority. */
  function slotBlockedBy(campaigns, exceptId, nowMs) {
    for (var k = 0; k < (campaigns || []).length; k++) {
      var c = campaigns[k];
      if (c && c.id !== exceptId && occupiesSlot(c, nowMs)) return c.id;
    }
    return null;
  }

  /* ---------- public banner model ----------
     Input: the public slot document data (or null). Output: a sanitised
     render model, or null (=> render nothing). The Firestore read itself is
     already gated by request.time in the rules; with a numeric nowMs this is
     a second check, with null it only sanitises.  */
  function bannerModel(pub, nowMs, cloudName) {
    if (!pub || pub.published !== true) return null;
    var s = tsToMillis(pub.startAt), e = tsToMillis(pub.endAt);
    if (s === null || e === null) return null;
    // nowMs === null: the caller relies on the server-side window (rules,
    // request.time) and deliberately does NOT trust the device clock.
    if (typeof nowMs === 'number' && !(nowMs >= s && nowMs < e)) return null;
    if (!isAdFreeImageUrl(pub.imageUrl, cloudName)) return null;
    var title = typeof pub.title === 'string' ? pub.title.trim() : '';
    if (!title || title.length > LIMITS.maxTitle) return null;
    var desc = typeof pub.description === 'string' ? pub.description.trim().slice(0, LIMITS.maxDescription) : '';
    var alt = (typeof pub.imageAlt === 'string' && pub.imageAlt.trim()) ? pub.imageAlt.trim().slice(0, LIMITS.maxAlt) : title;
    var dest = (typeof pub.destinationUrl === 'string' && isSafeHttpsUrl(pub.destinationUrl)) ? pub.destinationUrl : '';
    return { title: title, description: desc, imageUrl: pub.imageUrl, alt: alt, destinationUrl: dest, endMs: e };
  }

  return {
    LIMITS: LIMITS, IST_OFFSET_MS: IST_OFFSET_MS, MAX_DURATION_MS: MAX_DURATION_MS,
    detectImageType: detectImageType, extensionOf: extensionOf, validateImage: validateImage,
    safeFileName: safeFileName, isAdFreeImageUrl: isAdFreeImageUrl, isSafeHttpsUrl: isSafeHttpsUrl,
    parseIstLocal: parseIstLocal, toIstInputValue: toIstInputValue, formatIst: formatIst,
    tsToMillis: tsToMillis, validateCampaignInput: validateCampaignInput,
    effectiveStatus: effectiveStatus, occupiesSlot: occupiesSlot, slotBlockedBy: slotBlockedBy,
    bannerModel: bannerModel
  };
});
