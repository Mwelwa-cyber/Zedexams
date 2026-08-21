# Android release workflow

ZedExams ships as a Capacitor Android wrapper that loads bundled web
assets from `dist/`. Every web change requires a fresh APK build +
redistribution — there's no live-update path today (see the "Future
options" section for hybrid models like Capacitor Live Updates).

**Recommended path:** push a `v*.*.*` tag and let GitHub Actions build
and distribute the APK for you. See "Releasing via CI" below.

This doc also walks through the local-build flow for both debug (sideload
to your own phone) and release (signed, Play Store / wider distribution).

---

## Quick reference

| Goal | Command |
|------|---------|
| Debug APK for your own phone | `npm run android:apk:debug` |
| Release APK (signed)         | `npm run android:apk:release` (see env vars below) |
| Install on connected device  | `adb install -r android/app/build/outputs/apk/<variant>/app-<variant>.apk` |

Output paths:
- Debug:   `android/app/build/outputs/apk/debug/app-debug.apk`
- Release: `android/app/build/outputs/apk/release/app-release.apk`

---

## versionCode + versionName

Android **refuses to install an APK as an update unless `versionCode` is strictly greater** than the version already on the device. The most common "my new APK won't install" symptom is a forgotten versionCode bump.

`android/app/build.gradle` resolves both values in this order:

1. **`ZED_VERSION_CODE` env var** (manual override, e.g. CI build number).
2. **Git commit count** — `git rev-list --count HEAD`. Every commit produces a new monotonically-increasing number, so a fresh local debug build always installs cleanly without manual bumping.
3. **Hardcoded `3`** — fallback for shallow clones / tarball builds.

`versionName` is the human-readable string shown in Play Store. Same env-var override (`ZED_VERSION_NAME`); falls back to `"1.1.1"`.

Gradle prints the resolved values at the start of every build:

```
ZedExams Android — versionCode=42, versionName=1.1.1
```

Verify before installing.

---

## Release hardening

The release build is locked down in two places. Both are pinned by
`scripts/test-android-release-config.mjs` (runs in `npm run test:all`), so a
Capacitor re-sync or a manifest cleanup can't silently revert them without
turning CI red.

- **Backups off** — `android/app/src/main/AndroidManifest.xml` sets
  `android:allowBackup="false"`. This is a school app used by minors and there
  is no restore story worth keeping: the only device-local state is the
  Firebase auth token and the Firestore offline cache, both of which rehydrate
  from the server on the next sign-in. Auto Backup / key-value backup would
  otherwise copy those tokens and any cached learner data into a Google cloud
  backup.
- **R8 shrink + obfuscate** — `android/app/build.gradle`'s `release` build type
  sets `minifyEnabled true` + `shrinkResources true` with
  `proguard-android-optimize.txt` and the app-level `proguard-rules.pro`. The
  keep rules that make the minified build shippable live in
  `proguard-rules.pro`: `@JavascriptInterface` methods are kept (stripping them
  severs the Capacitor WebView bridge), `-dontwarn com.facebook.**` lets R8
  finish (the disabled Facebook auth provider is traced but never run), and
  `SourceFile`/`LineNumberTable` are kept + renamed so Play Console crash
  traces stay retraceable via `app/build/outputs/mapping/release/mapping.txt`.

The minified build itself is exercised end-to-end by the
`android-release.yml` (`assembleRelease`) and `android-play-release.yml`
(`bundleRelease`) workflows on a `v*.*.*` tag push — the node CI job has no
Android SDK, so R8 only actually runs there.

---

## Downloads go to the phone, not to a share sheet

Tapping **Download** on a lesson plan or weekly focus used to open the system
share sheet — a grid of WhatsApp contacts, Bluetooth and Huawei Share — and
leave nothing in the phone's storage. The only copy written was in app-private
cache, somewhere the teacher could not reach and the OS deletes at will.
Sharing is a different intention from saving, and the button says download.

`android/app/src/main/java/com/zedexams/android/DownloadsPlugin.java` is the
app-local Capacitor plugin that fixes it. It writes the full bytes into the
phone's **public Downloads folder**, where Files, Word and every other app can
see the document under its real name.

