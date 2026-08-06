/**
 * Collecting two runners' recordings into one review sheet.
 *
 * The bootstrap records the paper and screen families in separate jobs now,
 * because they need incompatible environments. That splits the workspace too,
 * and the part that does not survive a naive merge is the review sheet: each
 * runner wrote its own `baseline-summary.entries.json`, so taking either one
 * whole means the pull request describes half its own diff — the failure
 * `baselineSummary.js` exists to prevent, arriving by a new route.
 *
 * Plain-node script (`npm run test:bootstrap-collect`).
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ARTIFACT_ROOT_CANDIDATES, artifactDirs, collectRecordings, hollowArtifacts, mergeSummaryEntries,
  recorderJobsFromEnv, resolveVisualRoot,
} from './collectBootstrapRecordings.mjs'
import { BASELINE_SUMMARY_ENTRIES, renderBaselineSummary } from './baselineSummary.js'
import { assertHandoffComplete, resolveExpectedRecordings, writeRecordedCount } from './handoffInvariant.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// `path` is the baseline file this entry describes, relative to `baselines/`.
// The collector verifies each named file actually arrived, so a fixture that
// omitted it would be asserting against a check that cannot run.
const entry = (key, family, section, file = `${key}.png`) => ({
  key, family, path: file, columns: ['Fixture'], cells: [key], section,
})

/**
 * An artifact directory as `download-artifact` lays one out.
 *
 * `prefix` is the layout question this file got wrong. Its fixtures were all
 * built with `tests/visual/…`, matching what the collector assumed rather than
 * what `upload-artifact@v4` produces — so the suite passed while the real
 * handoff collected nothing. Both layouts are now built, and the default is the
 * one CI actually emits.
 */
function artifact(root, name, entries, prefix = '') {
  const artifactRoot = path.join(root, name)
  const dir = path.join(artifactRoot, prefix, 'output')
  mkdirSync(dir, { recursive: true })
  // A baselines tree is what makes this recognisable as a recording at all —
  // and every entry's DECLARED file is written, because the collector verifies
  // each one arrived. A fixture that declared files it did not write would be
  // asserting against a check it permanently fails.
  const baselines = path.join(artifactRoot, prefix, 'baselines')
  mkdirSync(baselines, { recursive: true })
  for (const e of entries ?? []) {
    if (!e.path) continue
    mkdirSync(path.join(baselines, path.dirname(e.path)), { recursive: true })
    writeFileSync(path.join(baselines, e.path), `baseline-${e.key}`)
  }
  if (entries) writeFileSync(path.join(dir, BASELINE_SUMMARY_ENTRIES), JSON.stringify(entries))
  return artifactRoot
}

console.log('visual — collecting the bootstrap recordings')

