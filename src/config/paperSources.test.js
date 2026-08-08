/**
 * The source registry, and the two things it must never get wrong:
 *
 *   1. a mock is never reported as official
 *   2. a paper of unknown provenance is never reported as showable
 *
 * Both are fail-closed, so every "unknown input" case here asserts the CLOSED
 * answer rather than merely asserting no throw.
 *
 * Plain-node script — `npm run test:paper-sources`.
 */

import assert from 'node:assert/strict'
import {
  LEGACY_PAPER_NUMBERS,
  PAPER_META_VERSION,
  PAPER_NUMBERS,
  PAPER_SOURCES,
  SOURCE_CONFIDENCE,
  comparePapersBySource,
  getPaperSource,
  isOfficialSource,
  listPaperNumbers,
  listPaperSources,
  normalizePaperNumberToken,
  normalizeSourceConfidence,
  normalizeSourceId,
  paperNumberLabel,
  paperSourceDescriptor,
  paperSourceIsLearnerVisible,
  paperSourceLabel,
} from './paperSources.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('\npaperSources — the registry')

test('every entry is keyed by its own id', () => {
  for (const [key, entry] of Object.entries(PAPER_SOURCES)) {
    assert.equal(key, entry.id, `${key} is filed under a different id than it carries`)
  }
})

test('every entry declares the four fields every consumer reads', () => {
  for (const entry of Object.values(PAPER_SOURCES)) {
    assert.equal(typeof entry.label, 'string')
    assert.ok(entry.label.length, `${entry.id} has no badge label`)
    assert.equal(typeof entry.fullName, 'string')
    assert.equal(typeof entry.isOfficial, 'boolean')
    assert.equal(typeof entry.descriptor, 'string')
  }
})

test('exactly one source is official — ECZ', () => {
  const official = Object.values(PAPER_SOURCES).filter((s) => s.isOfficial)
  assert.deepEqual(official.map((s) => s.id), ['ecz'])
})

test('every non-official descriptor says it is not an ECZ exam', () => {
  // The badge label carries the meaning; the descriptor is what a learner
  // reads underneath it, and "not an ECZ exam" is the whole message.
  for (const entry of Object.values(PAPER_SOURCES)) {
    if (entry.isOfficial) continue
    assert.match(entry.descriptor, /not an ECZ exam/i, `${entry.id} does not disclaim`)
  }
})

console.log('\npaperSources — official is fail-closed')

test('a known official source is official', () => {
  assert.equal(isOfficialSource('ecz'), true)
})

test('every mock source is NOT official', () => {
  for (const id of ['prisca', 'school_mock', 'other']) {
    assert.equal(isOfficialSource(id), false, `${id} claimed to be official`)
  }
})

test('unknown / missing / malformed sources are NOT official', () => {
  for (const value of [null, undefined, '', '   ', 'ECZ Zambia', 'unknown', 42, {}, []]) {
    assert.equal(isOfficialSource(value), false, `${JSON.stringify(value)} claimed to be official`)
  }
})

test('getPaperSource is case- and whitespace-tolerant, and never throws', () => {
  assert.equal(getPaperSource(' ECZ ')?.id, 'ecz')
  assert.equal(getPaperSource(null), null)
  assert.equal(getPaperSource(7), null)
})

console.log('\npaperSources — resolving written spellings')

test('ids, labels and full names all resolve', () => {
  assert.equal(normalizeSourceId('ecz'), 'ecz')
  assert.equal(normalizeSourceId('ECZ'), 'ecz')
  assert.equal(normalizeSourceId('Examinations Council of Zambia'), 'ecz')
  assert.equal(normalizeSourceId('PRISCA mock'), 'prisca')
  assert.equal(normalizeSourceId('school_mock'), 'school_mock')
  assert.equal(normalizeSourceId('school-mock'), 'school_mock')
  assert.equal(normalizeSourceId('School mock'), 'school_mock')
})

test('an unrecognised spelling resolves to null, not to "other"', () => {
  // null means "we do not know"; 'other' means a human said "some publisher".
  // Collapsing the first into the second would label an unknown paper.
  assert.equal(normalizeSourceId('Zambia Publishing House'), null)
  assert.equal(normalizeSourceId(''), null)
  assert.equal(normalizeSourceId(undefined), null)
})

test('labels and descriptors are null for a source we do not have', () => {
  assert.equal(paperSourceLabel('nope'), null)
  assert.equal(paperSourceDescriptor('nope'), null)
})

test('listPaperSources puts the official one first and copies the array', () => {
  const list = listPaperSources()
  assert.equal(list[0].id, 'ecz')
  assert.equal(list.length, Object.keys(PAPER_SOURCES).length)
  list.reverse()
  assert.equal(listPaperSources()[0].id, 'ecz', 'a caller reordered the registry for everyone')
})

console.log('\npaperSources — paper numbers')