- **Why a custom plugin.** `@capacitor/filesystem`'s own definitions say
  `Directory.Documents` / `Directory.ExternalStorage` are unreachable on
  Android 10 without legacy storage, and that on Android 11+ an app sees only
  files it created. Under scoped storage **MediaStore is the only supported way
  into the shared Downloads collection**, and that plugin does not expose it.
- **Two write paths, split at Android 10 (API 29).** API 29+ inserts into
  `MediaStore.Downloads` — no permission at all, because an app may always
  contribute to a shared collection. API 24-28 (minSdk is 24) writes to the
  legacy public directory, which needs `WRITE_EXTERNAL_STORAGE` at runtime plus
  a `MediaScannerConnection.scanFile` poke, or the saved file stays invisible to
  Files until the next scan.
- **The manifest permission is capped at `maxSdkVersion="28"`, and the cap is
  the point.** An uncapped `WRITE_EXTERNAL_STORAGE` would ask every modern
  device for broad storage access the app never uses — the kind of over-request
  Play flags on a Families-policy listing.
- **The insert is `IS_PENDING` until the last byte lands.** A failure part-way
  through can then never leave a truncated `.docx` sitting in Downloads looking
  like a finished file; the pending row is deleted instead.
- **R8 needs no new keep rule.** `@capacitor/android`'s consumer rules already
  carry `-keep public class * extends com.getcapacitor.Plugin { *; }`, which
  covers the private `@PermissionCallback` method R8 would otherwise strip as
  uncalled (it is invoked reflectively, by the name string passed to
  `requestPermissionForAlias`). Verify this before adding a plugin that is *not*
  a public `Plugin` subclass.
- **The fallback is the old behaviour, deliberately.** `Capacitor.Plugins
  .ZedDownloads` is absent from any APK built before this landed, and the plugin
  rejects when a pre-Android-10 user denies the storage permission. In both
  cases `src/utils/nativeDownload.js` falls back to cache + share, so the worst
  case of the change is yesterday's behaviour rather than a teacher who cannot
  get the document out of the app at all.

**Adding the Java file is not enough.** The plugin only reaches a device after
`npx cap sync android` and a fresh build (`npm run android:apk:debug`), and no
required CI check compiles the Android project — dispatch
`android-debug-apk.yml` to verify a change here.

Web and mobile-web downloads are the other half of the same fix and live in
`src/utils/saveBlob.js`; `npm run test:android-downloads` pins both sides
together (plugin declared, registered, permission scoped, and the JS calling the
name the plugin actually publishes).

---

## Crash + ANR reporting (Firebase Crashlytics)

Added 2026-08-16. **Sentry does not cover this and cannot be made to.**
`src/utils/sentry.js` runs inside the WebView and sees JavaScript errors; the
two failure classes that decide a new Play Store listing's fate are a native
crash in the wrapper/plugin layer and an ANR, where the platform kills the
process and no JS handler ever runs. Crashlytics is the only thing in the build
that observes those, and Play Console vitals grade the listing on them.

Three pieces. The two versions live in **different files, and must**:

| Piece | Where | Version pinned in | Job |
|---|---|---|---|
| `firebase-crashlytics-gradle` classpath | `android/build.gradle` `buildscript` | **hardcoded literal, same file** | uploads the R8 mapping file so release traces symbolicate |
| `firebase-crashlytics` SDK | `android/app/build.gradle` dependencies | `android/variables.gradle` | reports; self-registers, no init code |
| `apply plugin: 'com.google.firebase.crashlytics'` | `android/app/build.gradle` | — | activates the upload |

Three things about the wiring are deliberate and easy to "tidy" into a bug:

- **The plugin version is a hardcoded literal and cannot be moved into
  `variables.gradle`.** Gradle evaluates `buildscript {}` *before* the rest of
  the script — before `apply from: "variables.gradle"` runs, and regardless of
  whether that line sits above or below the block — so `rootProject.ext` does
  not exist yet and `classpath "...:$someVersion"` fails configuration outright
  with *"Could not get unknown property"*. This shipped broken exactly that way
  on 2026-08-16 and was caught only by the post-merge build on `main`.
  `scripts/test-android-buildscript-versions.mjs` (`test:android-buildscript-versions`,
  runs in `test:all` on every PR) now fails if any version in that block becomes
  a variable. Module-level dependencies in `app/build.gradle` are evaluated
  later and *do* read `variables.gradle` — that half is fine, and is where the
  SDK version lives.