const tmp = mkdtempSync(path.join(os.tmpdir(), 'bootstrap-collect-'))
try {
  test('no artifacts at all is reported, not treated as an empty success', () => {
    // A run that recorded nothing must not open a pull request describing
    // nothing. The caller exits non-zero on this.
    assert.deepEqual(artifactDirs(path.join(tmp, 'nope')), [])
    assert.deepEqual(mergeSummaryEntries([]), [])
  })

  test('BOTH runners are described, not whichever landed last', () => {
    const root = path.join(tmp, 'both')
    const a = artifact(root, 'bootstrap-recording-paper', [entry('docx/vr-001/learner', 'docx', 'PAPER-1')])
    const b = artifact(root, 'bootstrap-recording-screen', [
      entry('screen/scr-001/phone', 'screen', 'SCREEN-1'),
      entry('screen/scr-001/desktop', 'screen', 'SCREEN-2'),
    ])
    const merged = mergeSummaryEntries([a, b])
    assert.equal(merged.length, 3)
    const sheet = renderBaselineSummary(merged)
    for (const marker of ['PAPER-1', 'SCREEN-1', 'SCREEN-2']) {
      assert.ok(sheet.includes(marker), `${marker} is missing from the merged sheet`)
    }
    assert.match(sheet, /^# 3 baselines recorded/)
    // One index per family, which is what makes a mixed dispatch readable.
    assert.match(sheet, /## docx \(1\)/)
    assert.match(sheet, /## screen \(2\)/)
  })

  test('a narrowed dispatch — one runner skipped — still produces its sheet', () => {
    const root = path.join(tmp, 'one')
    const only = artifact(root, 'bootstrap-recording-screen', [entry('screen/scr-001/phone', 'screen', 'ONLY')])
    const merged = mergeSummaryEntries([only])
    assert.equal(merged.length, 1)
    assert.equal(renderBaselineSummary(merged), 'ONLY')
  })

  test('an artifact with no sidecar is skipped, not fatal', () => {
    // The recorder wrote no NEW baselines — every one already existed. A
    // legitimate outcome; the workflow reports it through its own
    // nothing-to-commit branch.
    const root = path.join(tmp, 'partial')
    const withEntries = artifact(root, 'bootstrap-recording-screen', [entry('screen/a', 'screen', 'S')])
    const without = artifact(root, 'bootstrap-recording-paper', null)
    const merged = mergeSummaryEntries([withEntries, without])
    assert.equal(merged.length, 1)
  })

  test('a damaged sidecar loses that runner, never the other', () => {
    const root = path.join(tmp, 'damaged')
    const good = artifact(root, 'bootstrap-recording-screen', [entry('screen/a', 'screen', 'GOOD')])
    const bad = artifact(root, 'bootstrap-recording-paper', null)
    writeFileSync(path.join(resolveVisualRoot(bad), 'output', BASELINE_SUMMARY_ENTRIES), '{ not json')
    const merged = mergeSummaryEntries([good, bad])
    assert.equal(merged.length, 1)
    assert.equal(merged[0].section, 'GOOD')
  })

  test('artifact directories are discovered by listing, in a stable order', () => {
    const root = path.join(tmp, 'both')
    const dirs = artifactDirs(root).map((d) => path.basename(d))
    assert.deepEqual(dirs, ['bootstrap-recording-paper', 'bootstrap-recording-screen'])
  })

  /* ── the layout the artifact actually has ──────────────────────────────── */

  test('the v4 layout — no tests/visual prefix — is read, not silently skipped', () => {
    // THE BUG. `upload-artifact@v4` roots the archive at the least common
    // ancestor of its search paths, so two paths under `tests/visual` produce a
    // zip holding `baselines/…` and `output/…`. Run 31094944867 uploaded
    // 4,990,794 bytes of correct renders and this script collected zero of them.
    const root = path.join(tmp, 'v4-layout')
    const dir = artifact(root, 'bootstrap-recording-screen', [entry('screen/a', 'screen', 'FLAT')])
    assert.equal(resolveVisualRoot(dir), dir, 'the artifact root IS the tests/visual root here')
    assert.equal(mergeSummaryEntries([dir]).length, 1)
  })

  test('a prefixed layout is still read, so the probe is not a swap', () => {
    // A single-path upload would root at `tests/visual`. Both layouts are
    // supported because the action's rooting rule is its business, not ours —
    // pinning one and being wrong is what happened the first time.
    const root = path.join(tmp, 'prefixed-layout')
    const dir = artifact(root, 'bootstrap-recording-paper', [entry('docx/a', 'docx', 'NESTED')], 'tests/visual')
    assert.equal(resolveVisualRoot(dir), path.join(dir, 'tests/visual'))
    assert.equal(mergeSummaryEntries([dir]).length, 1)
  })

  test('an artifact matching NO known layout resolves to null rather than empty', () => {
    // Distinguishable from "recorded nothing": the caller exits 1 on this and
    // says the recording was lost in transit, instead of printing the
    // nothing-to-commit message that belongs to a completely different outcome.
    const root = path.join(tmp, 'alien-layout')
    const dir = path.join(root, 'bootstrap-recording-screen', 'some/other/place')
    mkdirSync(path.join(dir, 'baselines'), { recursive: true })
    assert.equal(resolveVisualRoot(path.join(root, 'bootstrap-recording-screen')), null)
  })

  test('both candidate layouts are declared, so neither is a bare fallback', () => {
    assert.deepEqual([...ARTIFACT_ROOT_CANDIDATES], ['tests/visual', ''])
  })

  /* ── the handoff invariant ─────────────────────────────────────────────── */

  test('a skipped recorder contributes zero, and its blank count is correct', () => {
    const { expected, byFamily } = resolveExpectedRecordings({
      paper: { result: 'skipped', recorded: '' },
      screen: { result: 'success', recorded: '16' },
    })
    assert.equal(expected, 16)
    assert.deepEqual(byFamily, { paper: 0, screen: 16 })
  })

  test('a SUCCEEDING recorder that reported no count fails — it never defaults to zero', () => {
    // The invariant going missing must not read as "nothing was recorded".
    // Defaulting to 0 would make every later comparison vacuously true.
    assert.throws(() => resolveExpectedRecordings({
      screen: { result: 'success', recorded: '' },
    }), /HANDOFF UNREPORTED/)
    assert.throws(() => resolveExpectedRecordings({
      screen: { result: 'success', recorded: undefined },
    }), /HANDOFF UNREPORTED/)
    assert.throws(() => resolveExpectedRecordings({
      screen: { result: 'success', recorded: 'sixteen' },
    }), /HANDOFF UNREPORTED/)
  })

  test('a recorder that did not succeed is refused, not counted', () => {
    assert.throws(() => resolveExpectedRecordings({
      screen: { result: 'failure', recorded: '16' },
    }), /HANDOFF REFUSED/)
  })

  test('THE BUG: 16 written, 0 arrived → named failure, never "nothing to commit"', () => {
    assert.throws(
      () => assertHandoffComplete({ expected: 16, collected: 0 }),
      (err) => /HANDOFF INCOMPLETE/.test(err.message)
        && /16 baseline\(s\) but only 0 arrived/.test(err.message)
        && /nothing to commit/.test(err.message),
      'the failure must name the count AND the message it must not be confused with',
    )
  })

  test('a PARTIAL arrival fails too — one recorder\'s half is not a pull request', () => {
    assert.throws(() => assertHandoffComplete({ expected: 18, collected: 16 }), /HANDOFF INCOMPLETE/)
  })

  test('MORE arriving than was written fails — a stale sidecar is not evidence', () => {
    assert.throws(() => assertHandoffComplete({ expected: 0, collected: 3 }), /HANDOFF INCONSISTENT/)
  })

  test('the legitimate quiet outcome stays quiet: recorder said 0, 0 arrived', () => {
    // The genuine already-exists re-dispatch. Green, no pull request, and
    // legitimate ONLY because the recorder itself reported zero.
    assert.doesNotThrow(() => assertHandoffComplete({ expected: 0, collected: 0 }))
    assert.doesNotThrow(() => assertHandoffComplete({ expected: 16, collected: 16 }))
  })

  test('the count is published as a job output, appended not overwritten', () => {
    const file = path.join(tmp, 'github-output')
    writeFileSync(file, 'other-step=kept\n')
    assert.equal(writeRecordedCount(16, file), true)
    const written = readFileSync(file, 'utf8')
    assert.match(written, /^other-step=kept$/m, '$GITHUB_OUTPUT is shared by every step in the job')
    assert.match(written, /^recorded=16$/m)
  })

  test('no GITHUB_OUTPUT — every local run — writes nothing and is not an error', () => {
    assert.equal(writeRecordedCount(16, ''), false)
    assert.equal(writeRecordedCount(16, undefined), false)
  })

  test('a recorder refuses to publish a count that would read as zero', () => {
    const file = path.join(tmp, 'github-output-bad')
    assert.throws(() => writeRecordedCount(undefined, file), /HANDOFF UNREPORTABLE/)
    assert.throws(() => writeRecordedCount(-1, file), /HANDOFF UNREPORTABLE/)
  })

  test('the environment names the workflow sets are the ones read', () => {
    const jobs = recorderJobsFromEnv({
      PAPER_RESULT: 'skipped', PAPER_RECORDED: '',
      SCREEN_RESULT: 'success', SCREEN_RECORDED: '16',
    })
    assert.equal(resolveExpectedRecordings(jobs).expected, 16)
  })

  /* ── end to end, which is the level every defect here has lived at ─────── */

  /** A recorder's artifact: N baselines described, N PNGs, and its rendered pages. */
  function recording(root, name, count, prefix = '') {
    const dir = path.join(root, name)
    const visual = path.join(dir, prefix)
    const entries = []
    for (let i = 1; i <= count; i += 1) {
      const id = `scr-${String(i).padStart(3, '0')}`
      entries.push(entry(`screen/${id}/phone`, 'screen', `SECTION-${i}`,
        `screen/chromium-1/${id}/phone.png`))
      const baseline = path.join(visual, 'baselines/screen/chromium-1', id)
      mkdirSync(baseline, { recursive: true })
      writeFileSync(path.join(baseline, 'phone.png'), `png-${i}`)
      const rendered = path.join(visual, 'output/screen', id)
      mkdirSync(rendered, { recursive: true })
      writeFileSync(path.join(rendered, 'phone.png'), `render-${i}`)
    }
    mkdirSync(path.join(visual, 'output'), { recursive: true })
    mkdirSync(path.join(visual, 'baselines'), { recursive: true })
    writeFileSync(path.join(visual, 'output', BASELINE_SUMMARY_ENTRIES), JSON.stringify(entries))
    return dir
  }

  const succeeded = (n) => ({
    paper: { result: 'skipped', recorded: '' },
    screen: { result: 'success', recorded: String(n) },
  })

  test('END TO END: 16 recorded in the v4 layout arrive as 16 baselines and a sheet', () => {
    const incoming = path.join(tmp, 'e2e-ok/incoming')
    const dest = path.join(tmp, 'e2e-ok/dest')
    mkdirSync(incoming, { recursive: true })
    recording(incoming, 'bootstrap-recording-screen', 16)

    const result = collectRecordings({ incoming, destRoot: dest, jobs: succeeded(16) })
    assert.equal(result.entries.length, 16)
    // The baselines that become the diff.
    assert.equal(readFileSync(path.join(dest, 'tests/visual/baselines/screen/chromium-1/scr-001/phone.png'), 'utf8'), 'png-1')
    // The rendered pages the review sheet promises are attached to the run —
    // Codex's P2 on #2138: this loop copied only the baselines, so the evidence
    // artifact was 309 bytes of rebuilt summary and no pages at all.
    assert.equal(readFileSync(path.join(dest, 'tests/visual/output/screen/scr-016/phone.png'), 'utf8'), 'render-16')
    // And one merged sheet describing all of them.
    const sheet = readFileSync(path.join(dest, 'tests/visual/output/baseline-summary.md'), 'utf8')
    assert.match(sheet, /^# 16 baselines recorded/)
  })

  test('END TO END: the reported bug — renders present, layout unknown → loud failure', () => {
    // The artifact carries its trees at a depth neither candidate covers. Before
    // the invariant this returned zero entries and the workflow printed
    // "Every baseline already exists — nothing was recorded" and exited 0.
    const incoming = path.join(tmp, 'e2e-lost/incoming')
    const dest = path.join(tmp, 'e2e-lost/dest')
    mkdirSync(incoming, { recursive: true })
    recording(incoming, 'bootstrap-recording-screen', 16, 'some/unexpected/depth')

    assert.throws(
      () => collectRecordings({ incoming, destRoot: dest, jobs: succeeded(16) }),
      /HANDOFF UNREADABLE/,
    )
  })

  test('END TO END: renders findable but sidecar lost → INCOMPLETE, not "nothing to commit"', () => {
    // The other half of the same failure: the trees are found, so the copy
    // works, but the sheet's sidecar did not survive. 16 written, 0 described.
    const incoming = path.join(tmp, 'e2e-partial/incoming')
    const dest = path.join(tmp, 'e2e-partial/dest')
    mkdirSync(incoming, { recursive: true })
    const dir = recording(incoming, 'bootstrap-recording-screen', 16)
    rmSync(path.join(dir, 'output', BASELINE_SUMMARY_ENTRIES))

    assert.throws(
      () => collectRecordings({ incoming, destRoot: dest, jobs: succeeded(16) }),
      /HANDOFF INCOMPLETE: the recorders wrote 16 baseline\(s\) but only 0 arrived/,
    )
  })

  /* ── an artifact that describes what it did not bring ──────────────────── */

  test('a hollow artifact — sidecar present, baselines tree gone — is named', () => {
    // The case the COUNT invariant structurally cannot catch: both sides of that
    // comparison are read from the sidecar this artifact still has, so sixteen
    // expected meets sixteen merged and it passes. Then `git add` stages nothing
    // and the run reports "nothing to commit" — over a body approving sixteen
    // baselines. Found by the parallel implementation in #2142.
    const root = path.join(tmp, 'hollow')
    const dir = path.join(root, 'bootstrap-recording-screen')
    mkdirSync(path.join(dir, 'output'), { recursive: true })
    mkdirSync(path.join(dir, 'baselines'), { recursive: true })
    writeFileSync(path.join(dir, 'output', BASELINE_SUMMARY_ENTRIES),
      JSON.stringify([entry('screen/a', 'screen', 'A'), entry('screen/b', 'screen', 'B')]))
    const hollow = hollowArtifacts([dir])
    assert.equal(hollow.length, 1)
    assert.match(hollow[0], /describes 2 baseline\(s\) but 2 did not arrive/)
  })

  test('THE DEFECT: a screen artifact carrying only the OTHER families\' baselines', () => {
    // Codex on #2142 (r3729107231), three minutes after that pull request
    // merged. Every recorder uploads `tests/visual/baselines/**` from a checkout
    // that ALREADY holds the committed browser-print and docx baselines, so
    // "does a baselines/ tree exist" is true of an artifact that lost every one
    // of its own new pages. The check passed on exactly the dispatch it exists
    // for. Each described FILE is checked now.
    const root = path.join(tmp, 'other-families-only')
    const dir = path.join(root, 'bootstrap-recording-screen')
    mkdirSync(path.join(dir, 'output'), { recursive: true })
    // The tracked tree the checkout brings, entirely unrelated to this dispatch.
    for (const tracked of ['browser-print/chromium-151/vr-001/paper', 'docx/libreoffice-24/vr-001/paper']) {
      mkdirSync(path.join(dir, 'baselines', tracked), { recursive: true })
      writeFileSync(path.join(dir, 'baselines', tracked, 'page-1.png'), 'committed')
    }
    writeFileSync(path.join(dir, 'output', BASELINE_SUMMARY_ENTRIES), JSON.stringify([
      entry('screen/scr-001/phone', 'screen', 'A', 'screen/chromium-1/scr-001/phone.png'),
      entry('screen/scr-001/desktop', 'screen', 'B', 'screen/chromium-1/scr-001/desktop.png'),
    ]))
    const hollow = hollowArtifacts([dir])
    assert.equal(hollow.length, 1, 'a non-empty baselines/ tree of OTHER files is not arrival')
    assert.match(hollow[0], /2 did not arrive/)
    assert.match(hollow[0], /screen\/chromium-1\/scr-001\/phone\.png/)
  })

  test('an entry that names no file is refused, not waved through', () => {
    // Unverifiable is not fine. Accepting it is how the tree check passed.
    const root = path.join(tmp, 'unnamed')
    const dir = path.join(root, 'bootstrap-recording-screen')
    mkdirSync(path.join(dir, 'output'), { recursive: true })
    mkdirSync(path.join(dir, 'baselines'), { recursive: true })
    writeFileSync(path.join(dir, 'output', BASELINE_SUMMARY_ENTRIES),
      JSON.stringify([{ key: 'screen/a', family: 'screen', columns: ['F'], cells: ['a'], section: 'A' }]))
    const hollow = hollowArtifacts([dir])
    assert.equal(hollow.length, 1, 'an entry naming no file must be reported, not skipped')
    assert.match(hollow[0], /do not name the baseline file they describe/)
  })

  test('a WHOLE artifact is not hollow, and neither is one describing nothing', () => {
    // The second half matters as much: a recorder that wrote no new baselines
    // legitimately ships no baselines tree, and calling that hollow would fail
    // every already-exists re-dispatch.
    const root = path.join(tmp, 'whole')
    const whole = artifact(root, 'bootstrap-recording-screen', [entry('screen/a', 'screen', 'A')])
    assert.deepEqual(hollowArtifacts([whole]), [])
    // Two ways to describe nothing, and they take different paths through the
    // check. No sidecar at all exits early; a sidecar holding an EMPTY list gets
    // as far as the count — and only the second exercises `if (!describes)`,
    // which is why the first alone left that line untested and a mutation
    // deleting it uncaught.
    const noSidecar = path.join(root, 'bootstrap-recording-paper')
    mkdirSync(path.join(noSidecar, 'output'), { recursive: true })
    assert.deepEqual(hollowArtifacts([noSidecar]), [])

    const emptySidecar = path.join(root, 'bootstrap-recording-docx')
    mkdirSync(path.join(emptySidecar, 'output'), { recursive: true })
    writeFileSync(path.join(emptySidecar, 'output', BASELINE_SUMMARY_ENTRIES), '[]')
    assert.deepEqual(hollowArtifacts([emptySidecar]), [],
      'a recorder that wrote nothing ships no baselines tree, and that is not hollow')
  })

  test('END TO END: a hollow artifact stops the run instead of opening an empty PR', () => {
    const incoming = path.join(tmp, 'e2e-hollow/incoming')
    const dest = path.join(tmp, 'e2e-hollow/dest')
    mkdirSync(incoming, { recursive: true })
    const dir = recording(incoming, 'bootstrap-recording-screen', 16)
    // ONE page lost, not the whole tree — the realistic shape, and the one a
    // tree-existence check cannot see at all.
    rmSync(path.join(dir, 'baselines/screen/chromium-1/scr-007'), { recursive: true })

    assert.throws(
      () => collectRecordings({ incoming, destRoot: dest, jobs: succeeded(16) }),
      (err) => /HANDOFF HOLLOW/.test(err.message)
        && /1 did not arrive/.test(err.message)
        && /scr-007/.test(err.message)
        // Named on its own terms — this is not a miscount, and calling it one
        // would send whoever reads it looking in the wrong place.
        && !/HANDOFF INCOMPLETE/.test(err.message),
      'a hollow artifact is reported as hollow, not as a count mismatch',
    )
  })

  test('END TO END: the genuine already-exists re-dispatch stays green and quiet', () => {
    // Fourth dispatch of an armed family: the recorder wrote nothing because
    // every baseline existed, and said so. No pull request, no failure.
    const incoming = path.join(tmp, 'e2e-noop/incoming')
    const dest = path.join(tmp, 'e2e-noop/dest')
    mkdirSync(incoming, { recursive: true })
    recording(incoming, 'bootstrap-recording-screen', 0)

    const result = collectRecordings({ incoming, destRoot: dest, jobs: succeeded(0) })
    assert.equal(result.entries.length, 0)
    assert.equal(result.expected, 0)
  })
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\nbootstrap collection: ${passed} passed`)
