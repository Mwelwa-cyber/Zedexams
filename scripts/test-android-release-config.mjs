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
  // Grab a generous slice; the block is short.
  return gradle.slice(relIdx, relIdx + 900)
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
