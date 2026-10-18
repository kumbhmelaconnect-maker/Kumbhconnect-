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

// ---------------------------------------------------------------------------------------------
// Workflow checks.
//
// Static text analysis of shell embedded in YAML has limits: this is a line-based text scan, not a YAML or
// bash parser, so it cannot know what bash will really execute. Known limits: (1) a line that merely STARTS
// with '#' inside a heredoc or multi-line string is skipped as a "comment"; (2) other ways of masking failure
// (e.g. `|| echo ok`, `if ...; then ...; fi` tricks) are not detected; (3) it proves the guard LINES exist in
// the step, not that they are reached at run time. It is a tripwire for accidental edits, not a proof.
// So the rules are conservative and fail closed:
//   * Only lines whose FIRST non-blank character is '#' are treated as comments (valid in both YAML
//     and shell). Trailing comments (`cmd  # note`) are NOT stripped, so `|| true` hiding in a
//     trailing comment is still reported. Rewrite such a comment instead of weakening the check.
//   * Every `|| true` (also `||true`, `|| :`) on a non-comment line is an error, EXCEPT one narrowly
//     defined pattern in ALLOWED_MASKS below, and only while the explicit guards that make that
//     pattern fail-closed are still present in the same workflow step.
// ---------------------------------------------------------------------------------------------
const WF_PATH = '.github/workflows/twa-build.yml';

// Each entry allows ONE capture of the form:  NAME=$(grep [-flags] 'literal' "path" || true)
// and states the guards that must still exist. {N} is replaced by NAME.
const ALLOWED_MASKS = [
  {
    name: 'APK_FP_LINES',
    why: 'grep exits 1 when no fingerprint line is found; the explicit empty-check right after reports it',
    // The ONLY accepted shape: a plain variable assignment from a single grep, nothing else.
    shape: /^\s*([A-Z][A-Z0-9_]*)=\$\(grep(?: -[A-Za-z]+)* '[^'\n]*' "[^"\n]*" \|\| true\)\s*$/,
    // Must be the next executable line: fail if empty.
    nextLine: (n) => new RegExp(`^\\s*\\[ -n "\\$${n}" \\] \\|\\| \\{[^}]*exit 1;?\\s*\\}\\s*$`),
    // Must appear somewhere in the same step (step = from its "- name:/- uses:" line to the next one).
    stepGuards: [
      { desc: 'variable is consumed line-by-line (while read ... <<<"$NAME")', re: (n) => new RegExp(`<<<"\\$${n}"`) },
      { desc: 'every parsed APK fingerprint must be 64 hex chars, else exit 1', re: () => /\[\[ "\$APK_FP" =~ \^\[0-9A-F\]\{64\}\$ \]\] \|\| \{[^}]*exit 1;?\s*\}/ },
      { desc: 'keystore fingerprint must be 64 hex chars, else exit 1', re: () => /\[\[ "\$KS_FP" =~ \^\[0-9A-F\]\{64\}\$ \]\] \|\| \{[^}]*exit 1;?\s*\}/ },
      { desc: 'APK fingerprint must equal keystore fingerprint, else exit 1', re: () => /\[ "\$APK_FP" = "\$KS_FP" \] \|\| \{[^}]*exit 1;?\s*\}/ },
      { desc: 'at least one fingerprint must have been compared, else exit 1', re: () => /\[ "\$APK_FP_COUNT" -ge 1 \] \|\| \{[^}]*exit 1;?\s*\}/ },
    ],
  },
];

try {
  const raw = readFileSync(resolve(root, WF_PATH), 'utf8');
  const lines = raw.split(/\r?\n/).map((text, i) => ({ n: i + 1, text, comment: /^\s*#/.test(text) }));
  const code = lines.filter((l) => !l.comment);
  const codeText = code.map((l) => l.text).join('\n');

  const stepBounds = (idx) => {
    const isStart = (s) => /^\s*- (name|uses|run|id):/.test(s);
    let a = idx; while (a > 0 && !isStart(lines[a].text)) a--;
    const indent = (lines[a].text.match(/^\s*/) || [''])[0].length;
    let b = idx + 1;
    while (b < lines.length && !(isStart(lines[b].text) && (lines[b].text.match(/^\s*/) || [''])[0].length === indent)) b++;
    return lines.slice(a, b).filter((l) => !l.comment).map((l) => l.text).join('\n');
  };

  // 1. Masking constructs.
  const MASK = /\|\|\s*(true|:)(?![A-Za-z0-9_])/;
  const used = new Map(); // allowed name -> count
  for (const l of code) {
    if (!MASK.test(l.text)) continue;
    const idx = l.n - 1;
    const rule = ALLOWED_MASKS.find((r) => { const m = r.shape.exec(l.text); return m && m[1] === r.name; });
    if (!rule) { err(`${WF_PATH}:${l.n}: "|| true" masks failures and is not an allowed pattern: ${l.text.trim()}`); continue; }
    used.set(rule.name, (used.get(rule.name) || 0) + 1);
    if (used.get(rule.name) > 1) { err(`${WF_PATH}:${l.n}: allowed pattern for ${rule.name} appears more than once`); continue; }
    // Next executable line must be the explicit empty check.
    let j = idx + 1; while (j < lines.length && (lines[j].comment || lines[j].text.trim() === '')) j++;
    if (!rule.nextLine(rule.name).test(lines[j]?.text ?? ''))
      err(`${WF_PATH}:${l.n}: ${rule.name} capture is not immediately followed by a fail-closed check ([ -n "$${rule.name}" ] || { ...; exit 1; })`);
    const step = stepBounds(idx);
    for (const g of rule.stepGuards) if (!g.re(rule.name).test(step)) err(`${WF_PATH}:${l.n}: required guard missing in this step: ${g.desc}`);
  }
  if (/^\s*set\s+\+e\b/m.test(codeText)) err(`${WF_PATH}: "set +e" disables fail-fast`);
  if (/^\s*continue-on-error:\s*(true|\$\{\{)/m.test(codeText)) err(`${WF_PATH}: continue-on-error masks step failures`);

  // 2. Trigger must be manual only.
  if (!/^\s*workflow_dispatch:/m.test(codeText) || /^\s*(push|pull_request|pull_request_target|schedule|workflow_run|release):/m.test(codeText)) err('workflow must be manual-only (workflow_dispatch)');

  // 3. Artifact upload must be opt-in AND build-mode only (probe never uploads).
  code.forEach((l) => {
    if (!/uses:\s*actions\/upload-artifact@/.test(l.text)) return;
    const step = stepBounds(l.n - 1);
    const cond = (step.match(/^\s*if:.*$/m) || [''])[0];
    if (!/inputs\.upload_artifact/.test(cond)) err(`${WF_PATH}:${l.n}: artifact upload must be gated by inputs.upload_artifact`);
    if (!/inputs\.mode\s*==\s*'build'/.test(cond)) err(`${WF_PATH}:${l.n}: artifact upload must be gated to mode == 'build'`);
  });

  // 4. Probe mode must stay unsigned and secret-free.
  const probe = (() => { const i = lines.findIndex((l) => !l.comment && /name:\s*Probe\b/.test(l.text)); return i < 0 ? null : stepBounds(i); })();
  if (!probe) err('probe step not found');
  else {
    if (!/bubblewrap build --skipSigning/.test(probe)) err('probe step must run "bubblewrap build --skipSigning"');
    if (/secrets\./.test(probe)) err('probe step must not reference secrets');
  }
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
