#!/usr/bin/env node
// FALLBACK project generator. Used only when the workflow input generation=core-api is chosen.
// Run it INSIDE the build directory that already contains the resolved twa-manifest.json.
// STATUS: NEVER RUN against Bubblewrap. It mirrors what `bubblewrap init` does according to Bubblewrap's init.ts on main
// (TwaGenerator.createTwaProject, then a manifest checksum file). Signatures TwaManifest.fromFile(file): Promise and
// TwaGenerator.createTwaProject(dir, manifest, log) were seen in @bubblewrap/core 1.23.0 type definitions only; the pinned
// version is chosen by the owner and may differ. The script checks the exports at run time and fails if they are missing.
// The checksum (SHA-1 hex of the manifest text) is from a third-party report about 1.25.0, not from Bubblewrap docs.
// Generation also downloads the web manifest/icons from the live site (network required).
// It never reads secrets and never prints environment variables.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = process.cwd();
const manifestPath = resolve(dir, 'twa-manifest.json');
if (!existsSync(manifestPath)) { console.error('twa-manifest.json not found in ' + dir); process.exit(1); }

const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
const cliPkg = join(globalRoot, '@bubblewrap', 'cli', 'package.json');
if (!existsSync(cliPkg)) { console.error('Global @bubblewrap/cli not found under ' + globalRoot); process.exit(1); }
const req = createRequire(cliPkg);
const core = req('@bubblewrap/core');
for (const n of ['TwaManifest', 'TwaGenerator', 'ConsoleLog']) {
  if (!core[n]) { console.error('@bubblewrap/core does not export ' + n + ' in this version'); process.exit(1); }
}

const twaManifest = await core.TwaManifest.fromFile(manifestPath);
await new core.TwaGenerator().createTwaProject(dir, twaManifest, new core.ConsoleLog('generate-project'));

// createTwaProject may re-save twa-manifest.json; hash whatever is on disk now, as that is what `build` will hash.
const bytes = readFileSync(manifestPath);
writeFileSync(join(dir, 'manifest-checksum.txt'), createHash('sha1').update(bytes).digest('hex'));
console.log('Project generated via @bubblewrap/core; manifest-checksum.txt written.');