- **The plugin is applied INSIDE the existing `google-services.json`
  conditional, after `google-services`.** It reads the Firebase application id
  that `google-services` generates, so applying it unconditionally turns "no
  `google-services.json`" from a warning that still builds — the documented
  behaviour of `android-debug-apk.yml` when the `GOOGLE_SERVICES_JSON` secret
  is unset — into a hard build failure. Both release workflows *refuse* to
  build without the file, so release artifacts always get Crashlytics, which is
  what matters: the release build is the minified one that needs the mapping
  upload.
- **The SDK dependency is unconditional.** Without `google-services.json`
  Firebase simply fails to initialise and Crashlytics stays dormant, exactly as
  the three `@capacitor-firebase/*` plugins already in this APK behave, so a
  developer build with no secret still compiles and runs.

`proguard-rules.pro` already keeps `SourceFile`/`LineNumberTable` (see Release
hardening above), which is what preserves line numbers in a symbolicated trace
— Crashlytics needs both that and the mapping upload, not either alone.

**No user identifier is attached.** `setUserId` is never called, so a report is
a stack trace plus device metadata. That is consistent with the
children's-privacy posture that keeps PostHog on `identify: false` for
learners; do not add it without revisiting that policy.

**Verifying it.** There is no Android SDK in the node CI job, so nothing on a
pull request compiles this. `android-debug-apk.yml` runs on push to `main` for
`android/**` paths, and can be dispatched against a branch from the Actions tab
— do that before merging a change to these files, or the first signal is a red
build on `main`. Reports land in Firebase Console → Crashlytics; the first one
appears only after a real crash on a device running a build that carries a
valid `google-services.json`.

---

## Releasing via CI (recommended)

The `.github/workflows/android-release.yml` workflow builds a **signed
release APK** and pushes it to Firebase App Distribution. It is the only
supported way to ship the APK to testers — the older `beta/**` branch
trigger has been retired.

### Cutting a release

From a clean `main`:

```bash
git checkout main && git pull
git tag v1.1.2          # SemVer; must match the pattern v*.*.*
git push origin v1.1.2
```

That tag push triggers the workflow. About 8–12 minutes later the new
APK lands in **Firebase App Distribution → testers**. Testers get an
email and the in-app prompt.

You can also trigger the workflow manually from **GitHub → Actions →
Android Release (App Distribution) → Run workflow** if you need a
hotfix build off the current `main` without bumping the tag. The
manual dispatch uses `versionName` from `build.gradle`'s default
(`1.1.1`) — prefer tagging.

### One-time GitHub Actions secret setup

Before the first tag push, add these eight secrets at **GitHub →
Settings → Secrets and variables → Actions** (the first four exist
already from the previous workflow; the last four are new):

| Secret | Source |
|--------|--------|
| `FIREBASE_DEPLOY_SERVICE_ACCOUNT_JSON` | already set — the same key `deploy-firebase.yml` and `deploy-hosting.yml` use. `roles/firebase.admin` on that account is a strict superset of `roles/firebaseappdistro.admin`, so no extra grant is needed. Override with `FIREBASE_APPDIST_SERVICE_ACCOUNT_JSON` only if you want a dedicated, narrower identity. |
| `FIREBASE_ANDROID_APP_ID` | Firebase Console → Project Settings → Your apps → Android |
| `VITE_FIREBASE_*` | same values used by `deploy-hosting.yml` |
| `ZED_RELEASE_KEYSTORE_BASE64` | **base64 of your `zedexams-release.keystore` file** — see below |
| `ZED_RELEASE_STORE_PASSWORD` | keystore password |
| `ZED_RELEASE_KEY_ALIAS` | key alias inside the keystore (typically `zedexams`) |
| `ZED_RELEASE_KEY_PASSWORD` | password for that key |

Generate `ZED_RELEASE_KEYSTORE_BASE64`:

