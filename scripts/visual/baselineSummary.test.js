/**
 * The baseline review sheet — and the screen recorder's half of it.
 *
 * ## The failure this suite exists for
 *
 * `visual-baseline-bootstrap.yml` treats a missing review sheet as a hard stop:
 * baselines nobody can review must not become a pull request. The screen
 * recorder never wrote one, so `family=screen` recorded 16 images, committed
 * them, pushed the branch — and then failed at `gh pr create`. Everything
 * expensive succeeded; the cheap part was absent; and the workflow-side
 * assertion could not see it, because it checks the workflow, not the recorder.
 *
 * So this suite builds the sheet the SCREEN bootstrap would build, from the real
 * fixture set, and asserts it describes every capture. No browser is involved —
 * the section builder takes bytes, and a synthetic PNG is enough to prove the
 * sheet is produced and complete. What a browser is needed for (that the images
 * are RIGHT) is the owner's review, which is what the sheet exists to enable.
 *
 * Plain-node script (`npm run test:baseline-summary`).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BASELINE_SUMMARY_FILE, BASELINE_SUMMARY_ENTRIES,
  appendBaselineSummaryEntry, renderBaselineSummary,
} from './baselineSummary.js'
import { screenBaselineEntry, SCREEN_REVIEW_CHECKLIST } from './screen/screenBaselineSummary.js'
import { SCREEN_FIXTURES, SCREEN_VIEWPORTS } from './screen/screenFixtures.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'baseline-summary-'))
const entry = (over = {}) => ({
  key: 'screen/scr-001/phone',
  family: 'screen',
  columns: ['Fixture', 'Viewport'],
  cells: ['scr-001', 'phone'],
  section: 'Recorded **scr-001/phone**.',
  ...over,
})

const environment = {
  chromium: '131.0.0.0',
  os: 'linux x64',
  fonts: { count: 42, digest: 'abc123' },
}

console.log('visual — the baseline review sheet')

// ── The sheet's own rules ────────────────────────────────────────────────────

test('one entry gets its section and no index — a one-row table is furniture', () => {
  const sheet = renderBaselineSummary([entry()])
  assert.equal(sheet, 'Recorded **scr-001/phone**.')
})

test('the count leads, and it is the true total', () => {
  // The number a reviewer checks against the diff. If it can disagree with the
  // number of sections, the sheet is worse than no sheet.
  const entries = [entry(), entry({ key: 'screen/scr-002/phone', cells: ['scr-002', 'phone'], section: 'B' })]
  const sheet = renderBaselineSummary(entries)
  assert.match(sheet, /^# 2 baselines recorded/)
  assert.equal(sheet.split('Recorded').length - 1, 1)
  assert.ok(sheet.includes('B'))
})

test('EVERY entry is described, not the last one', () => {
  // The original failure mode of this file, one level up: a recorder that wrote
  // the sheet per record described only its final baseline, and a reviewer
  // approved eighteen from evidence about one.
  const entries = Array.from({ length: 16 }, (_, i) => entry({
    key: `screen/scr-${i}/phone`, cells: [`scr-${i}`, 'phone'], section: `SECTION-${i}`,
  }))
  const sheet = renderBaselineSummary(entries)
  for (let i = 0; i < 16; i += 1) assert.ok(sheet.includes(`SECTION-${i}`), `section ${i} is missing`)
  assert.match(sheet, /^# 16 baselines recorded/)
})

test('each family gets its own index, because they describe themselves differently', () => {
  const sheet = renderBaselineSummary([
    entry(),
    entry({
      key: 'docx/vr-001/learner', family: 'docx',
      columns: ['Fixture', 'Copy', 'Pages'], cells: ['vr-001', 'learner', '3'], section: 'PAPER',
    }),
  ])
  assert.match(sheet, /## screen \(1\)/)
  assert.match(sheet, /## docx \(1\)/)
  assert.match(sheet, /\| Fixture \| Viewport \|/)
  assert.match(sheet, /\| Fixture \| Copy \| Pages \|/)
})

test('a family that disagrees with itself about its columns is refused', () => {
  // Silently taking the first row's headers would print a table whose columns
  // do not describe its rows.
  assert.throws(() => renderBaselineSummary([
    entry(),
    entry({ key: 'k2', columns: ['Fixture'], cells: ['scr-002'] }),
  ]), /disagree about the index columns/)
})

test('an entry missing its parts is refused at the door', () => {
  const dir = tmp()
  try {
    for (const bad of [
      entry({ section: '' }),
      entry({ family: '' }),
      entry({ key: '' }),
      entry({ columns: ['A', 'B'], cells: ['only-one'] }),
      entry({ columns: [], cells: [] }),
    ]) {
      assert.throws(() => appendBaselineSummaryEntry(dir, bad))
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── Accumulation across recorders ────────────────────────────────────────────

test('a second recorder ADDS to the sheet rather than erasing it', () => {
  // `family=all` runs both recorders into one output directory. Written
  // outright, the second would erase the first's half and the pull request
  // would describe half its own diff.
  const dir = tmp()
  try {
    appendBaselineSummaryEntry(dir, entry({ section: 'SCREEN-ONE' }))
    const { file, entries } = appendBaselineSummaryEntry(dir, entry({
      key: 'docx/vr-001/learner', family: 'docx',
      columns: ['Fixture', 'Copy', 'Pages'], cells: ['vr-001', 'learner', '3'], section: 'PAPER-ONE',
    }))
    assert.equal(entries.length, 2)
    const sheet = readFileSync(file, 'utf8')
    assert.ok(sheet.includes('SCREEN-ONE'))
    assert.ok(sheet.includes('PAPER-ONE'))
    assert.match(sheet, /^# 2 baselines recorded/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('re-recording the same target does not double-count it', () => {
  const dir = tmp()
  try {
    appendBaselineSummaryEntry(dir, entry({ section: 'FIRST' }))
    const { entries } = appendBaselineSummaryEntry(dir, entry({ section: 'SECOND' }))
    assert.equal(entries.length, 1)
    assert.equal(readFileSync(path.join(dir, BASELINE_SUMMARY_FILE), 'utf8'), 'SECOND')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a damaged sidecar loses history but never the run in progress', () => {
  // Throwing here would abandon baselines already written to disk with no sheet
  // at all — trading a partial record for none.
  const dir = tmp()
  try {
    appendBaselineSummaryEntry(dir, entry())
    writeFileSync(path.join(dir, BASELINE_SUMMARY_ENTRIES), '{ not json')
    const { entries } = appendBaselineSummaryEntry(dir, entry({ key: 'k2', section: 'AFTER' }))
    assert.equal(entries.length, 1)
    assert.equal(entries[0].section, 'AFTER')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── The screen bootstrap's sheet, built for real ─────────────────────────────

/** A capture as `screenStage` returns one, minus the browser. */
const fakeCapture = (fixture, viewport) => ({
  fixture,
  viewport,
  png: Buffer.from(`fake-png:${fixture.id}:${viewport.id}`),
  width: viewport.width * viewport.deviceScaleFactor,
  height: 1200,
  identity: 'screen/chromium-131.0.0.0',
  environment,
  reason: 'first recording of the learner-screen family',
  source: '2129',
  sourceCommit: 'deadbeef',
})

