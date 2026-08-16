#!/usr/bin/env node
/**
 * A lesson plan's term describes the LESSON'S date, not the day it was written.
 *
 * The bug: `tp.context` is resolved at read time for today, and the studio
 * handed that context straight to buildPlannedTeachingMeta while passing the
 * teacher's chosen date only as `plannedDate`. So a Term 2 lesson planned
 * during Term 1 was stamped Term 1 — and every consumer inherited it: the
 * library folder, the Record of Work's week join, plan inheritance, and the
 * dashboard's term filter. The object described two different dates at once.
 *
 * Pinned here rather than in the studio because the meta is built inside a
 * generate closure over studio state a unit test cannot assemble. What IS
 * testable is the contract the fix rests on — that resolveTeachingContext
 * answers for the date it is given — plus a source check that the studio
 * actually passes one.
 *
 * Run: npm run test:planned-term-source
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { resolveTeachingContext } from '../../../utils/calendarResolver.js'
import { buildPlannedTeachingMeta } from '../../../utils/plannedTeachingMeta.js'

const here = dirname(fileURLToPath(import.meta.url))
const studio = readFileSync(resolve(here, '../pages/LessonPlanStudio.jsx'), 'utf8')

/* ── The contract the fix rests on ───────────────────────────── */

test('the calendar answers for the date it is given', () => {
  // Three dates in three different terms of one academic year. If these ever
  // returned the same term, the fix would be silently inert.
  const terms = ['2026-02-10', '2026-06-10', '2026-10-10']
    .map((d) => resolveTeachingContext({ referenceDate: d }).termNumber)
  assert.deepEqual(terms, [1, 2, 3])
})

test('a plan carries the term of its own date, not of another', () => {
  const forDate = (plannedDate) => buildPlannedTeachingMeta({
    assignment: { id: 'a1', grade: '4', subject: 'mathematics' },
    context: resolveTeachingContext({ referenceDate: plannedDate }),
    plannedDate,
  })

  const t1 = forDate('2026-02-10')
  const t2 = forDate('2026-06-10')
  assert.equal(t1.termNumber, 1)
  assert.equal(t2.termNumber, 2)

  // The whole object moves together. Stamping the term from the lesson's date
  // while leaving the week on today's would describe a week that does not
  // exist in that term — which is what the Record of Work joins on.
  assert.notEqual(t1.termId, t2.termId)
  assert.equal(t1.plannedDate, '2026-02-10')
  for (const key of ['academicYear', 'termId', 'termNumber', 'schoolWeek', 'weekStartDate', 'weekEndDate']) {
    assert.ok(key in t1, `plannedMeta is missing ${key}`)
  }
})

test('an unresolvable date yields no term rather than a guessed one', () => {
  // Fail-closed: buildPlannedTeachingMeta reads term/week only when the context
  // is 'ok', so a date the calendar cannot place files as Unsorted. A guessed
  // term looks decided and is worse than no term at all.
  const context = resolveTeachingContext({ referenceDate: 'not-a-date' })
  assert.equal(context.status, 'invalid_date')
  const meta = buildPlannedTeachingMeta({ assignment: { id: 'a1' }, context, plannedDate: 'not-a-date' })
  assert.equal(meta.termNumber, null)
  assert.equal(meta.termId, '')
})

/* ── The studio actually passes a date ───────────────────────── */

test('the studio resolves the calendar for the planned date', () => {
  // Without a referenceDate the resolver defaults to today — the exact bug.
  // Checked at source because the call sits in a generate closure.
  assert.match(
    studio,
    /resolveTeachingContext\(\{[^}]*referenceDate:\s*plannedDate/,
    'LessonPlanStudio must resolve the teaching context for the lesson\'s planned date. '
    + 'Calling resolveTeachingContext with no referenceDate silently returns today\'s term.',
  )
})

test('the studio does not re-resolve an unusable context', () => {
  // A blank calendarId falls back to the NATIONAL calendar, so re-resolving a
  // non-ok context would turn "we don't know" into a confident answer from a
  // calendar the teacher never chose.
  assert.match(
    studio,
    /ac\.context\?\.status === 'ok'/,
    'the planned-date re-resolution must be guarded on the profile context being ok',
  )
})

test('the meta is built from the planned context, never the raw profile one', () => {
  const call = studio.slice(studio.indexOf('buildPlannedTeachingMeta({'))
  const block = call.slice(0, call.indexOf('})') + 2)
  assert.match(block, /context:\s*plannedContext/, 'buildPlannedTeachingMeta must receive plannedContext')
  assert.doesNotMatch(block, /context:\s*ac\.context/, 'passing ac.context re-introduces today-resolution')
})
