/**
 * The migration's decisions — the rules that will be applied once, to the live
 * archive, and that nobody gets to review afterwards.
 *
 * Two of these tests are the acceptance criteria stated verbatim:
 *   • running the migration twice produces zero writes on the second run
 *   • a document nothing matches is never assigned a plausible source
 *
 * Plain-node script — `npm run test:paper-source-migration`.
 */

import assert from 'node:assert/strict'
import {
  inferPaperNumber,
  inferSource,
  planPaperMigration,
  planPaperSourceMigration,
} from './paperSourceMigration.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

const base = { grade: '7', subject: 'science', year: 2025 }

console.log('\ninference — reading provenance out of the old free text')

test('ECZ is read from the title', () => {
  assert.equal(inferSource({ ...base, title: 'ECZ Grade 7 Science 2025' }), 'ecz')
  assert.equal(inferSource({ ...base, title: 'Examinations Council of Zambia 2025' }), 'ecz')
})

test('PRISCA is read from a filename when the title says nothing useful', () => {
  // The live case: a title that literally begins with the word "In".
  assert.equal(inferSource({ ...base, title: 'In 2025 Science', pdfFilename: 'PRISCA-SCI-2025.pdf' }), 'prisca')
})

test('a Storage path counts as evidence too', () => {
  assert.equal(inferSource({ ...base, pdfPath: 'papers/uid/ecz-2025/sci.pdf' }), 'ecz')
})

test('asset filenames and paths are searched, not just the top-level fields', () => {
  const paper = { ...base, assets: [{ filename: 'PRISCA mock science.jpg', path: 'papers/u/p/assets/0-x.jpg' }] }
  assert.equal(inferSource(paper), 'prisca')
})

test('a publisher outranks the word "mock" — order is declared, not incidental', () => {
  // "ECZ 2025 mock paper" is an ECZ paper of a mock SITTING, not a school mock.
  assert.equal(inferSource({ ...base, title: 'ECZ 2025 mock paper' }), 'ecz')
})

test('"mock" or "trial" alone means the generic school mock', () => {
  assert.equal(inferSource({ ...base, title: 'Grade 7 Science mock 2025' }), 'school_mock')
  assert.equal(inferSource({ ...base, title: 'Grade 7 Science trial 2025' }), 'school_mock')
})

test('word boundaries hold — "mockup" is not a mock', () => {
  assert.equal(inferSource({ ...base, title: 'Science mockup layout 2025' }), null)
})

test('NOTHING is guessed: no match is null, not "other"', () => {
  assert.equal(inferSource({ ...base, title: 'Grade 7 Science 2025' }), null)
  assert.equal(inferSource({ ...base, title: 'Longman Zambia Science Revision' }), null)
})

console.log('\ninference — paper numbers')

test('a stored number beats one read out of prose', () => {
  assert.equal(inferPaperNumber({ ...base, paperNumber: 2, title: 'Paper 1' }), 2)
})

test('"Paper 1" / "Paper 2" and "special" are read', () => {
  assert.equal(inferPaperNumber({ ...base, title: 'ECZ Science Paper 2 2025' }), 2)
  assert.equal(inferPaperNumber({ ...base, title: 'ECZ Special 2022' }), 'special')
})

test('"Special Paper 1" the SUBJECT does not become paper number 1', () => {
  // special-paper-1 is a real ECZ Grade 7 PSLE subject (verbal reasoning). The
  // digit belongs to the subject name, and reading it as a paper number would
  // file every one of them as "Special Paper 1 — Paper 1".
  assert.equal(inferPaperNumber({ ...base, subject: 'special-paper-1', title: 'Grade 7 Special Paper 1 2022' }), null)
})

console.log('\nplanning one document')

test('a matched paper is labelled, at INFERRED confidence — never explicit', () => {
  const plan = planPaperMigration({ id: 'p1', ...base, title: 'ECZ Science Paper 1 2025' })
  assert.equal(plan.action, 'label')
  assert.equal(plan.after.source, 'ecz')
  assert.equal(plan.after.isOfficial, true)
  assert.equal(plan.after.sourceConfidence, 'inferred')
  assert.equal(plan.after.paperMetaVersion, 1)
})

test('an unmatched paper is FLAGGED, with a null source and unknown confidence', () => {
  const plan = planPaperMigration({ id: 'p2', ...base, title: 'Grade 7 Science 2025' })
  assert.equal(plan.action, 'flag')
  assert.equal(plan.after.source, null)
  assert.equal(plan.after.isOfficial, false)
  assert.equal(plan.after.sourceConfidence, 'unknown')
  // Still stamped and still keyed, so the second run skips it.
  assert.equal(plan.after.paperMetaVersion, 1)
  assert.ok(plan.after.paperKey)
})

test('a flagged paper keeps its old title rather than being renamed to nothing', () => {
  const plan = planPaperMigration({ id: 'p2', ...base, title: 'Grade 7 Science 2025' })
  assert.equal(plan.after.title, undefined)
  assert.equal(plan.after.legacyTitle, 'Grade 7 Science 2025')
})

