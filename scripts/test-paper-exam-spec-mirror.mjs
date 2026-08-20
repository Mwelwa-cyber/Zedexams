/**
 * The ECZ paper lengths exist in two places, and both are load-bearing:
 *
 *   • src/config/examTimetable2026.js — PSLE_2026, transcribed from the
 *     official timetable PDF and rendered on /timetable.
 *   • functions/shared/paperQuiz/examSpec.js — OFFICIAL_PAPER_MINUTES, the
 *     rung the past-paper quiz falls to when a paper has not had its own
 *     cover read yet.
 *
 * They are two copies because the second is imported by a Cloud Function,
 * which cannot reach `src/`. A copy is only safe if something fails when it
 * drifts: a length corrected on the timetable and forgotten here would leave
 * every learner sitting that subject's archive against the OLD clock, with
 * nothing anywhere reporting a disagreement.
 *
 * Both directions are checked. An entry here that the timetable does not have
 * is just as wrong — it would be a number nobody transcribed from anything.
 *
 * Run: node scripts/test-paper-exam-spec-mirror.mjs
 */

import assert from 'node:assert/strict'

import { PSLE_2026 } from '../src/config/examTimetable2026.js'
import { OFFICIAL_PAPER_MINUTES, officialDurationMinutes } from '../functions/shared/paperQuiz/examSpec.js'

let passed = 0
function ok(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗  ${name}\n     ${err.message}`)
    process.exitCode = 1
  }
}

console.log('past-paper exam-spec mirror')

// Every paper the official timetable names, with a past-paper subject id.
const fromTimetable = new Map()
for (const day of PSLE_2026.days) {
  for (const session of day.sessions) {
    for (const paper of session.papers || []) {
      if (!paper.paperSubjectId) continue
      fromTimetable.set(paper.paperSubjectId, paper.durationMinutes)
    }
  }
}

ok('the timetable actually yielded papers to compare against',
  () => assert.ok(fromTimetable.size >= 8, `only ${fromTimetable.size} papers found`))

const table = OFFICIAL_PAPER_MINUTES[PSLE_2026.grade]
ok(`the shared table holds grade ${PSLE_2026.grade}`, () => assert.ok(table))

for (const [subjectId, minutes] of fromTimetable) {
  ok(`${subjectId} runs ${minutes} min in both copies`, () => {
    assert.equal(
      officialDurationMinutes({ grade: PSLE_2026.grade, subject: subjectId }),
      minutes,
      `the ${PSLE_2026.year} timetable says ${minutes}, the shared table says ${table[subjectId]}`,
    )
  })
}

for (const subjectId of Object.keys(table)) {
  ok(`${subjectId} is a paper the official timetable actually lists`, () => {
    assert.ok(fromTimetable.has(subjectId), `${subjectId} appears in no session of PSLE_2026`)
  })
}

if (process.exitCode) {
  console.error('\n✗ exam-spec mirror FAILED — the two copies of the ECZ paper lengths disagree')
} else {
  console.log(`\n✓ exam-spec mirror — ${passed} checks`)
}
