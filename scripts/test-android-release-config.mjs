#!/usr/bin/env node
/**
 * Static-text regression tests for the Android release-hardening config.
 *
 * Companion to scripts/test-firestore-rules-text.mjs and
 * scripts/test-storage-rules-text.mjs. Same approach: parse the config
 * files as text and assert the load-bearing strings are still there.
 * Does NOT build an APK — the node CI job has no Android SDK, so a full
 * `assembleRelease` (R8) only runs in the android-release / play-release
 * workflows on a tag push. This guard catches the class of regression
 * where a Capacitor re-sync, a copy-paste from a template, or a "clean
 * up the manifest" refactor silently flips the release posture back to
 * the insecure defaults (`allowBackup="true"`, `minifyEnabled false`)
 * without anyone noticing until a Play review or a security scan.
 *
 * What each assertion protects:
 *   - allowBackup="false"  — this is a school app used by minors; auto
 *     backup would copy the Firebase auth token + Firestore offline
 *     cache into a Google cloud backup with no restore story to justify
 *     it. The default is "true", so a regression is a single missing
 *     character away.
 *   - minifyEnabled + shrinkResources — R8 shrink/obfuscate for release.
 *     The Capacitor project template ships `minifyEnabled false`, so a
 *     re-generated build.gradle would quietly drop shrinking.
 *   - the proguard keep rules — without the @JavascriptInterface keep the
 *     minified build boots to a dead WebView bridge, and without the
 *     -dontwarn com.facebook the R8 release build fails to compile. These
 *     are exactly the rules that make the minified build shippable, so
 *     they're pinned here.
 *
 * Run: npm run test:android-release-config  (also via npm run test:all)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const ANDROID = join(ROOT, 'android', 'app')
const manifest = readFileSync(join(ANDROID, 'src', 'main', 'AndroidManifest.xml'), 'utf8')
const gradle = readFileSync(join(ANDROID, 'build.gradle'), 'utf8')
const gradleProps = readFileSync(join(ROOT, 'android', 'gradle.properties'), 'utf8')
const proguard = readFileSync(join(ANDROID, 'proguard-rules.pro'), 'utf8')
const playWorkflow = readFileSync(
  join(ROOT, '.github', 'workflows', 'android-play-release.yml'),
  'utf8'
)
const whatsNewEnUs = readFileSync(
  join(ROOT, 'distribution', 'whatsnew', 'whatsnew-en-US'),
  'utf8'
)

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ── AndroidManifest.xml: backups off ────────────────────────────

console.log('\nAndroidManifest.xml — backups off')

test('allowBackup is explicitly false', () => {
  assert(
    /android:allowBackup\s*=\s*"false"/.test(manifest),
    'android:allowBackup must be "false" for a minors\' app — see the manifest comment'
  )
})

test('allowBackup is not true anywhere', () => {
  // The Capacitor/AGP default is "true"; a re-sync or template paste is
  // the most likely way it comes back.
  assert(
    !/android:allowBackup\s*=\s*"true"/.test(manifest),
    'android:allowBackup="true" is back — backups must stay off (no restore story)'
  )
})

// ── build.gradle: R8 shrink + obfuscate for release ─────────────

console.log('\nbuild.gradle — release shrinking/obfuscation')

// Isolate the buildTypes { release { … } } block. Anchor on `buildTypes`
// first so the earlier `signingConfigs { release { … } }` block (which
// has no minifyEnabled) can't be mistaken for it and give a false pass.
const releaseBlock = (() => {
  const btIdx = gradle.indexOf('buildTypes {')
  assert(btIdx >= 0, 'buildTypes {} block not found in build.gradle')
  const relIdx = gradle.indexOf('release {', btIdx)
  assert(relIdx >= 0, 'release {} build type not found under buildTypes in build.gradle')
  // Brace-match to the block's real end rather than slicing a fixed number
  // of characters. This used to take `relIdx + 900`, which silently depended
  // on the block staying short: when the native-symbols `ndk {}` block was
  // added the release body reached 888 characters, twelve short of the
  // window, and the next comment line would have pushed proguardFiles and
  // signingConfig out of view — three assertions passing on a block they
  // could no longer see. A guard that stops looking at what it claims to
  // check is worse than no guard.
  let depth = 0
  for (let i = gradle.indexOf('{', relIdx); i < gradle.length; i++) {
    if (gradle[i] === '{') depth++
    else if (gradle[i] === '}') {
      depth--
      if (depth === 0) return gradle.slice(relIdx, i + 1)
    }
  }
  assert(false, 'release {} block in build.gradle is unbalanced — cannot parse')
})()

test('release minifyEnabled true', () => {
  assert(
    /minifyEnabled\s+true/.test(releaseBlock),
    'release build must set minifyEnabled true (R8 shrink/obfuscate)'
  )
  assert(
    !/minifyEnabled\s+false/.test(releaseBlock),
    'release build has minifyEnabled false — shrinking/obfuscation is off'
  )
})

test('release shrinkResources true', () => {
  assert(
    /shrinkResources\s+true/.test(releaseBlock),
    'release build must set shrinkResources true to drop unreferenced res/ entries'
  )
})

test('release ships native debug symbols to Play', () => {
  // Without this the bundle carries .so files with no symbols file: Play
  // warns on every release, and native crash + ANR traces arrive as bare
  // addresses. The symbols go to BUNDLE-METADATA, not to devices, so there
  // is no app-size argument for dropping it — only an upload-size one.
  assert(
    /debugSymbolLevel\s+'(FULL|SYMBOL_TABLE)'/.test(releaseBlock),
    "release must set ndk.debugSymbolLevel ('FULL' or 'SYMBOL_TABLE') so " +
      'Play can symbolicate native crashes and ANRs'
  )
})

test('release uses the optimizing proguard defaults + app rules', () => {
  assert(
    /getDefaultProguardFile\('proguard-android-optimize\.txt'\)/.test(releaseBlock),
    "release should use proguard-android-optimize.txt (the optimizing default)"
  )
  assert(
    /'proguard-rules\.pro'/.test(releaseBlock),
    'release must still apply the app-level proguard-rules.pro keep rules'
  )
})

// ── proguard-rules.pro: the keeps that make R8 shippable ────────

console.log('\nproguard-rules.pro — keeps that make the minified build work')

test('@JavascriptInterface methods are kept (Capacitor bridge)', () => {
  // Stripping/renaming these silently severs the WebView JS bridge — the
  // whole app is a WebView, so this is load-bearing.
  assert(
    /@android\.webkit\.JavascriptInterface\s+<methods>;/.test(proguard),
    'proguard-rules.pro no longer keeps @JavascriptInterface methods — WebView bridge would break in release'
  )
})

test('facebook classes are -dontwarn (disabled provider)', () => {
  // Without this, R8 errors the release build on the unresolvable
  // com.facebook.* references traced from the never-taken provider-init
  // branch. Its absence turns the release build red.
  assert(
    /-dontwarn\s+com\.facebook\.\*\*/.test(proguard),
    'proguard-rules.pro dropped -dontwarn com.facebook.** — R8 release build will fail to compile'
  )
})