test('numbers come back as numbers, words as words', () => {
  assert.equal(normalizePaperNumberToken(1), 1)
  assert.equal(normalizePaperNumberToken('2'), 2)
  assert.equal(normalizePaperNumberToken('Paper 1'), 1)
  assert.equal(normalizePaperNumberToken('special'), 'special')
  assert.equal(normalizePaperNumberToken(' Mock '), 'mock')
})

test('the legacy ints already in the archive still read back', () => {
  for (const n of LEGACY_PAPER_NUMBERS) {
    assert.equal(normalizePaperNumberToken(n), n, `a stored Paper ${n} was discarded`)
  }
})

test('nothing, and nonsense, is null', () => {
  for (const value of [null, undefined, '', '   ', 'paper', 0, 9, 1.5, {}]) {
    assert.equal(normalizePaperNumberToken(value), null, `${JSON.stringify(value)} became a paper number`)
  }
})

test('labels come from the registry, and a legacy number still gets one', () => {
  assert.equal(paperNumberLabel(1), PAPER_NUMBERS[1])
  assert.equal(paperNumberLabel('special'), PAPER_NUMBERS.special)
  assert.equal(paperNumberLabel(3), 'Paper 3')
  assert.equal(paperNumberLabel(null), null)
})

test('the picker offers exactly what the registry declares', () => {
  assert.deepEqual(listPaperNumbers().map((n) => n.value), [1, 2, 'special', 'mock'])
})

console.log('\npaperSources — learner visibility is fail-closed')

test('an explicit or inferred source is visible', () => {
  assert.equal(paperSourceIsLearnerVisible({ source: 'ecz', sourceConfidence: 'explicit' }), true)
  assert.equal(paperSourceIsLearnerVisible({ source: 'prisca', sourceConfidence: 'inferred' }), true)
})

test('an unknown confidence is NOT visible', () => {
  assert.equal(paperSourceIsLearnerVisible({ source: 'ecz', sourceConfidence: 'unknown' }), false)
})

test('a missing source is NOT visible even at explicit confidence', () => {
  // "A human confirmed there is no source" is not a source.
  assert.equal(paperSourceIsLearnerVisible({ source: null, sourceConfidence: 'explicit' }), false)
  assert.equal(paperSourceIsLearnerVisible({ sourceConfidence: 'explicit' }), false)
})

test('a legacy paper carrying neither field is NOT visible', () => {
  assert.equal(paperSourceIsLearnerVisible({ title: 'Grade 7 Maths 2021' }), false)
  assert.equal(paperSourceIsLearnerVisible(null), false)
  assert.equal(paperSourceIsLearnerVisible('paper'), false)
})

test('an unrecognised confidence reads as unknown, not as a pass', () => {
  assert.equal(normalizeSourceConfidence('probably'), SOURCE_CONFIDENCE.UNKNOWN)
  assert.equal(normalizeSourceConfidence(null), SOURCE_CONFIDENCE.UNKNOWN)
  assert.equal(paperSourceIsLearnerVisible({ source: 'ecz', sourceConfidence: 'probably' }), false)
})

console.log('\npaperSources — ordering inside a subject')

test('official papers sort ahead of mocks', () => {
  const ecz = { source: 'ecz', paperNumber: 2 }
  const mock = { source: 'prisca', paperNumber: 1 }
  assert.ok(comparePapersBySource(ecz, mock) < 0)
  assert.ok(comparePapersBySource(mock, ecz) > 0)
})

test('within a class, papers sort by number', () => {
  const p1 = { source: 'ecz', paperNumber: 1 }
  const p2 = { source: 'ecz', paperNumber: 2 }
  assert.ok(comparePapersBySource(p1, p2) < 0)
})

test('word-numbered and unnumbered papers sort after the numbered ones', () => {
  const numbered = { source: 'ecz', paperNumber: 2 }
  const special = { source: 'ecz', paperNumber: 'special' }
  const none = { source: 'ecz', paperNumber: null }
  assert.ok(comparePapersBySource(numbered, special) < 0)
  assert.ok(comparePapersBySource(special, none) < 0)
})

test('a full sort puts the ECZ paper first — the old sort did not', () => {
  // The regression this replaced: `(a.paperNumber || 0) - (b.paperNumber || 0)`
  // put the numbered mock ahead of the unnumbered official paper.
  const rows = [
    { id: 'mock', source: 'prisca', paperNumber: 1 },
    { id: 'ecz', source: 'ecz', paperNumber: null },
  ]
  assert.deepEqual([...rows].sort(comparePapersBySource).map((r) => r.id), ['ecz', 'mock'])
})

test('the sort is deterministic for two papers in the same slot', () => {
  const a = { source: 'prisca', paperNumber: 1 }
  const b = { source: 'school_mock', paperNumber: 1 }
  assert.ok(comparePapersBySource(a, b) < 0)
  assert.ok(comparePapersBySource(b, a) > 0)
})

test('the schema version is a positive integer', () => {
  assert.ok(Number.isInteger(PAPER_META_VERSION) && PAPER_META_VERSION >= 1)
})

console.log(`\n${passed} assertions passed.\n`)