```bash
# Linux / macOS
base64 -w 0 zedexams-release.keystore | pbcopy   # macOS clipboard
base64 -w 0 zedexams-release.keystore             # Linux — print to stdout
```

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("M:\Claude\zedexams.com\zedexams-release.keystore")) | Set-Clipboard
```

Paste that single-line base64 string into the secret value. The
workflow validates the decoded file is at least 256 bytes, so a
truncated paste fails fast with a clear error.

If you don't have a `zedexams-release.keystore` yet, create one
following the `keytool` instructions in [One-time keystore
setup](#one-time-keystore-setup) below. The same keystore is used by
both local `npm run android:apk:release` builds and the CI workflow —
keep the file *and* the passwords in a password manager. **If you lose
either, Play Store will require a new app listing.**

### Migrating testers from the old debug APK

The old `android-beta.yml` workflow built **debug-signed** APKs. Your
new release APK is signed with a **different keystore**, so Android
will refuse to update existing installs with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match`.

Tell testers to **uninstall the current ZedExams app once**, then
install the new build from the Firebase App Distribution invite. After
this one-time migration, every future release will update cleanly
because they're all signed with the same release keystore.

### What the workflow produces

- **Firebase App Distribution release** for the `testers` group (or
  whatever you set in `vars.APP_DISTRIBUTION_GROUPS`).
- **Workflow artifact** `app-release-<tag>-<sha>.apk`, retained for 30
  days — useful if you want to manually distribute the same APK
  elsewhere (Drive, WhatsApp, internal Play track).
- **Console log** showing `versionCode=<n>, versionName=<tag without v>`
  and the keystore certificate from `apksigner verify` — both make it
  obvious that the build went through.

---

## Releasing to Google Play (AAB)

Play Console needs an **`.aab`** (Android App Bundle), not an APK, for its
internal / closed / production tracks. The `android-play-release.yml` workflow
builds a signed AAB.

**Two ways to run:**

**A) Tag → auto-release to testers (the shortcut).** Push a SemVer tag; CI builds
and publishes to the **internal** track as a **live** release, `versionName` from
the tag — testers get it automatically:

```bash
git tag v1.1.2 && git push origin v1.1.2
```

(A tag also triggers `android-release.yml`'s Firebase App Distribution build, so
both run. If you'd rather Play be the sole tester channel, drop the tag trigger
from that workflow.)

**B) Manual — GitHub → Actions → Android Play Release (AAB) → Run workflow.** Inputs:
- `version_name` — e.g. `1.1.2` (blank = `build.gradle` default). `versionCode` is
  always the git commit count and must be **strictly higher** than your last upload.
- `upload_to_play` — **false** = just produce the downloadable `.aab`; **true** = publish.
- `track` — `internal` / `alpha` / `beta` / `production`.
- `release_status` — `draft` (upload only, you roll out) or `completed` (live to that track).
- `user_fraction` — **production** staged rollout, e.g. `0.1` = 10% (blank = full;
  when set, the release publishes as `inProgress`).

**Ship to production:** Run workflow → `upload_to_play=true`, `track=production`,
`release_status=completed` (add `user_fraction=0.1` for a staged 10% rollout).

The signed AAB is always attached as the `app-release-aab-run<N>` artifact
(30-day retention). The "Verify AAB signature" step prints the signer
certificate — it must match **Play → App integrity → Upload key certificate**.

### Building the AAB locally instead

```powershell
$env:ZED_RELEASE_STORE_FILE      = "M:\Claude\zedexams.com\zedexams-release.keystore"
$env:ZED_RELEASE_STORE_PASSWORD  = "<store password>"
$env:ZED_RELEASE_KEY_ALIAS       = "zedexams"
$env:ZED_RELEASE_KEY_PASSWORD    = "<key password>"
npm run build; npx cap sync android; cd android; .\gradlew bundleRelease
# Output: android\app\build\outputs\bundle\release\app-release.aab
```

### Auto-upload to Play (already configured)

> Snapshot as of 2026-06-08 — verify before acting. Auto-upload is **live**: the
> `firebase-deploy@examsprepzambia.iam.gserviceaccount.com` service account is
> granted "Release to testing tracks" and its key is stored in the
> `PLAY_SERVICE_ACCOUNT_JSON` secret. The steps below are for reference / rotation.

To (re)configure the Play service account:

1. Google Play Console → **Users and permissions** → invite a service account
   and grant it **Release to testing tracks** (plus Production if desired).
2. In Google Cloud Console, create a **JSON key** for that service account.
3. Add the entire JSON as the GitHub Actions secret **`PLAY_SERVICE_ACCOUNT_JSON`**.

Until that secret exists, `upload_to_play` is a safe no-op — the workflow logs a
warning and still produces the downloadable artifact.