test('@capacitor-firebase/messaging plugin package is fully kept', () => {
  // Root cause of the v1.2.5 launch crash (release-only, not debug):
  //   • CI runs `npx cap sync android` before bundleRelease, which adds
  //     @capacitor-firebase/messaging's Android AAR to the build.
  //   • Capacitor's consumer rules keep the @CapacitorPlugin-annotated
  //     FirebaseMessagingPlugin class but NOT the internal helper/model
  //     classes in the same package.
  //   • R8 strips those helpers; load() triggers NoClassDefFoundError
  //     (an Error, not Exception) which propagates through super.onCreate()
  //     → launch crash on the signed release APK.
  //   • Debug builds use D8 (no shrinking) so they never reproduce it.
  // Pinning this rule here prevents a future cap sync / proguard-rules.pro
  // regeneration from silently dropping the keep and re-introducing the crash.
  assert(
    /-keep class io\.capawesome\.capacitorjs\.plugins\.firebase\.messaging\.\*\*/.test(proguard),
    'proguard-rules.pro no longer keeps io.capawesome.capacitorjs.plugins.firebase.messaging.** — ' +
    '@capacitor-firebase/messaging helper classes will be stripped by R8 during bridge-init → ' +
    'NoClassDefFoundError → launch crash on the signed release build (v1.2.5 regression)'
  )
})

