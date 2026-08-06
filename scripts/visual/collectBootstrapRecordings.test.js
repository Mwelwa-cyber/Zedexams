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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { artifactDirs, mergeSummaryEntries } from './collectBootstrapRecordings.mjs'
import { BASELINE_SUMMARY_ENTRIES, renderBaselineSummary } from './baselineSummary.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const entry = (key, family, section) => ({
  key, family, columns: ['Fixture'], cells: [key], section,
})

/** An artifact directory as `download-artifact` lays one out. */
function artifact(root, name, entries) {
  const artifactRoot = path.join(root, name)
  const dir = path.join(artifactRoot, 'tests/visual/output')
  mkdirSync(dir, { recursive: true })
  if (entries) writeFileSync(path.join(dir, BASELINE_SUMMARY_ENTRIES), JSON.stringify(entries))
  // The ARTIFACT directory, which is what `mergeSummaryEntries` takes — it
  // joins the `tests/visual/output` part itself.
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
    writeFileSync(path.join(bad, 'tests/visual/output', BASELINE_SUMMARY_ENTRIES), '{ not json')
    const merged = mergeSummaryEntries([good, bad])
    assert.equal(merged.length, 1)
    assert.equal(merged[0].section, 'GOOD')
  })

  test('artifact directories are discovered by listing, in a stable order', () => {
    const root = path.join(tmp, 'both')
    const dirs = artifactDirs(root).map((d) => path.basename(d))
    assert.deepEqual(dirs, ['bootstrap-recording-paper', 'bootstrap-recording-screen'])
  })
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\nbootstrap collection: ${passed} passed`)
