#!/usr/bin/env node
// CLI entry for the Firestore -> Supabase public listing sync.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (secrets, never printed);
//      optional SYNC_DRY_RUN, SYNC_MASS_DELETE_CONFIRM (exact text DELETE), FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY.
//      In dry-run mode the Supabase variables are not required and not read.
import { appendFileSync } from 'node:fs';
import { runSync } from './lib.mjs';

try {
  const out = await runSync({ env: process.env });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Supabase listing sync\n- dry run: ${out.dryRun}\n- listings valid/skipped: ${out.listingsValid}/${out.listingsSkipped}\n` +
      `- reviews read: ${out.reviewsFetched}\n- result: ${out.result ? out.result.status : 'n/a'}\n`);
  }
} catch (e) {
  const msg = e && e.message ? e.message : 'unknown error';
  console.error(`sync failed: ${msg}`); // message only, no stack/config
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Supabase listing sync\n- FAILED: ${msg}\n- nothing was written to or deleted from Supabase\n`); } catch { /* ignore */ }
  }
  process.exit(1);
}
