/**
 * Tests for the pure half of flashcard mastery progress.
 *
 * These rules were previously reachable only through `saveFlashcardProgress`,
 * which opens a Firestore connection on import — so the status a mastery count
 * implies was covered only indirectly, through the hook's Vitest spec with the
 * whole repository mocked. Extracting them (Phase 2) is what makes them
 * testable under plain node; the logic is unchanged.
 *
 * Run: node src/features/flashcards/lib/flashcardProgressCore.test.js
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  FLASHCARD_PROGRESS_STATUS,
  deriveFlashcardStatus,
  flashcardProgressId,
} from './flashcardProgressCore.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

console.log('flashcard progress core')

// ── The document id ────────────────────────────────────────────────
// One document per user+deck. The id is a rule, not a formatting choice: the
// Firestore rules allow a learner to write their own progress only, and the
// id is how a second study session overwrites the first instead of adding one.
assert(flashcardProgressId('uid1', 'deck9') === 'uid1_deck9', 'id is {uid}_{deckId}')
assert(
  flashcardProgressId('uid1', 'deck9') !== flashcardProgressId('uid2', 'deck9'),
  'two learners studying one deck do not share a document',
)

// ── The status ladder ──────────────────────────────────────────────
assert(deriveFlashcardStatus(0, 10) === FLASHCARD_PROGRESS_STATUS.NOT_STARTED, 'no cards mastered reads as not-started')
assert(deriveFlashcardStatus(1, 10) === FLASHCARD_PROGRESS_STATUS.IN_PROGRESS, 'one card mastered reads as in-progress')
assert(deriveFlashcardStatus(9, 10) === FLASHCARD_PROGRESS_STATUS.IN_PROGRESS, 'one card short reads as in-progress')
assert(deriveFlashcardStatus(10, 10) === FLASHCARD_PROGRESS_STATUS.COMPLETED, 'every card mastered reads as completed')

// A deck that shrinks after the teacher regenerates it leaves the learner
// holding more mastered indices than the deck now has. That reads as finished,
// not as stuck one card short of a card that no longer exists — which is why
// the completed branch is `>=` and not `===`.
assert(deriveFlashcardStatus(12, 10) === FLASHCARD_PROGRESS_STATUS.COMPLETED, 'more mastered than the deck now holds still reads as completed')

// An empty deck has nothing to master. `0 === 0` takes the not-started branch
// before the completed one can fire, so an empty deck never claims completion.
assert(deriveFlashcardStatus(0, 0) === FLASHCARD_PROGRESS_STATUS.NOT_STARTED, 'an empty deck is not-started, never completed')

// ── The status vocabulary is mirrored in firestore.rules ───────────
// `validFlashcardProgressFields()` allows an explicit list of status strings,
// so a fourth status added here without the rule being updated would be
// written by the client and REJECTED by the server — at runtime, on a learner's
// device, not in CI. Read the allowlist out of the rules rather than restating
// it, so the two cannot drift.
// Scoped to this collection's validator: `incoming().status in [...]` appears
// for several collections, and the first match in the file belongs to another
// one — which is exactly what the first draft of this test asserted against.
const rulesSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'firestore.rules'), 'utf8')
const validator = rulesSource.match(/function validFlashcardProgressFields\(\)\s*\{([\s\S]*?)\n\s*\}/)
assert(Boolean(validator), 'firestore.rules still declares validFlashcardProgressFields()')
const statusRule = validator && validator[1].match(/incoming\(\)\.status in \[([^\]]+)\]/)
assert(Boolean(statusRule), 'validFlashcardProgressFields() still constrains status to a list')
if (statusRule) {
  const allowedByRules = statusRule[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort()
  const declaredHere = Object.values(FLASHCARD_PROGRESS_STATUS).slice().sort()
  assert(
    allowedByRules.join(',') === declaredHere.join(','),
    `the status vocabulary matches firestore.rules (rules: ${allowedByRules.join('|')})`,
  )
}

if (failures) {
  console.error(`\n${failures} flashcard progress core failure(s).`)
  process.exit(1)
}
console.log('\nok: flashcard progress core')
