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
 * The second half of these tests is about the route the merge itself cannot
 * see. Merging what arrived cannot notice what did not, so a recorder that
 * succeeded and whose artifact was lost produced the same half-a-diff by
 * silence. What is owed is therefore read from the recorders' job results, and
 * a result that was never supplied is refused rather than read as nothing owed.
 *
 * Plain-node script (`npm run test:bootstrap-collect`).
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  RECORDERS, artifactDirs, expectedRecordings, mergeSummaryEntries, missingRecordings,
} from './collectBootstrapRecordings.mjs'
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

/**
 * An artifact directory as `download-artifact` lays one out.
 *
 * `baselines` defaults true because a real recorder uploads that tree with
 * every recording; the tests that pass false are the ones about losing it.
 */
function artifact(root, name, entries, { baselines = true } = {}) {
  const artifactRoot = path.join(root, name)
  const dir = path.join(artifactRoot, 'tests/visual/output')
  mkdirSync(dir, { recursive: true })
  if (baselines) mkdirSync(path.join(artifactRoot, 'tests/visual/baselines'), { recursive: true })
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

  /* ── the recordings must ARRIVE ────────────────────────────────────────────
     Merging what came back cannot notice what did not: a union of the entries
     that were downloaded has no gap where the ones that were never downloaded
     would have been. So what is owed is read from the recorders' job results,
     before anything is collected. */

  const results = (paper, screen) => ({ 'record-paper': paper, 'record-screen': screen })
  const jobs = (list) => list.map((r) => r.job).sort()

  test('a recorder that SUCCEEDED owes an artifact; a skipped one owes nothing', () => {
    const both = expectedRecordings(results('success', 'success'))
    assert.deepEqual(jobs(both.owed), ['record-paper', 'record-screen'])
    assert.deepEqual(both.skipped, [])
    assert.deepEqual(both.unknown, [])

    // The narrowed dispatch this workflow supports: `family=screen` skips the
    // paper recorder, and a skipped recorder must not be looked for.
    const narrowed = expectedRecordings(results('skipped', 'success'))
    assert.deepEqual(jobs(narrowed.owed), ['record-screen'])
    assert.deepEqual(jobs(narrowed.skipped), ['record-paper'])
    assert.deepEqual(narrowed.unknown, [])
  })

  test('a result this script was not given is refused, never read as "nothing owed"', () => {
    // The whole point. If an absent result meant an absent obligation, then
    // dropping the `env:` block that supplies it would disarm the check while
    // every run stayed green — the failure mode this exists to end, restored by
    // deleting four lines of YAML nobody would connect to it.
    for (const missing of [undefined, '', '   ']) {
      const { owed, unknown } = expectedRecordings(results(missing, 'success'))
      assert.deepEqual(jobs(owed), ['record-screen'], 'the recorder that DID report is unaffected')
      assert.deepEqual(jobs(unknown), ['record-paper'])
    }
    // Nothing supplied at all is refused wholesale rather than collected from.
    assert.deepEqual(jobs(expectedRecordings().unknown), ['record-paper', 'record-screen'])
  })

  test('a result that cannot reach this job is refused rather than guessed at', () => {
    // `failure` and `cancelled` are excluded by the workflow's own `if:`. Seeing
    // one means the condition changed, and the safe reading of a state that was
    // meant to be impossible is not "carry on".
    for (const result of ['failure', 'cancelled', 'succeeded', 'true']) {
      const { unknown } = expectedRecordings(results(result, 'skipped'))
      assert.deepEqual(jobs(unknown), ['record-paper'], `${result} is not treated as an outcome`)
    }
    // …while the two real values still read as themselves through the padding a
    // YAML expression can leave behind. Trimming is why the check above is
    // about the VALUE and not about whitespace.
    assert.deepEqual(jobs(expectedRecordings(results(' success ', '\tskipped\n')).owed), ['record-paper'])
    assert.deepEqual(expectedRecordings(results(' success ', '\tskipped\n')).unknown, [])
  })

  test('an owed recording that never arrived is named, with the families it costs', () => {
    const root = path.join(tmp, 'lost')
    artifact(root, 'bootstrap-recording-screen', [entry('screen/a', 'screen', 'S')])
    const { owed } = expectedRecordings(results('success', 'success'))
    const lost = missingRecordings(owed, root)
    assert.deepEqual(jobs(lost), ['record-paper'])
    assert.match(lost[0].why, /no artifact by that name/)
    // The message has to be actionable: which artifact was expected, and what
    // the review loses without it.
    assert.equal(lost[0].artifact, 'bootstrap-recording-paper')
    assert.match(lost[0].families, /browser-print/)
  })

  test('an artifact that arrived without its baselines counts as lost', () => {
    // Worse than an absent one, because it is invisible: the summary sidecar
    // still merges, so the review sheet describes baselines that never reach
    // the commit — a pull request whose body and whose diff disagree.
    const root = path.join(tmp, 'hollow')
    artifact(root, 'bootstrap-recording-paper', [entry('docx/a', 'docx', 'P')], { baselines: false })
    artifact(root, 'bootstrap-recording-screen', [entry('screen/a', 'screen', 'S')])
    const { owed } = expectedRecordings(results('success', 'success'))
    const lost = missingRecordings(owed, root)
    assert.deepEqual(jobs(lost), ['record-paper'])
    assert.match(lost[0].why, /without its tests\/visual\/baselines tree/)
  })

  test('a complete run reports nothing lost, and a narrowed one does not invent a loss', () => {
    const root = path.join(tmp, 'complete')
    artifact(root, 'bootstrap-recording-paper', [entry('docx/a', 'docx', 'P')])
    artifact(root, 'bootstrap-recording-screen', [entry('screen/a', 'screen', 'S')])
    assert.deepEqual(missingRecordings(expectedRecordings(results('success', 'success')).owed, root), [])

    // `family=browser-print`: the screen recorder is skipped, so its absent
    // artifact is the expected outcome and must not fail the run.
    const narrowed = path.join(tmp, 'narrowed')
    artifact(narrowed, 'bootstrap-recording-paper', [entry('docx/a', 'docx', 'P')])
    assert.deepEqual(missingRecordings(expectedRecordings(results('success', 'skipped')).owed, narrowed), [])
  })

  test('every recorder declares the artifact and the env var that pair it up', () => {
    // A third renderer family adds a recorder job, an entry here, and the
    // arrival check with it — rather than a job whose loss nothing looks for.
    assert.deepEqual(RECORDERS.map((r) => r.job), ['record-paper', 'record-screen'])
    for (const recorder of RECORDERS) {
      assert.match(recorder.artifact, /^bootstrap-recording-/, `${recorder.job}: matched by the download pattern`)
      assert.match(recorder.env, /^RECORD_[A-Z]+_RESULT$/, `${recorder.job}: names the variable the workflow sets`)
      assert.ok(recorder.families, `${recorder.job}: says what a loss costs the review`)
    }
  })
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\nbootstrap collection: ${passed} passed`)
