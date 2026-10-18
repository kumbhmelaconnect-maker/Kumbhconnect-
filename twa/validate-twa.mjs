#!/usr/bin/env node
// Static validation of the TWA configuration. No network, no secrets.
// Usage: node twa/validate-twa.mjs [--strict]   (--strict also rejects the pending-owner markers)
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const strict = process.argv.includes('--strict');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [], warns = [];
const err = (m) => errors.push(m), warn = (m) => warns.push(m);
const readJson = (p) => { try { return JSON.parse(readFileSync(resolve(root, p), 'utf8')); } catch (e) { err(`${p}: ${e.message}`); return null; } };

const t = readJson(process.env.TWA_MANIFEST || 'twa/twa-manifest.json');
const web = readJson('manifest.json');
const PKG = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const HOST = 'kumbhmelaconnect-maker.github.io', BASE = '/Kumbhconnect-/';

if (t) {
  if (!PKG.test(t.packageId || '')) err(`packageId invalid: ${t.packageId}`);
  if (t.host !== HOST) err(`host must be ${HOST}`);
  if (!(t.startUrl || '').startsWith(BASE)) err(`startUrl must start with ${BASE} (project-site subpath)`);
  if (!(t.fullScopeUrl || '').startsWith(`https://${HOST}${BASE}`)) err('fullScopeUrl must be under the project-site path');
  if (`https://${HOST}${t.startUrl}`.indexOf(t.fullScopeUrl) !== 0) err('startUrl is outside fullScopeUrl');
  for (const k of ['webManifestUrl', 'iconUrl', 'maskableIconUrl']) {
    if (!(t[k] || '').startsWith(`https://${HOST}${BASE}`)) err(`${k} must be under https://${HOST}${BASE}`);
    else if (!existsSync(resolve(root, t[k].slice(`https://${HOST}${BASE}`.length)))) err(`${k} target file missing in repo`);
  }
  if (t.enableNotifications !== false) err('enableNotifications must stay false (no verified push implementation)');
  if (t.features?.locationDelegation?.enabled) err('locationDelegation must stay disabled until verified on a device');
  if (t.features?.notificationDelegation) err('notificationDelegation must not be enabled');
  if (!Number.isInteger(t.appVersionCode) || t.appVersionCode < 1) err('appVersionCode must be a positive integer');
  if (!/^[0-9]+(\.[0-9]+){1,3}([-.][A-Za-z0-9]+)?$/.test(t.appVersionName || '')) err('appVersionName format invalid');
  if ('appVersion' in t && t.appVersion !== t.appVersionName) err('legacy appVersion must equal appVersionName');
  if (!['customtabs', 'webview'].includes(t.fallbackType)) err('fallbackType must be customtabs or webview');
  if (!['portrait', 'landscape', 'default'].includes(t.orientation)) err('orientation invalid');
  const ph = JSON.stringify(t).match(/__[A-Z_]+__/g) || [];
  const allowed = new Set(['__SET_BY_WORKFLOW__']);
  const bad = ph.filter((p) => !allowed.has(p));
  if (bad.length) err(`unresolved placeholders: ${[...new Set(bad)].join(', ')}`);
  if (strict && ph.length) err('placeholders remain (strict mode)');
  if (strict && t.packageId === 'in.kumbhconnect.nashik' && process.env.TWA_PACKAGE_ID_CONFIRMED !== 'true')
    err('packageId is still PROPOSED; set repository variable TWA_PACKAGE_ID_CONFIRMED=true once the owner approves it');
}
if (web && t) {
  const s = new URL(web.start_url, `https://${HOST}${BASE}manifest.json`);
  if (s.pathname !== t.startUrl) err(`web manifest start_url (${s.pathname}) != twa startUrl (${t.startUrl})`);
  const sc = new URL(web.scope, `https://${HOST}${BASE}manifest.json`);
  if (sc.pathname !== BASE) err(`web manifest scope resolves to ${sc.pathname}, expected ${BASE}`);
  if (!(web.icons || []).some((i) => /maskable/.test(i.purpose || ''))) warn('manifest.json declares no maskable icon (icon-maskable-512.png exists; add it to the web manifest)');
}
try {
  const wf = readFileSync(resolve(root, '.github/workflows/twa-build.yml'), 'utf8');
  if (/\|\|\s*true/.test(wf)) err('workflow contains "|| true" (masks failures)');
  if (!/^\s*workflow_dispatch:/m.test(wf) || /^\s*(push|pull_request|schedule):/m.test(wf)) err('workflow must be manual-only');
  if (/upload-artifact/.test(wf) && !/inputs\.upload_artifact/.test(wf)) err('artifact upload must be opt-in');
} catch (e) { err(`workflow unreadable: ${e.message}`); }
const al = readJson('twa/assetlinks.template.json');
if (al) {
  const fp = JSON.stringify(al);
  if (!/__REPLACE_WITH_REAL_SHA256_CERT_FINGERPRINT__/.test(fp)) warn('assetlinks template contains no placeholder; ensure it is a real, owner-verified fingerprint');
  if (t && al[0]?.target?.package_name !== t.packageId) err('assetlinks package_name != twa packageId');
}
for (const w of warns) console.log('WARNING:', w);
for (const e of errors) console.log('FAIL:', e);
console.log(errors.length ? `RESULT: FAIL (${errors.length} error(s))` : `RESULT: PASS${strict ? ' (strict)' : ''} (${warns.length} warning(s))`);
process.exit(errors.length ? 1 : 0);
