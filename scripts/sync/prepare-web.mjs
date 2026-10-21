import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'www');
const excludedDirs = new Set([
  '.git', '.github', 'node_modules', 'android', 'www', 'twa', 'supabase', 'scripts'
]);
const excludedFiles = new Set([
  'package.json', 'package-lock.json', 'capacitor.config.ts', 'capacitor.config.json',
  'README-ANDROID.md'
]);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (from === root && (excludedDirs.has(entry.name) || excludedFiles.has(entry.name))) continue;
    if (entry.name === '.DS_Store' || entry.name.endsWith('.zip')) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyTree(source, target);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, target);
    }
  }
}
copyTree(root, out);
if (!fs.existsSync(path.join(out, 'index.html'))) {
  throw new Error('index.html was not copied into www/');
}
console.log('Prepared local web assets in www/; original website files were not modified.');
