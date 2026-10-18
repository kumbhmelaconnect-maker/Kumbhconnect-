KumbhConnect TWA preparation — target: Indus Appstore
Status: configuration prepared. NO APK/AAB has been built. Digital Asset Links is NOT VERIFIED. Nothing here deploys the website, publishes to any store, or touches Firebase/Supabase.
Files
twa/twa-manifest.json — Bubblewrap config. packageId is a PROPOSAL (in.kumbhconnect.nashik).
twa/validate-twa.mjs — static checks. node twa/validate-twa.mjs (add --strict for release builds).
twa/assetlinks.template.json — template only; contains a placeholder; never publish as-is.
.github/workflows/twa-build.yml — manual workflow producing a signed APK and AAB. No store publishing.
.gitignore — keeps keystores, APK/AAB and Gradle output out of git.
URLs (GitHub Pages project site)
Origin https://kumbhmelaconnect-maker.github.io, path prefix /Kumbhconnect-/. startUrl /Kumbhconnect-/index.html, scope https://kumbhmelaconnect-maker.github.io/Kumbhconnect-/, web manifest and icons under the same prefix. validate-twa.mjs checks these against manifest.json.
1. Package ID (owner decision)
No Android application ID exists anywhere in this repository. in.kumbhconnect.nashik is valid reverse-domain syntax but is only a proposal: repository inspection cannot show whether anyone else uses it, and it implies control of kumbhconnect.in (not verified). After approval set repository variable TWA_PACKAGE_ID_CONFIRMED=true; strict mode and the workflow refuse to run otherwise. If you change the ID, edit twa-manifest.json and assetlinks.template.json together. Treat it as permanent once users install it.
2. Digital Asset Links — blocking issue
Chrome reads https://kumbhmelaconnect-maker.github.io/.well-known/assetlinks.json (origin root). A project-site repo is served under /Kumbhconnect-/, so .well-known/ inside this repo is served at /Kumbhconnect-/.well-known/assetlinks.json, which Chrome does not use. Options (none done for you):
Create a user-site repo kumbhmelaconnect-maker.github.io containing .well-known/assetlinks.json plus an empty .nojekyll. Requires your authorization; the project site stays unchanged.
Use a custom domain, then update host and every URL in twa-manifest.json. Until the file is live with the real package ID and fingerprint, the app opens with a browser address bar (NOT VERIFIED). Verify with Google's Digital Asset Links statement list API and on a real device.
3. Signing and fingerprint (never invent one)
Create the keystore on YOUR machine and back it up (a lost key can block updates): keytool -genkeypair -v -keystore upload.keystore -alias <alias> -keyalg RSA -keysize 2048 -validity 10000 Fingerprint: keytool -list -v -keystore upload.keystore -alias <alias> -> SHA256 line. Use that value in assetlinks.json ONLY if the app is distributed with that same certificate. If Indus re-signs apps with its own key, use the certificate Indus reports instead. Whether Indus re-signs is NOT VERIFIED here. Keep the same key if you also distribute through other channels, otherwise users cannot update across stores.
4. Secrets, variables and version inputs (Settings > Secrets and variables > Actions)
Secrets: TWA_KEYSTORE_BASE64 (base64 -w0 upload.keystore), TWA_KEYSTORE_PASSWORD, TWA_KEY_PASSWORD. Variables: TWA_KEY_ALIAS, TWA_BUBBLEWRAP_VERSION (exact x.y.z you tested), TWA_ANDROID_PLATFORM (e.g. android-NN) and TWA_BUILD_TOOLS (e.g. NN.N.N) — choose values supported by that Bubblewrap version (read its release notes; they are intentionally not guessed here), TWA_PACKAGE_ID_CONFIRMED=true. Run inputs: version_code (integer, higher than every build already released) and version_name. They override appVersionCode/appVersionName in a temporary copy, so each release only needs new inputs; commit the checked-in values only when you want to change the defaults. Repo is public: leave upload_artifact false unless you accept that signed builds are downloadable by any signed-in GitHub user.
5. Build process (manual workflow, nothing is published)
No Android project is committed. Steps: set paths -> check secrets/variables by name -> Node 20 + JDK 17 -> static validation -> accept SDK licenses, install the pinned platform and build-tools, verify with sdkmanager --list_installed -> decode keystore outside the workspace and verify it opens -> write a resolved manifest to a persistent build directory and run validate-twa.mjs --strict -> install the pinned Bubblewrap and write ~/.bubblewrap/config.json -> probe step (help for init/update/build must list --manifest and --skipVersionUpgrade) -> bubblewrap update --skipVersionUpgrade in the build directory (generates the project from ./twa-manifest.json; the step then fails if gradlew, build.gradle or app/build.gradle are missing) -> bubblewrap build -> verify app-release-signed.apk (apksigner) and app-release-bundle.aab (zip, BundleConfig.pb, jarsigner). NOT VERIFIED (no network here to read the pinned version's docs or run it): that update can generate the project in an empty directory, the exact flags, the output file names, and the SDK package names Bubblewrap requires. If the first run fails at generation, run bubblewrap init --manifest=<web manifest URL> locally once, compare its twa-manifest.json with ours, and fix the workflow — do not weaken any check.
6. Indus Appstore (see REPORT.md)
Accepted format and metadata rules are NOT VERIFIED against official Indus documentation. Prepare the APK and AAB, then follow the requirements shown in the Indus developer console.
7. Deliberately not enabled
Notification delegation (enableNotifications:false): no push-token or push-subscription code found.
Location delegation: the web app uses navigator.geolocation; test on a device before enabling.
8. Maskable icon (resolved)
icon-maskable-512.png and -192.png were inspected: all artwork lies within radius 135 of the 205 px maskable safe zone (512 px file) on a full-bleed white background, so they suit maskable use. manifest.json now declares both with "purpose":"maskable". Effect: Android can apply adaptive-icon masks to the installed PWA icon. The TWA launcher icon is set separately by maskableIconUrl. The service worker precache list (sw.js) is unchanged and does not include the new icons; they load from the network.
9. Manual deployment order (owner)
Review the diff, commit and push the new files and manifest.json yourself.
Confirm https://kumbhmelaconnect-maker.github.io/Kumbhconnect-/manifest.json shows the maskable entries.
Set secrets/variables, run the workflow manually, test the APK on a device.
Host assetlinks.json at the origin root with the real fingerprint, then re-test.
