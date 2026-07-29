/**
 * Android manifest — Families-policy guards.
 *
 * ZedExams is declared to Play as a mixed-audience app serving children aged
 * 9–13. Two things in the Android build would break that declaration, and both
 * are the kind that arrive by dependency rather than by decision:
 *
 *   1. THE ADVERTISING ID. Families policy prohibits transmitting the AAID or
 *      other persistent identifiers from children. We never read it — but
 *      play-services-measurement, pulled in transitively by Firebase, declares
 *      the permission in its own manifest, and the merger would add it to ours
 *      with nobody editing a file. A reviewer reading the MERGED manifest then
 *      sees an app for children asking for an advertising identifier. The
 *      `tools:node="remove"` entry strips it whichever dependency contributes
 *      it; this test fails if someone deletes that entry.
 *
 *   2. AN AD SDK. Interest-based advertising to children is prohibited
 *      outright, and any ad SDK in the child experience is a rejection. We
 *      declare "no ads" in the Console, so the build has to keep that true.
 *
 * A source scan, not a merged-manifest check: the merged manifest only exists
 * after a Gradle build, which CI's node suite does not run. Scanning the
 * source and the dependency list catches the two ways this actually regresses
 * — someone removes the guard, or someone adds an ad dependency.
 *
 * Plain `node` script. Run: node scripts/test-android-manifest.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
const APP_GRADLE = join(ROOT, 'android', 'app', 'build.gradle')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

console.log('android manifest — Families policy')

if (!existsSync(MANIFEST)) {
  // The Capacitor project is generated and may be absent in a fresh clone.
  // Skipping is correct; silently passing without saying so is not.
  console.log('  skipped — android/ project not present in this checkout.')
  process.exit(0)
}

const manifest = readFileSync(MANIFEST, 'utf8')

test('the AD_ID permission is explicitly removed at merge time', () => {
  // Both parts matter: the permission must be NAMED (so the merger has
  // something to match) and marked for removal.
  assert.match(
    manifest,
    /com\.google\.android\.gms\.permission\.AD_ID/,
    'the AD_ID permission is not named in the manifest — without an entry to '
    + 'match, a transitive dependency\'s declaration merges in unopposed',
  )
  // Match the ELEMENT, not a window of surrounding text — the comment above
  // it legitimately mentions AD_ID, and a text window would happily pass on
  // the strength of the comment while the declaration itself was unguarded.
  const elements = [...manifest.matchAll(/<uses-permission\b[\s\S]*?\/>/g)].map((m) => m[0])
  const adIdElements = elements.filter((el) => /AD_ID/.test(el))
  assert.ok(adIdElements.length > 0, 'no <uses-permission> element names AD_ID')
  for (const el of adIdElements) {
    assert.match(
      el,
      /tools:node="remove"/,
      'AD_ID is declared but NOT marked tools:node="remove" — as written this '
      + `REQUESTS the advertising ID for an app used by children:\n${el}`,
    )
  }
})

test('the tools namespace is declared, or tools:node is inert', () => {
  // Without xmlns:tools the attribute is not an error — it is silently
  // ignored, which is the worst outcome: the guard looks present and does
  // nothing.
  assert.match(
    manifest,
    /xmlns:tools="http:\/\/schemas\.android\.com\/tools"/,
    'xmlns:tools is missing, so tools:node="remove" is inert and AD_ID would merge in',
  )
})

test('no advertising permission is requested outright', () => {
  const requested = [...manifest.matchAll(/<uses-permission[\s\S]*?\/>/g)]
    .filter((m) => !/tools:node="remove"/.test(m[0]))
    .map((m) => (m[0].match(/android:name="([^"]+)"/) || [])[1])
    .filter(Boolean)
  for (const name of requested) {
    assert.ok(
      !/AD_ID|ADVERTISING/i.test(name),
      `${name} is requested — Families policy prohibits advertising identifiers from children`,
    )
  }
})

test('no ad SDK is on the Android dependency list', () => {
  if (!existsSync(APP_GRADLE)) return
  const gradle = readFileSync(APP_GRADLE, 'utf8')
  // Deliberately narrow: play-services-ads, AdMob, and the common third-party
  // mediation SDKs. play-services-measurement is NOT here — it arrives with
  // Firebase and is handled by the AD_ID removal above.
  const AD_SDKS = [
    /play-services-ads/,
    /com\.google\.android\.gms:play-services-ads-identifier/,
    /admob/i,
    /com\.applovin/,
    /com\.unity3d\.ads/,
    /com\.ironsource/,
    /com\.facebook\.android:audience-network/,
  ]
  for (const pattern of AD_SDKS) {
    assert.ok(
      !pattern.test(gradle),
      `an advertising SDK (${pattern}) is on the dependency list — the Play `
      + 'Console declaration says this app contains no ads',
    )
  }
})

console.log(`\nandroid manifest: ${passed} passed`)
