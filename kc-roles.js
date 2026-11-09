/* KumbhConnect v1.5.2 (Stage 2) — centralized staff-role resolution.
 *
 * ONE implementation of "is this uid a valid, active staff member?" shared by
 * index.html and media-center-admin.html (and unit-tested in tests/).
 *
 * SECURITY MODEL (read this before changing anything):
 *   - This file is CLIENT code. It decides which UI to show; it does NOT authorize
 *     anything. Real authorization is Firestore Rules reading mc_roles/{uid}.
 *     firestore.rules is NOT part of this repository, so server-side enforcement is
 *     UNVERIFIED here. This module therefore never grants more than the rules
 *     described in firebase-config.js/index.html would: it is deliberately STRICT.
 *   - Staff roles are exactly: admin | dept | press. Service Providers, Guides and
 *     Volunteers are LISTING types (kc_listings.type/category) and are never roles.
 *   - A staff role is valid only if the mc_roles doc exists, role is exactly one of
 *     the three canonical values and `active === true` (boolean true; a missing
 *     field, "true", 1 … are all NOT active).
 *   - Nothing here reads localStorage/sessionStorage, and nothing here writes a role.
 *     There is no client path that can self-assign a role.
 *
 * Result statuses (superset-compatible with the Stage 1 getValidatedStaffRole()):
 *   {status:'no-role'}                           normal traveler
 *   {status:'valid', role, data}                 active admin/dept/press
 *   {status:'inactive', role, data}              canonical role but active !== true
 *   {status:'invalid-role', data, normalized?, reason}   unknown / non-canonical role
 *   {status:'error', error}                      lookup failed (NOT treated as no-role)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KCRoles = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STAFF_ROLES = Object.freeze(['admin', 'dept', 'press']);
  var LISTING_TYPES = Object.freeze(['business', 'service', 'guide', 'volunteer']);

  // Trim + lowercase for COMPARISON/diagnostics only. Returns null for non-strings/empty.
  function normalizeRole(v) {
    if (typeof v !== 'string') return null;
    var n = v.trim().toLowerCase();
    return n ? n : null;
  }

  function isStaffRole(v) { return typeof v === 'string' && STAFF_ROLES.indexOf(v) !== -1; }
  // Listing types are never privileged account roles.
  function isListingType(v) { var n = normalizeRole(v); return n !== null && LISTING_TYPES.indexOf(n) !== -1; }

  // Pure classification of an mc_roles snapshot (no I/O) — this is what the tests exercise most.
  function classifyRoleDoc(exists, data) {
    if (!exists) return { status: 'no-role' };
    if (!data || typeof data !== 'object') return { status: 'invalid-role', data: data || null, reason: 'malformed-document' };
    var raw = data.role;
    if (!isStaffRole(raw)) {
      var n = normalizeRole(raw);
      return {
        status: 'invalid-role', data: data,
        normalized: isStaffRole(n) ? n : null,                       // e.g. "Admin" -> "admin": reported, NOT granted
        reason: typeof raw !== 'string' ? 'role-not-a-string' : (isStaffRole(n) ? 'non-canonical-role-value' : 'unknown-role')
      };
    }
    if (data.active !== true) return { status: 'inactive', role: raw, data: data, reason: 'active-not-true' };
    return { status: 'valid', role: raw, data: data };
  }

  // I/O wrapper. `db` is a Firestore (compat) instance. `opts.withTimeout(promise, ms, label)` is optional.
  function resolveStaffRole(db, uid, opts) {
    opts = opts || {};
    var collection = opts.collection || 'mc_roles';
    var timeoutMs = opts.timeoutMs || 8000;
    if (typeof uid !== 'string' || !uid) return Promise.resolve({ status: 'error', error: new Error('missing uid') });
    var p;
    try { p = db.collection(collection).doc(uid).get(); } catch (e) { return Promise.resolve({ status: 'error', error: e }); }
    if (typeof opts.withTimeout === 'function') p = opts.withTimeout(p, timeoutMs, 'mc_roles read');
    return Promise.resolve(p).then(function (snap) {
      return classifyRoleDoc(!!(snap && snap.exists), snap && snap.exists ? snap.data() : null);
    }, function (err) { return { status: 'error', error: err }; });
  }

  // Monotonic token guard against out-of-order async results (account switching / rapid logout-login).
  //   const tok = guard.begin();  ... await ...;  if (!guard.isCurrent(tok)) return;
  function createGuard() {
    var n = 0;
    return {
      begin: function () { return ++n; },
      invalidate: function () { n++; },
      isCurrent: function (t) { return t === n; }
    };
  }

  // Which UI surface may a resolved result open? Anything that is not 'valid' gets nothing privileged.
  function dashboardFor(result) {
    return result && result.status === 'valid' && isStaffRole(result.role) ? result.role : null;
  }

  return { STAFF_ROLES: STAFF_ROLES, LISTING_TYPES: LISTING_TYPES, normalizeRole: normalizeRole,
    isStaffRole: isStaffRole, isListingType: isListingType, classifyRoleDoc: classifyRoleDoc,
    resolveStaffRole: resolveStaffRole, createGuard: createGuard, dashboardFor: dashboardFor };
});