function buildScreenSheet(dir) {
  let last
  for (const fixture of SCREEN_FIXTURES) {
    for (const viewport of SCREEN_VIEWPORTS) {
      last = appendBaselineSummaryEntry(dir, screenBaselineEntry(fakeCapture(fixture, viewport)))
    }
  }
  return { ...last, sheet: readFileSync(path.join(dir, BASELINE_SUMMARY_FILE), 'utf8') }
}

test('the SCREEN bootstrap produces a review sheet at the path the workflow reads', () => {
  // The assertion whose absence let a green main ship a bootstrap that could
  // never open its pull request.
  const dir = tmp()
  try {
    const { sheet } = buildScreenSheet(dir)
    assert.ok(existsSync(path.join(dir, BASELINE_SUMMARY_FILE)))
    assert.ok(sheet.length > 0, 'the sheet is empty — the workflow would open an unreviewable pull request')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('it describes every capture the bootstrap would record', () => {
  const dir = tmp()
  try {
    const expected = SCREEN_FIXTURES.length * SCREEN_VIEWPORTS.length
    const { entries, sheet } = buildScreenSheet(dir)
    assert.equal(entries.length, expected)
    assert.match(sheet, new RegExp(`^# ${expected} baselines recorded`))
    for (const fixture of SCREEN_FIXTURES) {
      for (const viewport of SCREEN_VIEWPORTS) {
        assert.ok(sheet.includes(`Recorded **${fixture.id}/${viewport.id}**`),
          `${fixture.id}/${viewport.id} is in the diff but not in the sheet`)
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a section carries what a reviewer needs to approve one image', () => {
  const [fixture] = SCREEN_FIXTURES
  const [viewport] = SCREEN_VIEWPORTS
  const { section } = screenBaselineEntry(fakeCapture(fixture, viewport))
  assert.ok(section.includes(fixture.title))
  for (const claim of fixture.protects) assert.ok(section.includes(claim), `"${claim}" is not stated`)
  assert.ok(section.includes('screen/chromium-131.0.0.0'), 'the baseline identity is not stated')
  assert.ok(section.includes('first recording of the learner-screen family'), 'the reason is not stated')
  assert.ok(section.includes('deadbeef'), 'the commit being approved is not stated')
  assert.match(section, /\| Device scale \| 2× \|/)
  // The bytes being approved. A baseline is a reference other work is measured
  // against, so "which bytes" must be answerable from the record rather than
  // from an artefact that expires in a fortnight.
  assert.match(section, /\| `[a-f0-9]{64}` \|/)
})

test('a section names the page checks that ran, and describes each one', () => {
  // The part a pixel comparison structurally cannot do. A baseline recorded from
  // wrong output looks identical, forever, to one recorded from right output —
  // so the sheet has to say what was measured before the shutter.
  const maths = SCREEN_FIXTURES.find((f) => f.id === 'scr-006')
  const { section } = screenBaselineEntry(fakeCapture(maths, SCREEN_VIEWPORTS[0]))
  assert.ok(maths.pageChecks.includes('stackedNotation'))
  for (const name of maths.pageChecks) {
    assert.ok(section.includes(`\`${name}\``), `${name} ran but is not named in the sheet`)
  }
  assert.ok(!section.includes('not implemented'), 'a declared check has no description')
  // A markdown table with no header row does not render as a table on GitHub,
  // which is where this is read. Caught by running the real bootstrap and
  // looking at the file it produced.
  assert.match(section, /\| Check \| What it measures \|\n\|---\|---\|\n\| `stackedNotation`/)

  // A fixture with no declared checks says so rather than printing an empty
  // table — "watched by pixels alone" is a fact a reviewer should see.
  const bare = screenBaselineEntry(fakeCapture({ ...maths, pageChecks: [] }, SCREEN_VIEWPORTS[0]))
  assert.ok(bare.section.includes('watched by pixels alone'))
  assert.ok(!bare.section.includes('| Check |'))
})

test('every section asks the reviewer to look at the thing the pixels cannot certify', () => {
  const dir = tmp()
  try {
    const { sheet } = buildScreenSheet(dir)
    for (const line of SCREEN_REVIEW_CHECKLIST) {
      assert.ok(sheet.includes(line), `the reviewer is not asked to check: ${line}`)
    }
    // The two §4/§4.1 claims the whole family exists for.
    assert.match(sheet, /STACKED/)
    assert.match(sheet, /ONE vertical column/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

console.log(`\nbaseline review sheet: ${passed} passed`)