---

## Debug build (local sideload — no signing needed)

For testing your own changes on your own phone:

```powershell
npm run android:apk:debug
$env:PATH += ";$env:LOCALAPPDATA\Android\Sdk\platform-tools"
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

The debug APK is signed with the **debug keystore** (`~/.android/debug.keystore` — autogenerated per machine). That signing key is *machine-local* — APKs built on different machines will have different signing keys and **can't update each other** (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). For shared testing, use a release build with a shared keystore.

---

## Release build (signed for Play Store / wider distribution)

### One-time keystore setup

If you don't already have `zedexams-release.keystore`:

```powershell
keytool -genkey -v -keystore zedexams-release.keystore -alias zedexams -keyalg RSA -keysize 2048 -validity 10000
```

Answer the prompts. **Save the keystore file + passwords somewhere secure** — if you lose them, you can never update the app on Play Store again (Google will require a new app listing).

Recommended store locations:
- 1Password / Bitwarden / your password manager (the file as an attachment, plus the passwords as fields)
- Encrypted backup drive
- **Never commit it to git** — `.gitignore` should exclude `*.keystore`

### Per-build env vars

Before running `npm run android:apk:release`, set four env vars:

```powershell
$env:ZED_RELEASE_STORE_FILE      = "M:\Claude\zedexams.com\zedexams-release.keystore"
$env:ZED_RELEASE_STORE_PASSWORD  = "<store password>"
$env:ZED_RELEASE_KEY_ALIAS       = "zedexams"
$env:ZED_RELEASE_KEY_PASSWORD    = "<key password>"
```

(Or `export` them on macOS / Linux.)

If you forget any, Gradle prints:
```
Release signing is not configured. Set ZED_RELEASE_STORE_FILE, ZED_RELEASE_STORE_PASSWORD, ZED_RELEASE_KEY_ALIAS, and ZED_RELEASE_KEY_PASSWORD to build a signed release APK/AAB.
```
and produces an **unsigned** APK that Play Store rejects.

### Build + verify

```powershell
npm run android:apk:release
```

Verify the APK is signed with your release key:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\<latest>\apksigner.bat" verify --print-certs android\app\build\outputs\apk\release\app-release.apk
```

Should print your keystore's certificate details. If you see "DOES NOT VERIFY" — signing didn't work; check the env vars.

### Distribute

- **Internal testing**: drop the APK in a Play Console internal-testing track.
- **Sideload to specific testers**: send them the APK file via WhatsApp / Drive / email. They enable "Install from unknown sources" then open it.
- **Public release**: bundle as AAB (`gradlew bundleRelease`), upload to Play Store production track.

---

## Future options: hybrid live updates

If you ever want web changes to flow to phones without a full APK rebuild + redistribute cycle, look at:

- **Capacitor Live Updates** (official Ionic product) — keeps app bundled (offline-first launch) but pulls new JS bundles over-the-air on next launch. ~30 min to wire.
- **Capgo** — open-source alternative to Capacitor Live Updates.
- **CodePush** (Microsoft, React Native–originated but works for hybrid apps).

These DO NOT replace this release workflow — native plugin changes, Capacitor config changes, and Android SDK upgrades still require a full APK rebuild. They only short-circuit JS / CSS / HTML updates.

---

## Common failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match` | A previous APK with a different signing key is installed on the device | `adb uninstall com.zedexams.android` then reinstall |
| New APK installs but app shows old UI | WebView cache not invalidated | `adb shell pm clear com.zedexams.android` or uninstall + reinstall |
| `versionCode hasn't changed` warning | Forgot to bump | The auto-derivation handles this; verify the `ZedExams Android — versionCode=…` line in build output |
| Release APK won't upload to Play Store | Unsigned or wrong signing key | Check the `apksigner verify` output; ensure env vars match the original Play Console-registered keystore |
| `adb` not recognised | PATH missing platform-tools | `$env:PATH += ";$env:LOCALAPPDATA\Android\Sdk\platform-tools"` (per-session) or set persistently |

---

## Where to keep the release keystore

Suggested: in this repo at `M:\Claude\zedexams.com\zedexams-release.keystore` — already gitignored. The env vars should reference the local path. **Don't commit it ever**; if you accidentally do, immediately rotate the key and treat all previously-released APKs as compromised.
