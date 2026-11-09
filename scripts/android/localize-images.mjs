// Bundles every remote ImgBB image into the Android app (www/img/) so the app
// works offline and never depends on a third-party image host being up.
// Runs on www/ only; the source files (website/PWA) are not modified.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WWW = path.join(ROOT, 'www');
const OUT = path.join(WWW, 'img');
const URL_RE = /https:\/\/i\.ibb\.co\/[A-Za-z0-9]+\/[^\s"'`)<>\\]+/g;
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const MAX_BYTES = 8 * 1024 * 1024;

const log = (m) => console.log(`[localize-images] ${m}`);
const fail = (m) => { console.error(`::error::[localize-images] ${m}`); process.exit(1); };

if (!fs.existsSync(WWW)) fail('www/ not found - run prepare-web first.');

const files = fs.readdirSync(WWW)
  .filter((f) => /\.(html|js)$/i.test(f) && f !== 'sw.js')
  .map((f) => path.join(WWW, f));

const found = new Map(); // url -> local name
for (const f of files) {
  for (const u of fs.readFileSync(f, 'utf8').match(URL_RE) || []) found.set(u, null);
}
log(`${found.size} unique ImgBB URL(s) in ${files.length} file(s).`);
if (found.size === 0) process.exit(0);

fs.mkdirSync(OUT, { recursive: true });

async function download(url) {
  let last;
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/')) throw new Error(`not an image (${type || 'no content-type'})`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length === 0) throw new Error('empty body');
      if (buf.length > MAX_BYTES) throw new Error(`too large (${buf.length} bytes)`);
      return { buf, type };
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 800 * i)); }
  }
  throw last;
}

const used = new Set();
for (const url of found.keys()) {
  const [, id, rest] = url.match(/i\.ibb\.co\/([A-Za-z0-9]+)\/(.+)$/);
  const { buf, type } = await download(url).catch((e) => fail(`download failed: ${url} (${e.message})`));
  let base = decodeURIComponent(rest).replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'img';
  const name = `${id}-${base}${EXT[type] || path.extname(rest) || '.jpg'}`;
  if (used.has(name)) fail(`name collision: ${name}`);
  used.add(name);
  fs.writeFileSync(path.join(OUT, name), buf);
  found.set(url, `img/${name}`);
  log(`${name}  ${(buf.length / 1024).toFixed(0)} KB`);
}

let rewritten = 0;
for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  const n = t.replace(URL_RE, (u) => { rewritten++; return found.get(u); });
  if (n !== t) fs.writeFileSync(f, n);
}

const left = files.filter((f) => /https:\/\/i\.ibb\.co\//.test(fs.readFileSync(f, 'utf8')));
if (left.length) fail(`ImgBB URLs still present in: ${left.map((f) => path.basename(f)).join(', ')}`);
log(`Done: ${rewritten} reference(s) rewritten, ${used.size} image(s) bundled.`);
