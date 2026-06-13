/**
 * Tests for the pure history transitions behind useUndoRedo (paper-level
 * undo/redo in the Assessment Studio).
 *
 * Run: node src/hooks/useUndoRedo.test.js
 */

import { recordHistory, undoHistory, redoHistory } from './useUndoRedo.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

const empty = { past: [], present: 'A', future: [] }

console.log('recordHistory')
{
  const h = recordHistory(empty, 'B')
  assert(h.present === 'B', 'new snapshot becomes present')
  assert(h.past.length === 1 && h.past[0] === 'A', 'previous present pushed to past')
  assert(h.future.length === 0, 'future cleared on new edit')
}
{
  const h = recordHistory(empty, 'A')
  assert(h === empty, 'identical snapshot is a no-op (same reference)')
}
{
  // Deep equality via JSON, not reference.
  const base = { past: [], present: { a: 1 }, future: [] }
  assert(recordHistory(base, { a: 1 }) === base, 'structurally equal object is a no-op')
  assert(recordHistory(base, { a: 2 }) !== base, 'structurally different object records')
}
{
  // Respects the limit by dropping the oldest entries.
  let h = { past: [], present: 0, future: [] }
  for (let i = 1; i <= 5; i += 1) h = recordHistory(h, i, 3)
  assert(h.past.length === 3, 'past is capped at the limit')
  assert(h.past[0] === 2 && h.present === 5, 'oldest entries are evicted, newest kept')
}

console.log('\nundoHistory / redoHistory')
{
  let h = recordHistory(empty, 'B') // past:[A] present:B
  h = recordHistory(h, 'C')         // past:[A,B] present:C
  h = undoHistory(h)
  assert(h.present === 'B', 'undo steps back to previous present')
  assert(h.future[0] === 'C', 'undone present moves to future')
  h = undoHistory(h)
  assert(h.present === 'A', 'second undo reaches the start')
  assert(undoHistory(h) === h, 'undo past the start is a no-op')
  h = redoHistory(h)
  assert(h.present === 'B', 'redo steps forward again')
  h = redoHistory(h)
  assert(h.present === 'C', 'redo reaches the latest')
  assert(redoHistory(h) === h, 'redo past the end is a no-op')
}
{
  // A new edit after undo clears the redo branch.
  let h = recordHistory(empty, 'B')
  h = recordHistory(h, 'C')
  h = undoHistory(h)           // present B, future [C]
  h = recordHistory(h, 'D')    // new branch
  assert(h.present === 'D', 'edit after undo sets the new present')
  assert(h.future.length === 0, 'edit after undo discards the redo branch')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll useUndoRedo tests passed.')
