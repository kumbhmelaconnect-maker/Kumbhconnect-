/* Supabase PUBLIC configuration. Safe to ship: the publishable key is designed to be public and
   is limited by Row Level Security (read-only access to approved listings). NEVER put a
   service-role / secret key (sb_secret_... or a JWT with role service_role) in this file. */
window.KC_SUPABASE_CONFIG = Object.freeze({
  url: 'https://pocjvxyhrnvrmwmytcbv.supabase.co',
  publishableKey: 'sb_publishable_jH759gXWOGxEqEGTm5_7oQ_cFKJgvKz',
  enabled: false,        // MASTER SWITCH. Leave false until the migration is applied and a sync has run.
  rolloutPercent: 0,     // 0..100: share of devices that use Supabase once `enabled` is true
  timeoutMs: 8000
});