test('@capacitor-firebase/messaging package has -dontwarn', () => {
  // Paired with the -keep above: suppresses any R8 "can\'t find referenced class"
  // warnings for conditional imports in the plugin package. Keeps the release
  // build clean and prevents warnings from being promoted to errors via
  // -warningsarerrors in future AGP versions.
  assert(
    /-dontwarn io\.capawesome\.capacitorjs\.plugins\.firebase\.messaging\.\*\*/.test(proguard),
    'proguard-rules.pro dropped -dontwarn io.capawesome.capacitorjs.plugins.firebase.messaging.** — ' +
    'R8 may warn or error on conditional imports in the FCM plugin package'
  )
})

test('@capacitor-firebase/app-check + authentication packages are fully kept', () => {
  // Same launch-crash class as messaging, and the reason a messaging-only keep
  // was an incomplete fix (#1603). Both plugins instantiate a same-package
  // helper during Bridge.init() — app-check via a field initializer
  // (`new FirebaseAppCheck(this)` in the constructor), authentication in
  // `load()` (`new FirebaseAuthentication(this, config)`). R8 strips the
  // helper, construction/load() raises NoClassDefFoundError (an Error, not an
  // Exception) → launch crash on the signed release build. The messaging crash
  // fired first and masked these; keep both packages so R8 can't strip them.
  assert(
    /-keep class io\.capawesome\.capacitorjs\.plugins\.firebase\.appcheck\.\*\*/.test(proguard),
    'proguard-rules.pro no longer keeps io.capawesome.capacitorjs.plugins.firebase.appcheck.** — ' +
    '@capacitor-firebase/app-check helper (FirebaseAppCheck) is instantiated in the plugin ' +
    'constructor and will be stripped by R8 → NoClassDefFoundError → launch crash on release'
  )
  assert(
    /-keep class io\.capawesome\.capacitorjs\.plugins\.firebase\.authentication\.\*\*/.test(proguard),
    'proguard-rules.pro no longer keeps io.capawesome.capacitorjs.plugins.firebase.authentication.** — ' +
    '@capacitor-firebase/authentication helper (FirebaseAuthentication) is instantiated in load() ' +
    'and will be stripped by R8 → NoClassDefFoundError → launch crash on release'
  )
})

test('@capacitor-firebase/app-check + authentication packages have -dontwarn', () => {
  // Paired with the -keep rules above; keeps the release build clean of R8
  // "can't find referenced class" warnings for conditional imports in these
  // packages so they can't be promoted to build-failing errors.
  assert(
    /-dontwarn io\.capawesome\.capacitorjs\.plugins\.firebase\.appcheck\.\*\*/.test(proguard),
    'proguard-rules.pro dropped -dontwarn io.capawesome.capacitorjs.plugins.firebase.appcheck.**'
  )
  assert(
    /-dontwarn io\.capawesome\.capacitorjs\.plugins\.firebase\.authentication\.\*\*/.test(proguard),
    'proguard-rules.pro dropped -dontwarn io.capawesome.capacitorjs.plugins.firebase.authentication.**'
  )
})

