/**
 * Tests for the rendering identity and toolchain guard (§4.6).
 *
 * The failure these prevent is specific and expensive: an environment drift
 * arriving as several hundred unexplained visual failures across every fixture
 * at once. A reviewer facing that cannot separate drift from regression, and the
 * rational response — update all the baselines — destroys the suite in one
 * commit. So a mismatch must be a DIFFERENT KIND of failure, reported once.
 *
 * The other case is a missing executable. That must never be read as "the page
 * rendered blank", because that is how an infrastructure failure becomes an
 * accepted baseline of an empty page.
 *
 * Run: node scripts/visual/renderEnvironment.test.js
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  RenderEnvironmentError, RENDER_SETTINGS, CHROMIUM_FLAGS, LIBREOFFICE_ARGS,
  captureRenderEnvironment, baselineIdentity, assertComparableEnvironment,
  assertToolchain, assertScreenEnvironmentIsClean, chromiumVersion, libreOfficeVersion, fontDigest,
  resolveRenderChromium,
} from './renderEnvironment.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`)
    process.exitCode = 1
  }
}

const env = (over = {}) => ({
  chromium: '141.0.7390.37',
  libreoffice: '7.4.7.2',
  os: 'Linux 6.18.5',
  fonts: { count: 40, digest: 'abc123' },
  ...RENDER_SETTINGS,
  chromiumFlags: CHROMIUM_FLAGS.join(' '),
  libreOfficeArgs: LIBREOFFICE_ARGS.join(' '),
  ...over,
})

/* ── everything that could shift a pixel is pinned ──────────────────────── */

console.log('\n— the pin list —')

