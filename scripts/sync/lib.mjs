// Firestore (public reads) -> Supabase public replica. Node >= 20, no dependencies.
//
// LEAST PRIVILEGE: this reads ONLY what firestore.rules already makes world-readable
// (kc_listings where status == 'approved', and kc_review_public).
// kc_reviews is PRIVATE (reviewerUid, comment; SEC-PASS-8 R-1) and is never read here;
// kc_review_public is its public mirror holding only { listingId, rating, createdAt }.
// It uses NO Firebase admin credential. The only secret is the Supabase service-role / secret key,
// used solely to call the sync_public_listings RPC.
//
// If App Check ENFORCEMENT is later switched on for Firestore, these unauthenticated
// REST reads will be refused and the sync will fail closed (nothing is deleted).
//
// PRIVACY: queries use a field projection (`select`) so only the fields the sync needs
// are ever downloaded (review mirror: listingId + rating only).
// Any Firestore read failure aborts the run BEFORE any Supabase call (fail closed).

export const LISTING_TYPES = ['business', 'service', 'guide', 'volunteer'];
export const DEFAULT_FIREBASE_PROJECT_ID = 'kumbh-connect-e308e'; // from firebase-config.js
export const LISTING_FIELDS = ['status', 'type', 'name', 'category', 'description', 'address', 'servicesList', 'photos', 'lat', 'lng'];
export const REVIEW_FIELDS = ['listingId', 'rating'];
export const REVIEW_COLLECTION = 'kc_review_public'; // public mirror; NOT kc_reviews (private)
export const DEFAULT_CLOUD_NAME = 'fzntl3lv';                      // from firebase-config.js

// ---------------------------------------------------------------- decoding
export function decodeValue(v) {
  if (v === null || typeof v !== 'object') return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) {
    const o = Object.create(null); // no prototype => "__proto__" keys are inert
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = decodeValue(val);
    return o;
  }
  return undefined;
}

export function decodeDocument(doc) {
  const name = String(doc.name || '');
  const id = name.slice(name.lastIndexOf('/') + 1);
  const data = Object.create(null);
  for (const [k, v] of Object.entries(doc.fields || {})) data[k] = decodeValue(v);
  return { id, name, data, createTime: doc.createTime || null, updateTime: doc.updateTime || null };
}

// ---------------------------------------------------------------- transform
const cpLen = (s) => [...s].length; // code points, like Postgres char_length
const clean = (s) => s.replace(/\u0000/g, ''); // NUL is not storable in Postgres text

function photoRegex(cloudName) {
  return new RegExp('^https://res\\.cloudinary\\.com/' + cloudName + '/image/upload/[A-Za-z0-9/_.-]+$');
}

function optText(data, key, max, out, reasons) {
  const v = data[key];
  if (v === undefined || v === null) { out[key] = null; return; }
  if (typeof v !== 'string') { out[key] = null; return; }
  const s = clean(v);
  if (cpLen(s) > max) reasons.push(`${key} too long`);
  out[key] = s;
}

/** Returns { ok:true,row } or { ok:false,reason }. Allow-list only: nothing else is copied. */
export function transformListing(doc, { cloudName = DEFAULT_CLOUD_NAME } = {}) {
  const { id, data } = doc;
  const reasons = [];
  if (!id || cpLen(id) > 100) return { ok: false, id, reason: 'bad id' };
  if (data.status !== 'approved') return { ok: false, id, reason: 'not approved' };
  if (!LISTING_TYPES.includes(data.type)) return { ok: false, id, reason: 'bad type' };
  if (typeof data.name !== 'string') return { ok: false, id, reason: 'bad name' };
  const name = clean(data.name).trim();
  if (cpLen(name) < 1 || cpLen(name) > 150) return { ok: false, id, reason: 'bad name' };

  const t = {};
  optText(data, 'category', 60, t, reasons);
  optText(data, 'description', 2000, t, reasons);
  optText(data, 'address', 300, t, reasons);
  optText(data, 'servicesList', 1000, t, reasons);
  if (reasons.length) return { ok: false, id, reason: reasons.join(', ') };

  const re = photoRegex(cloudName);
  const photos = (Array.isArray(data.photos) ? data.photos : [])
    .filter((u) => typeof u === 'string' && u.length <= 300 && re.test(u) && !u.includes('..'))
    .slice(0, 3);

  let lat = null, lng = null;
  if (typeof data.lat === 'number' && typeof data.lng === 'number' &&
      Number.isFinite(data.lat) && Number.isFinite(data.lng) &&
      data.lat >= -90 && data.lat <= 90 && data.lng >= -180 && data.lng <= 180) {
    lat = data.lat; lng = data.lng;
  }

  return {
    ok: true,
    row: {
      id, type: data.type, name,
      category: t.category, description: t.description, address: t.address,
      services_list: t.servicesList,
      photos, lat, lng,
      source_create_time: doc.createTime, source_update_time: doc.updateTime,
    },
  };
}