test('the prose the inference was read from is preserved', () => {
  // The only record of what a human once typed, and what an operator needs to
  // see when reviewing a label that turned out wrong.
  const plan = planPaperMigration({ id: 'p1', ...base, title: 'In 2025 Science', pdfFilename: 'PRISCA.pdf' })
  assert.equal(plan.after.legacyTitle, 'In 2025 Science')
  assert.notEqual(plan.after.title, 'In 2025 Science')
})

test('a paper with no grade/subject/year is skipped, not keyed onto "na"', () => {
  const plan = planPaperMigration({ id: 'p3', title: 'ECZ something' })
  assert.equal(plan.action, 'skip')
  assert.match(plan.reason, /nothing to key on/)
})

console.log('\nidempotency — the acceptance criterion')

test('a document already at paperMetaVersion >= 1 is skipped', () => {
  const plan = planPaperMigration({ id: 'p4', ...base, title: 'ECZ Science 2025', paperMetaVersion: 1 })
  assert.equal(plan.action, 'skip')
  assert.match(plan.reason, /already migrated/)
})

test('RUNNING IT TWICE PRODUCES ZERO WRITES ON THE SECOND RUN', () => {
  const papers = [
    { id: 'a', ...base, title: 'ECZ Science Paper 1 2025' },
    { id: 'b', ...base, year: 2024, title: 'Grade 7 Science 2024' },
    { id: 'c', grade: '12', subject: 'english', year: 2023, title: 'PRISCA English 2023' },
  ]
  const first = planPaperSourceMigration(papers)
  assert.equal(first.writes.length, 3)

  // Apply the plan the way the script does, then re-plan the same collection.
  const applied = papers.map((p) => {
    const w = first.writes.find((x) => x.id === p.id)
    return w ? { ...p, ...w.after } : p
  })
  const second = planPaperSourceMigration(applied)
  assert.equal(second.writes.length, 0, 'a second run would write again')
  assert.equal(second.summary.skipped, 3)
})

console.log('\ncollisions — reported, never written')

test('two documents deriving one key are BOTH held back', () => {
  const plan = planPaperSourceMigration([
    { id: 'dup1', ...base, title: 'ECZ Grade 7 Science Paper 1 2025' },
    { id: 'dup2', ...base, title: 'ECZ Science Paper 1 (2025)' },
  ])
  assert.equal(plan.writes.length, 0, 'one side of a duplicate was written anyway')
  assert.equal(plan.blocked.length, 2)
  assert.equal(plan.collisions.length, 1)
  assert.deepEqual(plan.collisions[0].ids.sort(), ['dup1', 'dup2'])
})

test('an ECZ paper and a mock of the same sitting are NOT a collision', () => {
  const plan = planPaperSourceMigration([
    { id: 'real', ...base, title: 'ECZ Grade 7 Science Paper 1 2025' },
    { id: 'mock', ...base, title: 'Grade 7 Science mock 2025' },
  ])
  assert.equal(plan.collisions.length, 0)
  assert.equal(plan.writes.length, 2)
})

test('a key already occupied by a migrated paper blocks a new one', () => {
  const existingKeys = new Map([['g7-2025-science-ecz-1', 'already-there']])
  const plan = planPaperSourceMigration(
    [{ id: 'newcomer', ...base, title: 'ECZ Science Paper 1 2025' }],
    { existingKeys },
  )
  assert.equal(plan.writes.length, 0)
  assert.equal(plan.blocked.length, 1)
})

test('a paper re-deriving its OWN key is not a collision with itself', () => {
  const existingKeys = new Map([['g7-2025-science-ecz-1', 'self']])
  const plan = planPaperSourceMigration(
    // Not yet at version 1, so it re-plans; the key it lands on is its own.
    [{ id: 'self', ...base, title: 'ECZ Science Paper 1 2025' }],
    { existingKeys },
  )
  assert.equal(plan.writes.length, 1)
  assert.equal(plan.collisions.length, 0)
})

console.log('\nsummary')

test('the summary counts every outcome', () => {
  const plan = planPaperSourceMigration([
    { id: 'a', ...base, title: 'ECZ Science Paper 1 2025' },
    { id: 'b', ...base, year: 2024, title: 'Grade 7 Science 2024' },
    { id: 'c', ...base, year: 2023, title: 'done', paperMetaVersion: 1 },
    { id: 'd', grade: '12', subject: 'english', year: 2021, title: 'ECZ English Paper 1 2021' },
    { id: 'e', grade: '12', subject: 'english', year: 2021, title: 'ECZ Paper 1 English 2021' },
  ])
  assert.deepEqual(plan.summary, {
    read: 5, labelled: 1, flagged: 1, blocked: 2, skipped: 1, collisions: 1,
  })
})

test('--limit caps what is read', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, ...base, year: 2000 + i, title: 'ECZ x' }))
  assert.equal(planPaperSourceMigration(rows, { limit: 3 }).summary.read, 3)
})

console.log(`\n${passed} assertions passed.\n`)
