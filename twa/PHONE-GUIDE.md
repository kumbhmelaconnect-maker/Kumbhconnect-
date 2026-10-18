# Android-phone guide (GitHub mobile site or app)

Nothing below publishes anything. Use the GitHub website in your phone browser ("Desktop site" helps for Settings).
Keystore creation needs a computer (Termux can also run `keytool` but is NOT VERIFIED here).

## A. One-time setup
1. Repo > Settings > Secrets and variables > Actions > **Variables** > New repository variable:
   - `TWA_BUBBLEWRAP_VERSION` = exact version (e.g. `1.24.1` — check the npm page of @bubblewrap/cli first; prefer a release older than 14 days)
2. Commit the new workflow and `twa/generate-project.mjs` yourself (this package did not commit anything).

## B. Probe run (no secrets, no key)
1. Repo > **Actions** > "Build TWA ..." > **Run workflow**.
2. Choose `mode = probe`, `generation = update`, leave the rest. Run.
3. Open the run > **Summary**: read `bubblewrap doctor`, "Manifest fields intact", and the list of files from the unsigned build.
4. If "Generate Android project" failed, run again with `generation = core-api`. If both fail, send me the log text of the failed step.

## C. Before a signed build (owner decisions)
1. Confirm the package ID `in.kumbhconnect.nashik`; then add variable `TWA_PACKAGE_ID_CONFIRMED` = `true`.
2. Create the keystore on a computer: `keytool -genkeypair -v -keystore upload.keystore -alias <alias> -keyalg RSA -keysize 2048 -validity 10000`
   Back it up offline. Never commit it.
3. Add **Secrets**: `TWA_KEYSTORE_BASE64` (`base64 -w0 upload.keystore`), `TWA_KEYSTORE_PASSWORD`, `TWA_KEY_PASSWORD`.
4. Add variable `TWA_KEY_ALIAS` = your alias.

## D. Signed build
1. Actions > Run workflow > `mode = build`, `version_code` higher than any released build, `version_name` e.g. `1.0.0`, `upload_artifact` = off (repo is public).
2. A green run's Summary shows SHA-256 of the APK/AAB and the certificate fingerprint. The files exist only on the runner unless you tick `upload_artifact` (3 days, downloadable by any signed-in GitHub user).

## E. Digital Asset Links (needed for full-screen TWA, not for the build)
Android checks `https://kumbhmelaconnect-maker.github.io/.well-known/assetlinks.json` (host root). This repo is served under `/Kumbhconnect-/`, so a file here cannot satisfy it. Options: a separate user-site repo named `kumbhmelaconnect-maker.github.io` containing `.well-known/assetlinks.json` (+ `.nojekyll`), or a custom domain. Use the real fingerprint from step D, and Indus's certificate instead if Indus re-signs (NOT VERIFIED). Do not publish `assetlinks.template.json`.