export function buildAggregates(listingIds, reviewDocs) {
  const agg = new Map(listingIds.map((id) => [id, { listing_id: id, review_count: 0, rating_sum: 0 }]));
  const seen = new Set();
  for (const r of reviewDocs) {
    if (seen.has(r.id)) continue; seen.add(r.id);
    const a = agg.get(r.data.listingId);
    const rating = r.data.rating;
    if (!a || !Number.isInteger(rating) || rating < 1 || rating > 5) continue;
    a.review_count += 1; a.rating_sum += rating;
  }
  return [...agg.values()];
}

// ---------------------------------------------------------------- HTTP
const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

export async function requestWithRetry(fetchFn, url, init, { retries = 3, sleep = sleepDefault, timeoutMs = 30000, label = 'request' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
      const res = await fetchFn(url, { ...init, signal });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${label} failed: HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (e) {
      lastErr = new Error(`${label} failed: network error`); // never echo URL/headers
    }
    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }
  throw lastErr;
}

const safeText = (v, max) => String(v == null ? '' : v).replace(/[^\x20-\x7E]/g, ' ').slice(0, max);

function firestoreRunQueryUrl(projectId, apiKey) {
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  return `${base}:runQuery` + (apiKey ? `?key=${encodeURIComponent(apiKey)}` : '');
}

/** Firestore error body -> { code, detail } (Google's own status text; never contains our secrets). */
async function readFirestoreError(res) {
  try {
    const b = await res.json();
    const e = Array.isArray(b) ? (b[0] && b[0].error) : (b && b.error);
    if (!e) return {};
    return { code: safeText(e.status, 40), detail: safeText(e.message, 200) };
  } catch { return {}; }
}

export class FirestoreError extends Error {
  constructor(collection, httpStatus, code, detail) {
    const extra = [code, detail].filter(Boolean).join(': ');
    super(`firestore ${collection} failed: HTTP ${httpStatus}` + (extra ? ` (${extra})` : ''));
    this.name = 'FirestoreError';
    this.collection = collection;
    this.httpStatus = httpStatus;
    this.code = code || '';
  }
}

export async function runQueryPaged({ fetchFn, projectId, collection, where, pageSize, maxPages, apiKey, sleep, select }) {
  const url = firestoreRunQueryUrl(projectId, apiKey);
  const docs = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const structuredQuery = {
      from: [{ collectionId: collection }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: pageSize,
    };
    if (where) structuredQuery.where = where;
    if (select && select.length) structuredQuery.select = { fields: select.map((f) => ({ fieldPath: f })) };
    if (cursor) structuredQuery.startAt = { values: [{ referenceValue: cursor }], before: false };
    const res = await requestWithRetry(fetchFn, url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ structuredQuery }),
    }, { sleep, label: `firestore ${collection}` });
    if (!res.ok) {
      const d = await readFirestoreError(res);
      throw new FirestoreError(collection, res.status, d.code, d.detail);
    }
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error(`firestore ${collection} failed: unexpected response`);
    if (body.some((x) => x && x.error)) throw new Error(`firestore ${collection} failed: query error`);
    // Every element must be {document} or the empty-result marker {readTime}; anything else = malformed read.
    for (const x of body) {
      const okShape = x && typeof x === 'object' && ((x.document && typeof x.document.name === 'string') || ('readTime' in x && !x.document));
      if (!okShape) throw new Error(`firestore ${collection} failed: malformed response`);
      if (x.document && !x.document.name.includes(`/documents/${collection}/`)) throw new Error(`firestore ${collection} failed: unexpected document path`);
    }
    const got = body.filter((x) => x.document).map((x) => decodeDocument(x.document));
    docs.push(...got);
    if (got.length < pageSize) return docs;
    // startAt with before:false resumes strictly AFTER the cursor document.
    cursor = got[got.length - 1].name;
  }
  // A truncated read would produce wrong deletions / aggregates: fail instead.
  throw new Error(`firestore ${collection} failed: exceeded ${maxPages} pages`);
}

