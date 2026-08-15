/**
 * The build/release identifier.
 *
 * Two properties matter here, and only one of them is about formatting.
 *
 * 1. UNIQUENESS. `VITE_APP_VERSION` was a manually-bumped GitHub secret stuck
 *    at 1.1.0 across every deploy, so every production build shipped as
 *    `zedexams@1.1.0-production`. Sentry could not tell two deploys apart:
 *    "resolved in the next release" had no next release to name, a recurrence
 *    could not be classified as a regression, and an incoming event could not
 *    say whether it came from a build carrying a given fix.
 *
 * 2. NO DRIFT. The release name is stamped in two places — the runtime
 *    (src/utils/sentry.js) and the source-map upload (vite.config.js). They
 *    used to be separate template literals kept in step by a comment saying
 *    they must be "byte-for-byte identical". If they drifted, maps silently
 *    stopped binding and every production stack trace went minified. The
 *    source scan at the bottom is what actually holds that line.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildReleaseName, shortBuildId, RELEASE_PREFIX } from '../src/utils/releaseName.js'

let passed = 0
function test(name, fn) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

console.log('\nrelease name — identity')

test('a deploy is identified by version AND build', () => {
  assert.equal(
    buildReleaseName({ version: '1.2.7', sha: '03f0b74b1234567890', mode: 'production' }),
    'zedexams@1.2.7+03f0b74b-production',
  )
})

test('two deploys of the SAME version are distinguishable', () => {
  const a = buildReleaseName({ version: '1.2.7', sha: 'aaaaaaaa1111', mode: 'production' })
  const b = buildReleaseName({ version: '1.2.7', sha: 'bbbbbbbb2222', mode: 'production' })
  assert.notEqual(a, b, 'the whole point: the version alone cannot separate builds')
})

test('the same commit always produces the same name', () => {
  const args = { version: '1.2.7', sha: 'deadbeefcafe', mode: 'production' }
  assert.equal(buildReleaseName(args), buildReleaseName({ ...args }))
})

test('mode separates production from a preview of the same commit', () => {
  assert.notEqual(
    buildReleaseName({ version: '1.2.7', sha: 'abc12345', mode: 'production' }),
    buildReleaseName({ version: '1.2.7', sha: 'abc12345', mode: 'smoke' }),
  )
})

console.log('\nrelease name — degradation')

test('missing inputs degrade to truthful placeholders, never throw', () => {
  assert.equal(buildReleaseName({}), 'zedexams@dev+dev-development')
  assert.equal(buildReleaseName(), 'zedexams@dev+dev-development')
  // An unset CI secret yields '' rather than undefined, which `??` would miss.
  assert.equal(
    buildReleaseName({ version: '', sha: '', mode: '' }),
    'zedexams@dev+dev-development',
  )
})

test('build ids are truncated consistently', () => {
  assert.equal(shortBuildId('0123456789abcdef'), '01234567')
  assert.equal(shortBuildId(''), 'dev')
  assert.equal(shortBuildId(undefined), 'dev')
  assert.equal(RELEASE_PREFIX, 'zedexams')
})

console.log('\nrelease name — the drift these guards prevent')

test('utils/buildId derives its id from the shared helper', () => {
  const src = read('src/utils/buildId.js')
  assert.ok(src.includes('shortBuildId'), 'must not re-implement the truncation')
  assert.ok(!/\.slice\(0,\s*8\)/.test(src), 'a second truncation rule is how these drift')
})

test('BOTH release call sites go through buildReleaseName', () => {
  for (const file of ['src/utils/sentry.js', 'vite.config.js']) {
    const src = read(file)
    assert.ok(src.includes('buildReleaseName'), `${file} must use the shared builder`)
    // A hand-rolled `zedexams@...` template is exactly the drift that made the
    // runtime and the source-map upload two things to keep in step by hand.
    assert.ok(
      !/`zedexams@\$\{/.test(src),
      `${file} must not hand-roll the release string`,
    )
  }
})

test('the version comes from package.json, not a CI secret', () => {
  const src = read('vite.config.js')
  assert.ok(src.includes('pkg.version'), 'package.json is the source of truth')
  // The old precedence let an unmaintained secret win, which is what went stale.
  assert.ok(
    !/process\.env\.VITE_APP_VERSION\s*\|\|/.test(src),
    'the secret must not outrank package.json again',
  )
})

console.log(`\n✓ release name: ${passed} tests passed\n`)
