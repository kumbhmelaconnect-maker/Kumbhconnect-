import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

const out = path.join(root, 'www');

const excludedDirs = new Set([
  '.git',
  '.github',
  'node_modules',
  'android',
  'www',
  'twa',
  'supabase',
  'scripts'
]);

const excludedFiles = new Set([
  'package.json',
  'package-lock.json',
  'capacitor.config.ts',
  'capacitor.config.json',
  'README-ANDROID.md'
]);

const requiredFiles = [
  'index.html',
  'kc-native.js',
  'kc-native.css',
  'sw.js'
];

function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (
      from === root &&
      (excludedDirs.has(entry.name) || excludedFiles.has(entry.name))
    ) {
      continue;
    }

    if (
      entry.name === '.DS_Store' ||
      entry.name.endsWith('.zip')
    ) {
      continue;
    }

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

function validateRequiredFiles() {
  const missing = requiredFiles.filter(
    file => !fs.existsSync(path.join(out, file))
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required web assets in www/: ${missing.join(', ')}`
    );
  }
}

function validateNativeReferences() {
  const htmlPath = path.join(out, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const requiredReferences = [
    'kc-native.js',
    'kc-native.css'
  ];

  const missingReferences = requiredReferences.filter(
    file => !html.includes(file)
  );

  if (missingReferences.length > 0) {
    throw new Error(
      `index.html does not reference: ${missingReferences.join(', ')}`
    );
  }
}

try {
  // Rebuild only the generated www/ directory.
  // Original source files remain untouched.
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  copyTree(root, out);

  validateRequiredFiles();
  validateNativeReferences();

  console.log('Prepared local web assets successfully.');
  console.log(`Source: ${root}`);
  console.log(`Output: ${out}`);
  console.log('Verified required files:');

  for (const file of requiredFiles) {
    console.log(`  OK: ${file}`);
  }

  console.log('Verified index.html references kc-native.js and kc-native.css.');
  console.log('Original source files were not modified.');
} catch (error) {
  console.error('Failed to prepare web assets.');
  console.error(error.message);
  process.exitCode = 1;
}
