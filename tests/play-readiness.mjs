// Static Google Play readiness checks. No network, no dependencies.
// Run: node tests/play-readiness.mjs   (or: npm run test:play)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));
let failed = 0, passed = 0;
const ok = (name) => { passed++; console.log('PASS  ' + name); };
const fail = (name, why) => { failed++; console.error('FAIL  ' + name + (why ? ' -> ' + why : '')); };
const check = (name, cond, why) => (cond ? ok(name) : fail(name, why));

// 1. Version consistency
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const wf = read('.github/workflows/android-build.yml');
const wfVer = (wf.match(/APP_VERSION:\s*"([^"]+)"/) || [])[1];
const wfCode = (wf.match(/APP_VERSION_CODE:\s*"(\d+)"/) || [])[1];
check('package.json / lockfile / workflow versions match',
  pkg.version === lock.version && pkg.version === lock.packages[''].version && pkg.version === wfVer,
  `pkg=${pkg.version} lock=${lock.version} workflow=${wfVer}`);
check('versionCode is a positive integer', /^\d+$/.test(wfCode || '') && Number(wfCode) > 0, String(wfCode));

// 2. Capacitor config must load bundled assets only
const cap = read('capacitor.config.ts');
check('no server.url (app must not load a remote website)', !/^\s*url\s*:/m.test(cap));
check('appId unchanged (in.kumbhconnect.nashik)', /appId:\s*'in\.kumbhconnect\.nashik'/.test(cap));
check('cleartext traffic disabled', /cleartext:\s*false/.test(cap));
check('WebView debugging disabled', /webContentsDebuggingEnabled:\s*false/.test(cap));

// 3. JavaScript syntax (root scripts + inline scripts of every HTML page)
for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.js'))) {
  try { new vm.Script(read(f), { filename: f }); ok('syntax ' + f); } catch (e) { fail('syntax ' + f, e.message); }
}
for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html'))) {
  const html = read(f);
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type=["'](?!text\/javascript|module)[^"']*["'])[^>]*>([\s\S]*?)<\/script>/gi)];
  let bad = null;
  blocks.forEach((m, i) => { if (m[1].trim().length < 20) return; try { new vm.Script(m[1]); } catch (e) { bad = `block ${i}: ${e.message}`; } });
  check('inline scripts parse ' + f, !bad, bad);
}

// 4. Local file references exist (skips template-literal placeholders and URLs)
for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html'))) {
  const missing = [];
  for (const m of read(f).matchAll(/(?:src|href)=["']([^"'#?]+)/g)) {
    const ref = m[1];
    if (/^(https?:|\/\/|data:|mailto:|tel:|javascript:|whatsapp:|sms:|intent:)/.test(ref) || ref.includes('${')) continue;
    if (!exists(ref)) missing.push(ref);
  }
  check('local references resolve ' + f, missing.length === 0, missing.join(', '));
}

// 5. Play policy pages
const idx = read('index.html');
check('privacy-policy.html exists and is linked from the app', exists('privacy-policy.html') && /privacy-policy\.html/.test(idx));
check('delete-account.html exists and is linked from the app', exists('delete-account.html') && /delete-account\.html/.test(idx));
check('in-app account deletion present', /function deleteAccountNow/.test(idx));
check('privacy policy shows a "Last updated" date (en)', /Last updated/i.test(read('privacy-policy.html')));

// 6. No secrets shipped
const secretRe = /(sb_secret_|service_role|-----BEGIN (RSA |EC )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}.*client_secret)/;
const leaks = [];
for (const f of fs.readdirSync(ROOT).filter((n) => /\.(js|html|json|md|ts)$/.test(n))) {
  if (f === 'package-lock.json') continue;
  const t = read(f);
  const m = t.match(secretRe);
  // supabase-config.js mentions the words only in a warning comment
  // supabase-config.js (warning comment) and supabase-public-data.js (guard that REJECTS secret keys) only mention the words
  const guardFile = (f === 'supabase-config.js' && /NEVER put/.test(t)) || (f === 'supabase-public-data.js' && /indexOf\('sb_secret_'\)/.test(t));
  if (m && !guardFile) leaks.push(f + ':' + m[1]);
}
check('no private keys / service-role keys in shipped files', leaks.length === 0, leaks.join(', '));
check('keystore files are git-ignored', /\*\.jks/.test(read('.gitignore')) && /\*\.keystore/.test(read('.gitignore')));

// 7. Manifest + push safety
try { JSON.parse(read('manifest.json')); ok('manifest.json is valid JSON'); } catch (e) { fail('manifest.json', e.message); }
const native = read('kc-native.js');
check('push stays disabled until google-services.json is configured', /pushConfigured:\s*false/.test(native));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
