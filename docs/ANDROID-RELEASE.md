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
