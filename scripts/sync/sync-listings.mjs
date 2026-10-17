#!/usr/bin/env node
// CLI entry for the Firestore -> Supabase public listing sync.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (secrets, never printed);
//      optional SYNC_DRY_RUN, SYNC_ALLOW_MASS_DELETE, FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY.
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
  console.error(`sync failed: ${e && e.message ? e.message : 'unknown error'}`); // message only, no stack/config
  process.exit(1);
}
