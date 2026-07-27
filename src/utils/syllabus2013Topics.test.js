// Node test for the 2013 syllabus topic extractor, run against the real
// shipped data file so subject-map or shape drift fails loudly.
// Run: node src/utils/syllabus2013Topics.test.js

import assert from 'node:assert'
import fs from 'node:fs'
import {
  extract2013TopicLookup,
  detect2013TopicColumn,
  topicBelongsTo2013Grade,
  STUDIO_SUBJECT_TO_KB_2013,
} from './syllabus2013Topics.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('syllabus2013Topics')

const raw = JSON.parse(
  fs.readFileSync(new URL('../../public/syllabi/curriculum-data-2013.json', import.meta.url), 'utf8'),
)

// ── Subject map matches the shipped file ──────────────────────────────────
{
  const fileSubjects = new Set(Object.keys(raw))
  const unmapped = Object.keys(STUDIO_SUBJECT_TO_KB_2013)
    .filter((k) => !fileSubjects.has(k))
  assert.deepStrictEqual(unmapped, [],
    `subject map names missing from the data file: ${unmapped.join(', ')}`)
  ok('every mapped 2013 subject name exists in the data file', true)
}

// ── Grade-scope guard ─────────────────────────────────────────────────────
{
  ok('matching numbered topic stays in its grade',
    topicBelongsTo2013Grade('4.1.0 The human body', 'G4'))
  ok('next-grade numbered topic is rejected from the previous grade',
    !topicBelongsTo2013Grade('5.1.0 The human body', 'G4'))
  ok('unnumbered headings are retained rather than guessed',
    topicBelongsTo2013Grade('READING', 'G4'))
}

// ── Extraction produces grade-keyed topics ────────────────────────────────
{
  const lookup = extract2013TopicLookup(raw)
  ok(`lookup covers many grade|subject pairs (${lookup.size} ≥ 30)`, lookup.size >= 30)

  const g4eng = lookup.get('G4|english')
  assert.ok(g4eng && g4eng.size >= 3,
    `expected G4 english topics from the 2013 syllabus, got ${g4eng?.size ?? 0}`)
  ok(`G4 English has 2013 topics (${g4eng.size}) — the reported gap`, true)

  const g4topics = Array.from(g4eng.keys())
  assert.ok(g4topics.some((t) => /listening|speaking|reading|writing/i.test(t)),
    `G4 english topics look wrong: ${g4topics.slice(0, 3).join(' | ')}`)
  ok('G4 English topic names look like language strands', true)

  const g4science = lookup.get('G4|integrated_science')
  assert.ok(g4science && g4science.size > 0, 'expected G4 integrated science topics')
  const leakedG5 = Array.from(g4science.keys()).filter((t) => /^\s*5\s*\./.test(t))
  assert.deepStrictEqual(leakedG5, [],
    `Grade 5 topics leaked into Grade 4 Integrated Science: ${leakedG5.join(' | ')}`)
  ok('G4 Integrated Science excludes every 5.x topic', true)

  const g5science = lookup.get('G5|integrated_science')
  assert.ok(g5science && Array.from(g5science.keys()).some((t) => /^\s*5\s*\./.test(t)),
    'expected the real Grade 5 sheet to retain its 5.x topics')
  ok('G5 Integrated Science keeps its own 5.x topics', true)

  const g10maths = lookup.get('G10|mathematics')
  assert.ok(g10maths && g10maths.size >= 3, 'expected senior maths topics')
  ok('senior secondary (G10 mathematics) extracts too', true)
}

// ── Column detection ──────────────────────────────────────────────────────
{
  assert.strictEqual(
    detect2013TopicColumn({ columns: ['COLUMN 1', 'SPECIFIC OUTCOMES', 'KNOWLEDGE'] }),
    'COLUMN 1')
  assert.strictEqual(
    detect2013TopicColumn({ columns: ['TOPIC', 'KNOWLEDGE'] }),
    null, 'all-known columns yield null (rows then never match)')
  assert.strictEqual(detect2013TopicColumn({}), null)
  ok('topic-column detection mirrors the server rule', true)
}

console.log(`syllabus2013Topics: ${passed} checks passed`)
