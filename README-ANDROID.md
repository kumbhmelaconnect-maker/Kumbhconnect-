# KumbhConnect Android — initial Capacitor scaffold

## What this scaffold does
- Adds a Capacitor Android build path without replacing the existing PWA/TWA files.
- Bundles the existing site files locally into `www/` at build time.
- Provides a manual GitHub Actions workflow to produce a **debug APK** for device testing.
- Uses the existing application id `in.kumbhconnect.nashik` as a starting point; verify package ownership and signing before any release.

## What it does NOT do yet
- This is not a finished native Android UI and does not, by itself, solve the Indus Appstore rejection.
- It does not add new native features, push notifications, location permissions, or a native dashboard.
- It does not sign a release APK/AAB and is not ready for store submission.
- It does not deploy the website, modify Firebase/Firestore Rules, change Supabase, edit `Code.gs`, or publish anything.

## Build from GitHub on mobile
1. Upload/commit these changes to a **new development branch** only after reviewing the diff.
2. In GitHub, open **Actions** → **KumbhConnect Android Debug Build** → **Run workflow**.
3. Download the `kumbhconnect-android-debug-apk` artifact after the workflow succeeds.
4. Install it on a test phone and test sign-in, maps, SOS, complaints, service requests, provider flows and reviews.

## Important follow-up work
1. Audit all app flows in bundled/local mode; external URL assumptions and OAuth redirect URLs may need Android-specific handling.
2. Design and implement an Android-focused home/dashboard and genuine native integrations where useful.
3. Test Firebase Auth persistence and Google sign-in redirects on Android.
4. Configure app icons, splash screen, back-button behavior and permission explanations.
5. Create a release signing setup using GitHub Secrets (never commit signing keys or passwords).
6. Generate and test a signed release APK/AAB only after user approval.

## Safety boundary
The workflow is manual (`workflow_dispatch`) and only builds a debug APK. No production deployment is performed.