test('every setting the owner named is pinned', () => {
  for (const key of [
    'pageSize', 'pageWidthMm', 'pageHeightMm', 'marginsMm',
    'dpi', 'deviceScaleFactor', 'locale', 'timeZone', 'fixedDate',
  ]) {
    assert.ok(RENDER_SETTINGS[key] !== undefined, `${key} is pinned`)
  }
  // A fixed date, not today's: a paper printing the current date would produce a
  // new baseline every single day.
  assert.match(RENDER_SETTINGS.fixedDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(RENDER_SETTINGS.deviceScaleFactor, 1)
})

test('the render is pinned offline, so a failed fetch cannot become a baseline', () => {
  assert.ok(
    CHROMIUM_FLAGS.some((f) => /NetworkService/.test(f)),
    'network access is disabled by flag',
  )
  assert.ok(CHROMIUM_FLAGS.some((f) => /font-render-hinting=none/.test(f)))
  assert.ok(CHROMIUM_FLAGS.some((f) => /force-device-scale-factor=1/.test(f)))
})

test('the identity records the commands, not only the versions', () => {
  // A flag change shifts every glyph edge. A reviewer must be able to see that
  // it was the cause rather than hunting for a code change that is not there.
  const captured = captureRenderEnvironment()
  assert.equal(typeof captured.chromiumFlags, 'string')
  assert.equal(typeof captured.libreOfficeArgs, 'string')
  assert.ok(captured.os && captured.platform && captured.node)
  assert.equal(captured.dpi, RENDER_SETTINGS.dpi)
})

test('the font set is captured as a stable digest', () => {
  const a = fontDigest()
  const b = fontDigest()
  assert.deepEqual(a, b, 'the same image digests the same way')
  assert.equal(typeof a.digest, 'string')
  // A directory with no fonts is reported as such rather than as a hash of
  // nothing that happens to match another empty set by coincidence.
  assert.deepEqual(fontDigest(['/nonexistent-font-dir']), { count: 0, digest: 'none' })
})

/* ── two renderers, two baseline families ───────────────────────────────── */

console.log('\n— baselines are never mixed across renderers —')

test('each stage files under its own version-qualified identity', () => {
  const e = env()
  assert.equal(baselineIdentity('browser-print', e), 'browser-print/chromium-141.0.7390.37')
  assert.equal(baselineIdentity('docx', e), 'docx/libreoffice-7.4.7.2')
  // Which means the two can never collide, so a LibreOffice page is never
  // compared against a Chromium baseline.
  assert.notEqual(baselineIdentity('browser-print', e), baselineIdentity('docx', e))
})

test('a renderer upgrade files a NEW baseline family rather than overwriting', () => {
  const before = baselineIdentity('docx', env())
  const after = baselineIdentity('docx', env({ libreoffice: '7.5.0.1' }))
  assert.notEqual(before, after, 'an upgrade is a reviewable event, not a mass rewrite')
})

test('an unknown version or stage refuses to file a baseline at all', () => {
  assert.throws(() => baselineIdentity('browser-print', env({ chromium: '' })), RenderEnvironmentError)
  assert.throws(() => baselineIdentity('docx', env({ libreoffice: '' })), RenderEnvironmentError)
  assert.throws(() => baselineIdentity('pdf-magic', env()), RenderEnvironmentError)
})

/* ── a mismatch is an environment error ─────────────────────────────────── */

console.log('\n— a drifted environment is not a visual finding —')

test('an identical environment compares happily', () => {
  assert.doesNotThrow(() => assertComparableEnvironment(env(), env()))
})

test('every pinned field, changed alone, is refused', () => {
  // Each of these would shift pixels across every fixture at once. Reported as
  // one environment error instead of hundreds of page failures.
  const changes = {
    chromium: '142.0.0.0',
    libreoffice: '7.5.0.1',
    os: 'Linux 7.0.0',
    dpi: 300,
    deviceScaleFactor: 2,
    locale: 'en-US',
    timeZone: 'UTC',
  }
  for (const [field, value] of Object.entries(changes)) {
    assert.throws(
      () => assertComparableEnvironment(env(), env({ [field]: value })),
      (err) => err instanceof RenderEnvironmentError
        && err.detail.differences.some((d) => d.field === field),
      `${field} changing is refused`,
    )
  }
})

test('a font package upgrade is refused too', () => {
  assert.throws(
    () => assertComparableEnvironment(env(), env({ fonts: { count: 41, digest: 'def456' } })),
    (err) => err.detail.differences.some((d) => d.field === 'fonts.digest'),
  )
})

test('a changed Chromium FLAG is refused, not just a changed version', () => {
  assert.throws(
    () => assertComparableEnvironment(env(), env({ chromiumFlags: '--headless=new' })),
    RenderEnvironmentError,
  )
})

test('a baseline with no recorded environment is refused, not assumed to match', () => {
  // The dangerous default. Treating "no recorded environment" as "same
  // environment" would let a baseline from any machine be compared anywhere.
  assert.throws(() => assertComparableEnvironment(null, env()), RenderEnvironmentError)
  assert.throws(() => assertComparableEnvironment(undefined, env()), RenderEnvironmentError)
})

test('the error names what differed, so the remedy is obvious', () => {
  try {
    assertComparableEnvironment(env(), env({ chromium: '142.0.0.0' }))
    assert.fail('should have thrown')
  } catch (err) {
    assert.match(err.message, /rendering environment differs/)
    assert.match(err.message, /141\.0\.7390\.37 → 142\.0\.0\.0/)
  }
})

/* ── a missing tool is infrastructure, not a diff ───────────────────────── */

console.log('\n— a missing renderer fails as infrastructure —')

test('a missing Chromium is an infrastructure error, not a blank page', () => {
  // THE case the owner asked to prove. Without this, a missing binary yields no
  // output, the comparison sees an empty page, and the "fix" is to accept an
  // empty baseline.
  assert.throws(
    () => assertToolchain(['browser-print'], env({ chromium: '' })),
    (err) => err instanceof RenderEnvironmentError
      && /infrastructure failure/.test(err.message)
      && err.detail.missing.includes('Chromium'),
  )
})

test('a missing LibreOffice is the same', () => {
  assert.throws(
    () => assertToolchain(['docx'], env({ libreoffice: '' })),
    (err) => err.detail.missing.some((m) => /LibreOffice/.test(m)),
  )
})

test('the error says explicitly that no baseline was written', () => {
  try {
    assertToolchain(['docx', 'browser-print'], env({ chromium: '', libreoffice: '' }))
    assert.fail('should have thrown')
  } catch (err) {
    assert.match(err.message, /no baseline was written/)
    assert.equal(err.detail.missing.length, 2)
  }
})

test('a stage that is not being run does not require its tool', () => {
  // Rendering only the browser stage must not demand LibreOffice, or a
  // browser-only change could not be checked at all.
  assert.doesNotThrow(() => assertToolchain(['browser-print'], env({ libreoffice: '' })))
  assert.doesNotThrow(() => assertToolchain(['docx'], env({ chromium: '' })))
  assert.doesNotThrow(() => assertToolchain([], env({ chromium: '', libreoffice: '' })))
})

/* ── this machine ───────────────────────────────────────────────────────── */

console.log('\n— what is actually installed here —')

test('the probes return a version or an empty string, never throw', () => {
  assert.doesNotThrow(() => chromiumVersion())
  assert.doesNotThrow(() => libreOfficeVersion())
  assert.doesNotThrow(() => chromiumVersion('/definitely/not/here'))
  assert.equal(chromiumVersion('/definitely/not/here'), '')
  // A probe of a real path that is not a browser must also not throw.
  assert.equal(typeof libreOfficeVersion('/bin/true'), 'string')
})

console.log('\n— the sandbox flag is added where the sandbox cannot work —')

const { chromiumLaunchFlags, sandboxUnavailable } = await import('./pdfPages.js')

test('the pinned flag list never disables the sandbox on its own', () => {
  // A machine that CAN isolate the browser keeps doing so. The flag is a
  // concession to an environment, not part of the render identity.
  assert.ok(!CHROMIUM_FLAGS.some((f) => /no-sandbox/.test(f)))
})

test('a root process gets the flag, because Chromium will not sandbox as root', () => {
  const before = process.env.VISUAL_CHROMIUM_SANDBOX
  process.env.VISUAL_CHROMIUM_SANDBOX = 'off'
  try {
    assert.ok(sandboxUnavailable())
    assert.ok(chromiumLaunchFlags().includes('--no-sandbox'))
  } finally {
    if (before === undefined) delete process.env.VISUAL_CHROMIUM_SANDBOX
    else process.env.VISUAL_CHROMIUM_SANDBOX = before
  }
})

test('a usable sandbox keeps it', () => {
  const before = process.env.VISUAL_CHROMIUM_SANDBOX
  process.env.VISUAL_CHROMIUM_SANDBOX = 'on'
  try {
    assert.ok(!sandboxUnavailable())
    assert.ok(!chromiumLaunchFlags().includes('--no-sandbox'))
  } finally {
    if (before === undefined) delete process.env.VISUAL_CHROMIUM_SANDBOX
    else process.env.VISUAL_CHROMIUM_SANDBOX = before
  }
})

test('an AppArmor userns restriction counts as no sandbox, uid aside', () => {
  // The case that crashed CI: a NON-root process on Ubuntu 23.10+ where
  // unprivileged user namespaces are restricted. Checking only for root passed
  // in the container and aborted on the runner — so the answer is asserted
  // against BOTH signals on whatever machine this runs on.
  const file = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns'
  const restricted = existsSync(file) && readFileSync(file, 'utf8').trim() === '1'
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
  assert.equal(
    sandboxUnavailable(),
    asRoot || restricted,
    `root=${asRoot} apparmor-restricted=${restricted}`,
  )
})

console.log('\n— the browser that renders is the browser that is recorded —')

await (async () => {
  // The bug this pins cost a red CI run and, worse, produced local baselines
  // stamped with a version that drew none of the pages. `executablePath()` is
  // ASYNC; calling it synchronously yields a pending Promise, which then failed a
  // path check silently and fell back to an unrelated browser on disk. So the
  // resolver must hand back a string, and a non-empty one must be a real file.
  const resolved = await resolveRenderChromium()
  test('the resolver returns a string, not a promise', () => {
    assert.equal(typeof resolved, 'string')
  })
  test('a resolved path exists on disk', () => {
    if (resolved) assert.ok(existsSync(resolved), `${resolved} does not exist`)
  })
  test('the recorded version comes from that same binary', () => {
    const environment = captureRenderEnvironment({ chromiumPath: resolved })
    if (!resolved) {
      // No browser is a legitimate state, and it must read as absent rather than
      // as some other browser's version.
      assert.equal(environment.chromium, '')
      return
    }
    assert.equal(environment.chromiumPath, resolved)
    assert.equal(environment.chromium, chromiumVersion(resolved))
    assert.ok(environment.chromium, 'a resolved browser must report a version')
  })
  test('an unresolved browser is refused rather than guessed at', () => {
    const environment = captureRenderEnvironment({ chromiumPath: '/definitely/not/here' })
    assert.equal(environment.chromium, '')
    assert.throws(
      () => assertToolchain(['browser-print'], environment),
      /Chromium/,
      'a missing browser is an infrastructure failure',
    )
  })
})()

/* ── A screen baseline may not be recorded in a paper environment ──────────
   The failure is silent in every way that usually catches things: the render
   succeeds, the images are correct, the page checks pass, the pull request
   opens. What breaks is the NEXT run — `libreoffice` is an identity field and
   the same apt install shifts `fonts.digest`, so the comparing job, which
   installs neither, can only ever throw. #2137 recorded sixteen such baselines.
   Refused at RECORD time, because by compare time they are already approved. */
;(() => {
  const clean = { chromium: '151.0.0.0', fonts: { count: 40, digest: 'abc' } }

  test('a Chromium-only environment records fine', () => {
    assert.doesNotThrow(() => assertScreenEnvironmentIsClean(clean))
    assert.doesNotThrow(() => assertScreenEnvironmentIsClean({ ...clean, libreoffice: '' }))
    assert.doesNotThrow(() => assertScreenEnvironmentIsClean({ ...clean, libreoffice: null }))
    assert.doesNotThrow(() => assertScreenEnvironmentIsClean({}))
  })

  test('LibreOffice in the environment refuses the recording, and names it', () => {
    assert.throws(
      () => assertScreenEnvironmentIsClean({ ...clean, libreoffice: '24.2.7.2' }),
      (err) => err instanceof RenderEnvironmentError
        && /LibreOffice \(24\.2\.7\.2\)/.test(err.message)
        && /comparing job can reproduce|never installs LibreOffice/.test(err.message),
      'the refusal must say which version it found and why it matters',
    )
  })

  test('the environment #2137 actually recorded is refused', () => {
    // Not a synthetic case: these are the values from
    // tests/visual/baselines/screen/chromium-151.0.7922.47/environment.json on
    // the branch that bootstrap opened.
    assert.throws(() => assertScreenEnvironmentIsClean({
      chromium: '151.0.7922.47',
      libreoffice: '24.2.7.2',
      fonts: { count: 54, digest: '20b5398451fb9a3a' },
    }), RenderEnvironmentError)
  })

  test('the recorder calls it BEFORE it writes anything', () => {
    // Order is the whole point: called after the loop, sixteen unusable
    // baselines are already on disk and the run has already "succeeded".
    const src = readFileSync(new URL('./screen/runScreenGate.mjs', import.meta.url), 'utf8')
    const guard = src.indexOf('assertScreenEnvironmentIsClean(environment)')
    const write = src.indexOf('writeFileSync(file, c.png)')
    assert.ok(guard > 0, 'the screen recorder does not call the guard at all')
    assert.ok(write > 0, 'the screen recorder no longer writes baselines?')
    assert.ok(guard < write, 'the guard runs after the first baseline is written')
  })
})()

console.log(`\n✓ render environment — ${passed} tests passed`)