test('source-file line info is kept + renamed for retraceable stack traces', () => {
  assert(
    /-keepattributes\s+SourceFile,\s*LineNumberTable/.test(proguard),
    'proguard-rules.pro no longer keeps SourceFile,LineNumberTable — Play Console crash traces become unmappable'
  )
  assert(
    /-renamesourcefileattribute\s+SourceFile/.test(proguard),
    'proguard-rules.pro no longer renames the source-file attribute'
  )
})

// ── R8: compat mode + Capacitor runtime keep (post-login crash) ──
//
// v1.2.5/v1.2.6 crashed with a NullPointerException immediately after sign-in:
//   FirebaseMessagingPlugin.checkPermissions()
//     -> Plugin.checkPermissions() -> Plugin.getPermissionStates()
//     -> `return bridge.getPermissionStates(this)`   // bridge == null
// AGP 8's default R8 FULL mode can't see Capacitor's reflective plugin dispatch
// (Method.invoke), so it eliminated the write to Plugin.bridge. The app calls
// the FCM plugin's checkPermissions() on sign-in, so the null bridge crashed
// every logged-in session (logged-out was fine). These pin the two fixes.

console.log('\ngradle.properties / proguard — R8 must not null out Plugin.bridge')

test('R8 full mode is disabled (compat mode)', () => {
  // Full mode is the AGP-8 default; it must stay OFF or the reflective
  // Capacitor plugin surface breaks (null bridge → post-login crash).
  assert(
    /^\s*android\.enableR8\.fullMode\s*=\s*false\s*$/m.test(gradleProps),
    'android/gradle.properties must set android.enableR8.fullMode=false — ' +
    'R8 full mode nulls com.getcapacitor.Plugin.bridge (reflective dispatch is opaque to it), ' +
    'crashing the app on sign-in with an NPE in getPermissionStates'
  )
  assert(
    !/^\s*android\.enableR8\.fullMode\s*=\s*true\s*$/m.test(gradleProps),
    'android.enableR8.fullMode=true is back — it re-introduces the post-login NPE crash'
  )
})

test('Capacitor runtime is fully kept', () => {
  assert(
    /-keep class com\.getcapacitor\.\*\*\s*\{\s*\*;\s*\}/.test(proguard),
    'proguard-rules.pro must keep com.getcapacitor.** { *; } so R8 cannot drop ' +
    'reflectively-used base-class fields (e.g. Plugin.bridge)'
  )
  assert(
    /-keepattributes[^\n]*\*Annotation\*/.test(proguard),
    'proguard-rules.pro must keep *Annotation* so @CapacitorPlugin permission metadata survives R8'
  )
})

// ── Play "What's new" release notes wiring ──────────────────────
//
// The closed-testing AAB (android-play-release.yml) publishes to the Play
// `alpha` track. Without a whatsNewDirectory, testers see an empty "What's
// new" panel. These assertions keep the notes wired in and inside Play's
// per-language 500-character limit (the API rejects longer notes, failing
// the whole publish step).

console.log('\nandroid-play-release.yml — release-notes wiring')

test('publish step points at distribution/whatsnew', () => {
  assert(
    /whatsNewDirectory:\s*distribution\/whatsnew/.test(playWorkflow),
    'android-play-release.yml no longer passes whatsNewDirectory — testers get an empty "What\'s new" panel'
  )
})

test('en-US release notes are within Play\'s 500-char limit', () => {
  // Play caps release notes at 500 characters per language; a longer file
  // makes the upload-google-play step reject the release.
  const len = whatsNewEnUs.length
  assert(
    len > 0,
    'distribution/whatsnew/whatsnew-en-US is empty — write the tester-facing notes'
  )
  assert(
    len <= 500,
    `distribution/whatsnew/whatsnew-en-US is ${len} chars — Play rejects release notes over 500`
  )
})

// ── Report ──────────────────────────────────────────────────────

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
