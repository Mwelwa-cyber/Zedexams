/**
 * Guards the one Gradle rule that no CI job in this repo can catch by building:
 * a `buildscript {}` block may not reference a variable from variables.gradle.
 *
 * WHY THIS EXISTS
 *
 * Gradle evaluates every `buildscript {}` block BEFORE the rest of the script
 * it lives in — before `apply from: "variables.gradle"` runs, and regardless of
 * whether that line sits above or below the block. So `rootProject.ext` does
 * not exist yet, and a classpath line written as
 *
 *     classpath "com.google.firebase:firebase-crashlytics-gradle:$someVersion"
 *
 * fails the whole build with
 *
 *     Could not get unknown property 'someVersion'
 *
 * That is not a subtle degradation — it is a hard failure at configuration
 * time, before a single dependency resolves. It shipped to `main` on
 * 2026-08-16 with Crashlytics, and reaching `main` is precisely the problem:
 * NO required check compiles the Android project (the node CI jobs have no
 * Android SDK), and `android-debug-apk.yml` runs on push to `main`, so the
 * first signal was a red build on the default branch rather than a red PR.
 *
 * A text check is the right shape here. It cannot prove the build works, but
 * it can prove this specific mistake is absent, and it runs in `test:all` on
 * every pull request for free — which is more than the real compiler does.
 *
 * The correct split, for anyone adding a dependency:
 *   • buildscript classpath → hardcoded literal in android/build.gradle
 *   • module dependencies   → a variable in variables.gradle, referenced from
 *                             app/build.gradle (evaluated later, so it works)
 *
 * Run: node scripts/test-android-buildscript-versions.mjs
 */

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8')

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('android-buildscript-versions')

/**
 * Extract a top-level `buildscript { ... }` block by brace matching.
 * A regex cannot do this — the block contains nested braces — and getting it
 * wrong in the lenient direction (matching too little) would make the whole
 * guard silently vacuous.
 */
function buildscriptBlock(src, file) {
  const start = src.search(/\bbuildscript\s*\{/)
  assert.ok(start !== -1, `${file}: no buildscript block found — has this file been restructured?`)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  throw new Error(`${file}: unbalanced braces in buildscript block`)
}

/** Strip // line comments and block comments so prose can discuss `$vars`. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const GRADLE_FILES = ['android/build.gradle']

for (const file of GRADLE_FILES) {
  const block = stripComments(buildscriptBlock(read(file), file))

  // The guard proper. `$foo` and `${foo}` are both GString interpolation.
  const interpolations = [...block.matchAll(/\$\{?\s*([A-Za-z_][\w.]*)/g)].map((m) => m[1])
  ok(
    `${file}: buildscript references no variables.gradle property` +
      (interpolations.length ? ` (found: ${interpolations.join(', ')})` : ''),
    interpolations.length === 0,
  )

  // A classpath with no version at all resolves to whatever Gradle feels like
  // today, which is its own kind of unpinned.
  const classpaths = [...block.matchAll(/classpath\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
  ok(`${file}: buildscript declares at least one classpath`, classpaths.length > 0)
  const unpinned = classpaths.filter((c) => !/:[0-9]/.test(c))
  ok(
    `${file}: every classpath pins an explicit version` +
      (unpinned.length ? ` (unpinned: ${unpinned.join(', ')})` : ''),
    unpinned.length === 0,
  )
}

// The Crashlytics pair specifically — the two halves must stay on opposite
// sides of the boundary. Naming them keeps the guard meaningful if the generic
// checks above are ever loosened.
const rootGradle = read('android/build.gradle')
const variables = read('android/variables.gradle')

ok('the Crashlytics GRADLE PLUGIN is pinned in android/build.gradle',
   /classpath\s+['"]com\.google\.firebase:firebase-crashlytics-gradle:[0-9][^'"]*['"]/.test(rootGradle))
ok('the Crashlytics plugin version is NOT declared in variables.gradle',
   !/firebaseCrashlyticsGradleVersion/.test(stripComments(variables)))
ok('the Crashlytics SDK version IS declared in variables.gradle',
   /firebaseCrashlyticsVersion\s*=\s*['"][0-9]/.test(variables))
ok('the Crashlytics SDK is referenced from app/build.gradle by variable',
   /com\.google\.firebase:firebase-crashlytics:\$firebaseCrashlyticsVersion/.test(read('android/app/build.gradle')))

// The plugin must stay inside the google-services.json conditional: it reads
// the Firebase application id google-services generates, so an unconditional
// apply turns "secret unset" from a warning that still builds into a hard
// failure for android-debug-apk.yml.
const appGradle = stripComments(read('android/app/build.gradle'))
const gsIndex = appGradle.indexOf("apply plugin: 'com.google.gms.google-services'")
const clsIndex = appGradle.indexOf("apply plugin: 'com.google.firebase.crashlytics'")
ok('both plugins are applied', gsIndex !== -1 && clsIndex !== -1)
ok('crashlytics is applied AFTER google-services', clsIndex > gsIndex)

console.log(`\n─── android-buildscript-versions · ${passed} passed ───`)
