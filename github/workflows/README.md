# Supabase public-listing replica — setup

Firebase stays the source of truth (Auth, writes, approvals, SOS, grievances, users). Supabase holds a
**read-only, approved-only** copy of `kc_listings` plus rating aggregates computed from `kc_reviews`.
Project: `pocjvxyhrnvrmwmytcbv` (`https://pocjvxyhrnvrmwmytcbv.supabase.co`).

## 1. Apply the migration (nothing has been applied for you)
- Preferred (works from Android/Termux, no CLI needed): Dashboard → SQL Editor → paste `supabase/migrations/20261013120000_public_listings.sql` → Run.
- Optional CLI route only from a supported Linux/macOS/CI environment: `supabase link --project-ref pocjvxyhrnvrmwmytcbv && supabase db push`.
- Before running: `select to_regclass('public.public_listings');` must return NULL (the migration uses `create ... if not exists` and would silently skip a pre-existing table of the same name).
- Rehearse on a non-production project/branch first. `policy_checks.sql` rolls back, but it deletes and re-inserts rows inside its transaction.
Then run `supabase/tests/policy_checks.sql` (rolls back; expect `ALL POLICY CHECKS PASSED`).
Also confirm in Dashboard → API that `public` is an exposed schema and that Data API access is enabled.

## 2. GitHub configuration (repo → Settings → Secrets and variables → Actions)
| Kind | Name | Value |
|---|---|---|
| Secret | `SUPABASE_URL` | `https://pocjvxyhrnvrmwmytcbv.supabase.co` |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | the **service_role / secret** key (Dashboard → Settings → API Keys). Never the publishable key. |
| Variable (optional) | `FIREBASE_PROJECT_ID` | defaults to `kumbh-connect-e308e` |
| Variable (optional) | `SUPABASE_SYNC_SCHEDULE_ENABLED` | `true` to enable the 6-hourly schedule; otherwise manual only |

No Firebase credential is needed: the sync reads only what `firestore.rules` already makes public.
If you later enforce App Check on Firestore, the unauthenticated read will fail (sync fails closed; nothing is deleted).

## 3. First run
Actions → "Sync public listings to Supabase" → Run workflow with **dry_run = true** (validates Firestore reads, no Supabase
contact), then again with dry_run = false. Check `select count(*) from public_listings;`.
If a run reports "mass-delete guard", inspect why before re-running with `confirm_mass_delete` = `DELETE`.

## 4. Enable in the app (gradual)
Copy the repo-root `index.html` (authoritative; already contains the Supabase script tags and the three feature-flagged call sites; the old `patches/supabase-index_sos-fix.patch` is NOT needed and must not be applied) together with `supabase-config.js` and `supabase-public-data.js` into the same directory as your live `index.html`, (no sw.js change is required: v8 serves same-origin JS network-first and never intercepts supabase.co; a cache-version bump is optional).
- Default: `enabled:false` → app behaves exactly as before.
- Test on one device: `localStorage.setItem('kc_supabase','on')` (`'off'` to force off).
- Roll out: set `enabled:true` and `rolloutPercent` 5 → 25 → 100. Kill switch: `enabled:false`.
Any Supabase error, timeout, or empty answer falls back to the existing Firestore query.

## Known behaviour differences when Supabase is on
- Map popups show no phone number (phone is deliberately not replicated). The requester contact card still reads Firestore.
- Ratings can lag by up to one sync interval; Firestore remains authoritative.
- If ANY approved listing fails validation (e.g. over-length field) the whole sync aborts before touching Supabase and logs the listing id; fix the listing in Firestore. The replica keeps its previous state meanwhile.