// ---------------------------------------------------------------- diagnostics
async function probeReviews({ fetchFn, projectId, apiKey, where }) {
  const structuredQuery = { from: [{ collectionId: REVIEW_COLLECTION }], limit: 1, select: { fields: [{ fieldPath: 'rating' }] } };
  if (where) structuredQuery.where = where;
  try {
    const res = await requestWithRetry(fetchFn, firestoreRunQueryUrl(projectId, apiKey), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ structuredQuery }),
    }, { retries: 0, label: `firestore ${REVIEW_COLLECTION} probe` });
    if (res.ok) return 'allowed';
    const d = await readFirestoreError(res);
    return `HTTP ${res.status}` + (d.code ? ` ${d.code}` : '') + (d.detail ? `: ${d.detail}` : '');
  } catch { return 'network error'; }
}

/** Read-only evidence for a 403 on kc_reviews: at most 2 requests, 1 doc each, no data logged. */
export async function diagnoseReviewsAccess({ fetchFn, projectId, apiKey, sampleListingId, log }) {
  const wholeCollection = await probeReviews({ fetchFn, projectId, apiKey, where: null });
  log(`diagnosis: ${REVIEW_COLLECTION} unfiltered query -> ${wholeCollection}`);
  if (sampleListingId) {
    const filtered = await probeReviews({
      fetchFn, projectId, apiKey,
      where: { fieldFilter: { field: { fieldPath: 'listingId' }, op: 'EQUAL', value: { stringValue: sampleListingId } } },
    });
    log(`diagnosis: ${REVIEW_COLLECTION} query filtered by listingId -> ${filtered}`);
  }
  log(`diagnosis: Firestore Rules (not this script) decide this. Check that the deployed rules contain a public read rule for ${REVIEW_COLLECTION}. kc_listings was readable in the same run, so the project id and network path are fine.`);
}

// ---------------------------------------------------------------- config
function decodeJwtRole(key) {
  try {
    const parts = key.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role || null;
  } catch { return null; }
}

export function readConfig(env) {
  const dryRun = String(env.SYNC_DRY_RUN || '').toLowerCase() === 'true';
  const cfg = {
    dryRun,
    allowMassDelete: env.SYNC_MASS_DELETE_CONFIRM === 'DELETE', // exact typed confirmation; 'true' etc. do NOT count
    projectId: env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID,
    cloudName: env.CLOUDINARY_CLOUD_NAME || DEFAULT_CLOUD_NAME,
    firebaseApiKey: env.FIREBASE_WEB_API_KEY || '', // public web key, optional, not a secret
    supabaseUrl: '', supabaseKey: '',
  };
  if (!/^[a-z0-9-]{1,63}$/.test(cfg.projectId)) throw new Error('invalid FIREBASE_PROJECT_ID');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(cfg.cloudName)) throw new Error('invalid CLOUDINARY_CLOUD_NAME');
  if (dryRun) return cfg; // dry run never touches Supabase

  const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url) throw new Error('SUPABASE_URL is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  const local = env.KC_SYNC_ALLOW_LOCAL === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);
  if (!local && !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) {
    throw new Error('SUPABASE_URL must look like https://<project-ref>.supabase.co'); // never send the key elsewhere
  }
  if (key.startsWith('sb_publishable_') || decodeJwtRole(key) === 'anon') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY holds a public (anon/publishable) key');
  }
  cfg.supabaseUrl = url; cfg.supabaseKey = key;
  return cfg;
}

function supabaseHeaders(key) {
  const h = { 'content-type': 'application/json', apikey: key };
  if (!key.startsWith('sb_')) h.authorization = `Bearer ${key}`; // legacy JWT keys need Bearer; sb_secret_ keys must not be sent as Bearer
  return h;
}

