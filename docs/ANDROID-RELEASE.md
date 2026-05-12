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
| `FIREBASE_TOKEN` | `firebase login:ci` |
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
