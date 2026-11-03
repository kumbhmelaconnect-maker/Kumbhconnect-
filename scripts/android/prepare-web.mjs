
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../..');
const OUTPUT = path.join(ROOT, 'www');

// Only root-level directories are excluded.
// The generated www directory must never be copied into itself.
const EXCLUDED_ROOT_DIRS = new Set([
  '.git',
  '.github',
  'node_modules',
  'android',
  'www',
  'twa',
  'supabase',
  'scripts'
]);

const EXCLUDED_ROOT_FILES = new Set([
  'package.json',
  'package-lock.json',
  'capacitor.config.ts',
  'capacitor.config.json',
  'README-ANDROID.md'
]);

const REQUIRED_FILES = [
  'index.html',
  'kc-native.js',
  'kc-native.css',
  'sw.js'
];

const REQUIRED_LOCAL_REFERENCES = [
  'kc-native.js',
  'kc-native.css'
];

function log(message) {
  console.log(`[prepare-web] ${message}`);
}

function assertSafeOutputPath() {
  const resolvedRoot = path.resolve(ROOT);
  const resolvedOutput = path.resolve(OUTPUT);

  if (
    resolvedOutput === resolvedRoot ||
    path.dirname(resolvedOutput) !== resolvedRoot ||
    path.basename(resolvedOutput) !== 'www'
  ) {
    throw new Error(
      `Unsafe output directory: ${resolvedOutput}`
    );
  }
}

function validateSourceFiles() {
  const missing = REQUIRED_FILES.filter(file => {
    const source = path.join(ROOT, file);

    return (
      !fs.existsSync(source) ||
      !fs.statSync(source).isFile()
    );
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required source files: ${missing.join(', ')}`
    );
  }

  log('All required source files exist.');
}

function shouldSkipEntry(entry, isRoot) {
  if (isRoot && entry.isDirectory()) {
    return EXCLUDED_ROOT_DIRS.has(entry.name);
  }

  if (isRoot && entry.isFile()) {
    return EXCLUDED_ROOT_FILES.has(entry.name);
  }

  if (entry.name === '.DS_Store') {
    return true;
  }

  if (
    entry.isFile() &&
    entry.name.toLowerCase().endsWith('.zip')
  ) {
    return true;
  }

  // Do not follow symlinks into locations outside the project.
  if (entry.isSymbolicLink()) {
    log(`Skipped symbolic link: ${entry.name}`);
    return true;
  }

  return false;
}

function copyTree(sourceDir, targetDir, isRoot = false) {
  const entries = fs.readdirSync(sourceDir, {
    withFileTypes: true
  });

  for (const entry of entries) {
    if (shouldSkipEntry(entry, isRoot)) {
      continue;
    }

    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });

      copyTree(source, target, false);
      continue;
    }

    if (entry.isFile()) {
      fs.copyFileSync(source, target);
    }
  }
}

function validateRequiredOutputFiles() {
  const missing = REQUIRED_FILES.filter(file => {
    const outputFile = path.join(OUTPUT, file);

    return (
      !fs.existsSync(outputFile) ||
      !fs.statSync(outputFile).isFile()
    );
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required web assets in www/: ${missing.join(', ')}`
    );
  }

  log('All required output files verified.');

  for (const file of REQUIRED_FILES) {
    log(`OK: www/${file}`);
  }
}

function extractLocalReferences(html) {
  const references = [];

  const tags = html.matchAll(
    /<(?:script|link)\b[^>]*>/gi
  );

  for (const match of tags) {
    const tag = match[0];

    const attributes = [
      ...tag.matchAll(
        /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
      )
    ];

    for (const attribute of attributes) {
      const value = attribute[1] ?? attribute[2];

      if (!value) {
        continue;
      }

      try {
        const url = new URL(
          value,
          'https://local.invalid/'
        );

        // Ignore external URLs and data URLs.
        if (url.origin !== 'https://local.invalid') {
          continue;
        }

        references.push(
          decodeURIComponent(url.pathname)
        );
      } catch {
        // Invalid references are ignored here.
        // Required references will fail validation below.
      }
    }
  }

  return references;
}

function validateNativeReferences() {
  const htmlPath = path.join(OUTPUT, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const references = extractLocalReferences(html);

  const missing = REQUIRED_LOCAL_REFERENCES.filter(file => {
    return !references.some(reference => {
      const normalized = path.posix.normalize(reference);

      return normalized === `/${file}`;
    });
  });

  if (missing.length > 0) {
    throw new Error(
      `index.html is missing required local references: ${missing.join(', ')}`
    );
  }

  log('Verified local references in index.html:');

  for (const file of REQUIRED_LOCAL_REFERENCES) {
    log(`OK: ${file}`);
  }
}

function prepareWebAssets() {
  assertSafeOutputPath();

  // Validate source BEFORE deleting the previous generated output.
  validateSourceFiles();

  // Rebuild only the generated www/ directory.
  // Original project source files remain untouched.
  fs.rmSync(OUTPUT, {
    recursive: true,
    force: true
  });

  fs.mkdirSync(OUTPUT, {
    recursive: true
  });

  copyTree(ROOT, OUTPUT, true);

  validateRequiredOutputFiles();
  validateNativeReferences();

  log('Web assets prepared successfully.');
  log(`Source: ${ROOT}`);
  log(`Output: ${OUTPUT}`);
  log('Original source files were not modified.');
}

try {
  prepareWebAssets();
} catch (error) {
  console.error('[prepare-web] FAILED');
  console.error(error.stack || error.message);

  process.exitCode = 1;
}