// ---------------------------------------------------------------- orchestration
export async function runSync({ env, fetchFn = globalThis.fetch, log = console.log, now = () => new Date(), sleep = sleepDefault }) {
  const cfg = readConfig(env);
  // Stamp BEFORE reading: a run that started earlier can never overwrite a run that started later.
  const runStartedAt = now().toISOString();

  const listingDocs = await runQueryPaged({
    fetchFn, projectId: cfg.projectId, collection: 'kc_listings', sleep,
    where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'approved' } } },
    pageSize: 300, maxPages: 100, apiKey: cfg.firebaseApiKey, select: LISTING_FIELDS,
  });
  let reviewDocs;
  try {
    reviewDocs = await runQueryPaged({
      fetchFn, projectId: cfg.projectId, collection: REVIEW_COLLECTION, sleep,
      where: null, pageSize: 500, maxPages: 400, apiKey: cfg.firebaseApiKey, select: REVIEW_FIELDS,
    });
  } catch (e) {
    if (e instanceof FirestoreError && e.httpStatus === 403) {
      await diagnoseReviewsAccess({
        fetchFn, projectId: cfg.projectId, apiKey: cfg.firebaseApiKey,
        sampleListingId: listingDocs.length ? listingDocs[0].id : '', log,
      });
      log('aborting: review data is required for aggregates; nothing was sent to Supabase and nothing was deleted');
    }
    throw e; // fail closed: never sync listings with missing/partial review data
  }

  const rows = [], skipped = [], seen = new Set();
  for (const d of listingDocs) {
    if (seen.has(d.id)) continue; seen.add(d.id);
    const r = transformListing(d, { cloudName: cfg.cloudName });
    if (r.ok) rows.push(r.row); else skipped.push({ id: r.id, reason: r.reason });
  }
  if (skipped.length) {
    // An approved listing we cannot represent safely means the data or our validation is wrong.
    // Do NOT sync a partial snapshot (it would delete the listing from the public replica).
    for (const s of skipped) log(`invalid approved listing ${s.id}: ${s.reason}`); // doc id + reason only
    throw new Error(`${skipped.length} approved listing(s) failed validation; sync aborted before any database change`);
  }
  if (listingDocs.length === 0 && !cfg.allowMassDelete) {
    // Evidence only; the protection itself is NOT relaxed. The query itself succeeded (HTTP 200),
    // so this is not a permission failure: either no document matches, or project/collection differ.
    log(`diagnosis: Firestore project "${cfg.projectId}" answered the query on kc_listings (status == "approved") with HTTP 200 and 0 documents.`);
    log('diagnosis: check in the Firebase console, same project: (1) FIREBASE_PROJECT_ID repository variable (empty = built-in default), (2) collection name is exactly kc_listings, (3) at least one document has status exactly "approved" (lowercase, a string), (4) the database is "(default)".');
    throw new Error('Firestore returned zero approved listings; refusing to treat this as an empty dataset (set SYNC_MASS_DELETE_CONFIRM=DELETE only if intended)');
  }
  const aggregates = buildAggregates(rows.map((r) => r.id), reviewDocs);

  const summary = {
    runStartedAt, dryRun: cfg.dryRun,
    listingsFetched: listingDocs.length, listingsValid: rows.length, listingsSkipped: skipped.length,
    reviewsFetched: reviewDocs.length, aggregates: aggregates.length,
  };
  log(`fetched ${summary.listingsFetched} approved listings, ${summary.reviewsFetched} reviews; ` +
      `${summary.listingsValid} valid, ${summary.listingsSkipped} invalid`);

  if (cfg.dryRun) { log('dry run: Supabase not contacted'); return { ...summary, result: null }; }

  const res = await requestWithRetry(fetchFn, `${cfg.supabaseUrl}/rest/v1/rpc/sync_public_listings`, {
    method: 'POST', headers: supabaseHeaders(cfg.supabaseKey),
    body: JSON.stringify({
      p_run_started_at: runStartedAt, p_listings: rows, p_aggregates: aggregates,
      p_allow_mass_delete: cfg.allowMassDelete,
    }),
  }, { sleep, label: 'supabase rpc' }); // RPC is idempotent, so retrying is safe
  if (!res.ok) {
    let code = '', msg = '';
    try { const b = await res.json(); code = String(b.code || ''); msg = String(b.message || '').slice(0, 200); } catch { /* ignore */ }
    throw new Error(`supabase rpc failed: HTTP ${res.status} ${code} ${msg}`.trim());
  }
  const result = await res.json();
  if (!result || (result.status !== 'ok' && result.status !== 'stale')) throw new Error('supabase rpc failed: unexpected result');
  if (result.status === 'stale') log('stale run: a newer run already applied; nothing changed');
  else log(`applied: ${JSON.stringify(result)}`);
  return { ...summary, result };
}
