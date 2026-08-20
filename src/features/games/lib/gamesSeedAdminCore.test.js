/**
 * gamesSeedAdminCore — the Games Seed Importer's rules, under plain `node`.
 *
 * The two that matter most are at the top. "Clear" used to mean "unselect"
 * on a screen with no destructive action; the moment permanent deletion
 * exists beside it, a button whose label reads as "clear the games" is a
 * catastrophe waiting for one tired click. And a selection mixing live
 * games with not-imported ones must not let either action silently act on
 * half of it — so the partition is a function with a test, not an `if`
 * inside a handler.
 *
 * Run: npm run test:games-seed-admin
 */
import assert from 'node:assert/strict'
import {
  DELETION_PLAN,
  STATUS,
  STATUS_LABEL,
  TYPE_TO_CONFIRM_THRESHOLD,
  buildRows,
  deleteConfirmCopy,
  describeSummary,
  filterRows,
  isFirestoreRow,
  isImportableRow,
  isRestorableRow,
  matchesSearch,
  needsTypedConfirmation,
  partitionSelection,
  resolveStatus,
  selectMissingIds,
  summariseResults,
  typedConfirmationAccepted,
} from './gamesSeedAdminCore.js'

const SEED = [
  { id: 'math_a_g4', title: 'Fraction Match', subject: 'mathematics', grade: 4, type: 'timed_quiz' },
  { id: 'eng_b_g4', title: 'Punctuation Pro', subject: 'english', grade: 4, type: 'punctuation' },
  { id: 'sci_c_g5', title: 'Digestive System Quest', subject: 'science', grade: 5, type: 'timed_quiz' },
]

/* ── statuses ──────────────────────────────────────────────────────── */

// The three real states. "Live in Firestore" used to be printed for a
// deactivated game too, which is the status lying about the one thing an
// admin came here to check.
assert.equal(resolveStatus({ inSeed: true, doc: { active: true }, existing: {} }), STATUS.LIVE)
assert.equal(resolveStatus({ inSeed: true, doc: { active: false }, existing: {} }), STATUS.INACTIVE)
assert.equal(resolveStatus({ inSeed: true, doc: null, existing: {} }), STATUS.NOT_IMPORTED)

// A doc with no `active` field is live — that is how `listGames` reads it
// (`active !== false`), and the importer must not disagree with the query
// learners are served by.
assert.equal(resolveStatus({ inSeed: true, doc: {}, existing: {} }), STATUS.LIVE)

// A FAILED or not-yet-finished read is not "Not imported". Reporting it as
// one would put 47 games one click away from being written over 47 live
// ones.
assert.equal(resolveStatus({ inSeed: true, doc: null, existing: null }), STATUS.UNKNOWN)
assert.equal(resolveStatus({ inSeed: true, doc: null, existing: undefined }), STATUS.UNKNOWN)

assert.equal(STATUS_LABEL[STATUS.LIVE], 'Live')
assert.equal(STATUS_LABEL[STATUS.INACTIVE], 'Inactive')
assert.equal(STATUS_LABEL[STATUS.NOT_IMPORTED], 'Not imported')

/* ── buildRows ─────────────────────────────────────────────────────── */

{
  const rows = buildRows({
    seed: SEED,
    existing: {
      math_a_g4: { title: 'Fraction Match', active: true, grade: 4, subject: 'mathematics', type: 'timed_quiz' },
      eng_b_g4: { title: 'Punctuation Pro', active: false, grade: 4, subject: 'english', type: 'punctuation' },
      // In Firestore, NOT in the seed — hand-written by an admin, or a seed
      // entry since removed from the bundle. The old screen listed the seed
      // and only the seed, so this game was invisible on the one page that
      // exists to manage games: it could not be deactivated or deleted.
      hand_made_g6: { title: 'Hand Made', active: true, grade: 6, subject: 'science', type: 'timed_quiz' },
    },
  })

  assert.equal(rows.length, 4, 'three seed entries plus the Firestore-only game')
  assert.deepEqual(rows.map((r) => r.status), [
    STATUS.LIVE, STATUS.INACTIVE, STATUS.NOT_IMPORTED, STATUS.LIVE,
  ])
  // Seed order is curated (grade bands, then grade) — it survives.
  assert.deepEqual(rows.slice(0, 3).map((r) => r.id), SEED.map((s) => s.id))

  const orphan = rows.find((r) => r.id === 'hand_made_g6')
  assert.equal(orphan.inSeed, false)
  assert.equal(orphan.seed, null, 'nothing to import it FROM — it exists only in Firestore')
  assert.equal(isImportableRow(orphan), false)
  assert.equal(isFirestoreRow(orphan), true, 'but it can still be deactivated and deleted')

  // A row carries its seed entry so the importer writes the CURATED
  // definition rather than something reconstructed from the row.
  assert.equal(rows[0].seed, SEED[0])
}

// A failed read produces rows that no action applies to, rather than rows
// that look importable.
{
  const rows = buildRows({ seed: SEED, existing: null })
  assert.equal(rows.length, 3)
  assert.ok(rows.every((r) => r.status === STATUS.UNKNOWN))
  assert.equal(selectMissingIds(rows).length, 0, 'nothing is importable while the live state is unknown')
  assert.equal(rows.filter(isFirestoreRow).length, 0, 'and nothing is deletable')
}

/* ── a DELETED game leaves the list ────────────────────────────────── */

{
  // The complaint this answers, in one test: an admin deleted a game and
  // still found it sitting in the list. It read "Not imported", which is
  // true of the seed entry and useless to the person who just deleted it.
  const rows = buildRows({
    seed: SEED,
    existing: { math_a_g4: { active: true } },
    deletedIds: new Set(['eng_b_g4']),
  })

  const deleted = rows.find((r) => r.id === 'eng_b_g4')
  assert.equal(deleted.status, STATUS.DELETED)
  assert.equal(STATUS_LABEL[STATUS.DELETED], 'Deleted')

  // Gone from every view except the Deleted one — including 'all', which
  // means "all the games you manage", not "everything that ever existed".
  for (const status of ['all', STATUS.LIVE, STATUS.INACTIVE, STATUS.NOT_IMPORTED]) {
    assert.ok(
      !filterRows(rows, { status }).some((r) => r.id === 'eng_b_g4'),
      `a deleted game must not appear under ${status}`,
    )
  }
  assert.deepEqual(
    filterRows(rows, { status: STATUS.DELETED }).map((r) => r.id),
    ['eng_b_g4'],
    'and it must be findable on the Deleted tab, or deleting would be a black hole',
  )

  // Still in the DATA. Hiding it from the list is a rendering decision;
  // dropping it from buildRows would make restoring it impossible.
  assert.equal(rows.length, SEED.length)

  // It is not importable — "Select missing" and "Import selected" must not
  // silently resurrect something an admin deleted on purpose.
  assert.equal(isImportableRow(deleted), false)
  assert.ok(!selectMissingIds(rows).includes('eng_b_g4'))
  // It is not deletable either: there is nothing left to delete.
  assert.equal(isFirestoreRow(deleted), false)
  // It IS restorable, deliberately and by a differently-named action.
  assert.equal(isRestorableRow(deleted), true)
  assert.equal(isRestorableRow(rows.find((r) => r.id === 'sci_c_g5')), false, 'never-imported is not "restore"')

  const p = partitionSelection({ rows, selectedIds: ['eng_b_g4', 'sci_c_g5'] })
  assert.deepEqual(p.restorable.map((r) => r.id), ['eng_b_g4'])
  assert.deepEqual(p.importable.map((r) => r.id), ['sci_c_g5'])
  assert.equal(p.unknown.length, 0, 'a deleted row is classified, not left unexplained')
}

// A LIVE document wins over a stale tombstone. Re-importing clears the
// tombstone in the same transaction, but if that read were ever stale the
// honest answer is what the games collection says right now — otherwise a
// restored game would keep reading Deleted while learners could play it.
{
  const rows = buildRows({
    seed: SEED,
    existing: { math_a_g4: { active: true }, eng_b_g4: { active: false } },
    deletedIds: new Set(['math_a_g4', 'eng_b_g4']),
  })
  assert.equal(rows.find((r) => r.id === 'math_a_g4').status, STATUS.LIVE)
  assert.equal(rows.find((r) => r.id === 'eng_b_g4').status, STATUS.INACTIVE)
}

// No tombstone list at all (an older page, or a failed read handled
// upstream) behaves exactly as before: nothing is deleted.
{
  const rows = buildRows({ seed: SEED, existing: {} })
  assert.ok(rows.every((r) => r.status === STATUS.NOT_IMPORTED))
  assert.equal(filterRows(rows, { status: 'all' }).length, SEED.length)
}

/* ── Select missing ────────────────────────────────────────────────── */

{
  const rows = buildRows({
    seed: SEED,
    existing: {
      math_a_g4: { active: true },
      eng_b_g4: { active: false },
    },
  })
  const missing = selectMissingIds(rows)
  assert.deepEqual(missing, ['sci_c_g5'], 'only the seed entry with no Firestore record')
  assert.ok(!missing.includes('math_a_g4'), 'never an already-live game')
  // An INACTIVE game is not "missing". Importing over it would silently
  // re-activate it — a decision an admin makes on purpose, never as a side
  // effect of a convenience button.
  assert.ok(!missing.includes('eng_b_g4'), 'never an inactive game')
}

/* ── filters + search ──────────────────────────────────────────────── */

{
  const rows = buildRows({ seed: SEED, existing: { math_a_g4: { active: true } } })

  assert.equal(filterRows(rows, {}).length, 3, 'no filter is not a filter')
  assert.deepEqual(filterRows(rows, { status: STATUS.LIVE }).map((r) => r.id), ['math_a_g4'])
  assert.deepEqual(filterRows(rows, { grade: 5 }).map((r) => r.id), ['sci_c_g5'])
  assert.deepEqual(filterRows(rows, { grade: '5' }).map((r) => r.id), ['sci_c_g5'], 'a select gives strings')
  assert.deepEqual(filterRows(rows, { subject: 'english' }).map((r) => r.id), ['eng_b_g4'])
  assert.deepEqual(filterRows(rows, { type: 'punctuation' }).map((r) => r.id), ['eng_b_g4'])

  // Search is the thing an admin reaches for to manage ONE game out of 47.
  assert.deepEqual(filterRows(rows, { search: 'punctuation pro' }).map((r) => r.id), ['eng_b_g4'])
  assert.deepEqual(filterRows(rows, { search: 'DIGESTIVE' }).map((r) => r.id), ['sci_c_g5'], 'case-insensitive')
  assert.deepEqual(filterRows(rows, { search: '  match ' }).map((r) => r.id), ['math_a_g4'], 'trimmed, substring')
  // The id is what appears in a URL, a log line and the Firestore console —
  // which is what an admin has in hand when they come here to delete one.
  assert.deepEqual(filterRows(rows, { search: 'sci_c' }).map((r) => r.id), ['sci_c_g5'])
  assert.equal(filterRows(rows, { search: 'nothing here' }).length, 0)

  // Filters are AND-ed.
  assert.equal(filterRows(rows, { grade: 4, subject: 'science' }).length, 0)

  assert.equal(matchesSearch({ title: 'A', id: 'b' }, ''), true, 'an empty box filters nothing')
  assert.equal(matchesSearch({ title: 'A', id: 'b' }, '   '), true)
}

/* ── partitionSelection: the mixed-selection rule ──────────────────── */

{
  const rows = buildRows({
    seed: SEED,
    existing: {
      math_a_g4: { active: true },
      eng_b_g4: { active: false },
    },
  })
  const p = partitionSelection({ rows, selectedIds: ['math_a_g4', 'eng_b_g4', 'sci_c_g5'] })

  assert.equal(p.total, 3)
  assert.deepEqual(p.importable.map((r) => r.id), ['sci_c_g5'])
  // An INACTIVE game is deletable. "Deactivated" is not a lesser state that
  // has to be walked back before it can be removed.
  assert.deepEqual(p.deletable.map((r) => r.id), ['math_a_g4', 'eng_b_g4'])
  assert.equal(p.mixed, true, 'the screen must SAY the selection is mixed')
  assert.equal(p.unknown.length, 0)

  // Every selected id lands in exactly one bucket — this is what stops an
  // action silently ignoring half a selection.
  assert.equal(p.importable.length + p.deletable.length + p.unknown.length, p.total)
}

// A selection that is entirely one kind is not "mixed".
{
  const rows = buildRows({ seed: SEED, existing: {} })
  const p = partitionSelection({ rows, selectedIds: ['math_a_g4', 'eng_b_g4'] })
  assert.equal(p.mixed, false)
  assert.equal(p.deletable.length, 0)
  assert.equal(p.importable.length, 2)
}

// A selected id that is no longer a row (deleted in another tab, then
// refreshed) is neither importable nor deletable — and is reported.
{
  const rows = buildRows({ seed: SEED, existing: {} })
  const p = partitionSelection({ rows, selectedIds: ['ghost_game'] })
  assert.deepEqual(p.unknown, ['ghost_game'])
  assert.equal(p.importable.length + p.deletable.length, 0)
}

// Selection SURVIVES filtering — and the rows it can no longer see are
// counted, because an admin about to delete 12 games while looking at 1
// row is entitled to be told.
{
  const rows = buildRows({ seed: SEED, existing: { math_a_g4: { active: true } } })
  const visible = filterRows(rows, { grade: 5 })
  const p = partitionSelection({ rows, visibleRows: visible, selectedIds: ['math_a_g4', 'sci_c_g5'] })
  assert.deepEqual(p.hidden.map((r) => r.id), ['math_a_g4'])
  assert.equal(p.deletable.length, 1, 'a hidden selection is still acted on — so it is named')
}

/* ── confirmation ──────────────────────────────────────────────────── */

{
  const one = deleteConfirmCopy([{ id: 'a', title: 'Fraction Match' }])
  assert.equal(one.title, 'Delete 1 game permanently?')
  assert.match(one.body, /cannot be undone/)

  const three = deleteConfirmCopy([
    { id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' },
  ])
  // The count in the heading is the count of rows handed in. A dialog that
  // says "3 games" while deleting 12 is worse than no dialog.
  assert.equal(three.title, 'Delete 3 games permanently?')
  assert.match(three.body, /These 3 games/)
  assert.deepEqual(three.names, ['A', 'B', 'C'])
  assert.equal(three.more, 0)

  const many = deleteConfirmCopy(Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, title: `G${i}` })))
  assert.equal(many.names.length, 4)
  assert.equal(many.more, 5, 'a long list is summarised, never truncated silently')
  assert.match(many.note, /Learner scores/, 'the dialog states what is NOT deleted')
}

// Type-to-confirm is for the shape of a mistake — a stale Select all, a
// forgotten filter — not for a routine one-game tidy-up.
assert.equal(needsTypedConfirmation(1), false)
assert.equal(needsTypedConfirmation(TYPE_TO_CONFIRM_THRESHOLD - 1), false)
assert.equal(needsTypedConfirmation(TYPE_TO_CONFIRM_THRESHOLD), true)
assert.equal(needsTypedConfirmation(47), true)

assert.equal(typedConfirmationAccepted('DELETE'), true)
assert.equal(typedConfirmationAccepted(' delete '), true, 'case and padding are not the test')
assert.equal(typedConfirmationAccepted('DELET'), false)
assert.equal(typedConfirmationAccepted(''), false)
assert.equal(typedConfirmationAccepted(null), false)

/* ── results ───────────────────────────────────────────────────────── */

{
  // "Nothing happened" has two meanings and they are not the same: skipped
  // is a no-op that is fine, failed is a refused write that is not.
  // Collapsing them is how a permission error reads as success.
  const s = summariseResults([
    { outcome: 'ok' }, { outcome: 'ok' }, { outcome: 'skipped' }, { outcome: 'failed' },
  ])
  assert.deepEqual(s, { ok: 2, skipped: 1, failed: 1, total: 4 })

  assert.deepEqual(describeSummary('import', s), ['2 imported', '1 already existed', '1 failed'])
  assert.deepEqual(describeSummary('delete', s), ['2 deleted', '1 already missing', '1 failed'])

  // An unrecognised outcome counts as a failure. Silence is not success.
  assert.deepEqual(
    summariseResults([{}, { outcome: 'weird' }, null]),
    { ok: 0, skipped: 0, failed: 3, total: 3 },
  )
  assert.deepEqual(summariseResults([]), { ok: 0, skipped: 0, failed: 0, total: 0 })
}

/* ── the deletion plan ─────────────────────────────────────────────── */

{
  const removed = DELETION_PLAN.removes.map((r) => r.path)
  assert.deepEqual(removed, ['games/{gameId}', 'leaderboards/{gameId}'])
  assert.deepEqual(DELETION_PLAN.writes.map((r) => r.path), ['gameTombstones/{gameId}'])

  const preserved = DELETION_PLAN.preserves.map((r) => r.path)
  // The load-bearing line of this whole change. A `scores` row is a
  // learner's own result AND a public leaderboard row; deleting a game is
  // an editorial decision about the catalogue, not a statement that a child
  // did not play. Cascading into these would rewrite every leaderboard,
  // every XP total (the hub sums the last 40 rows) and every personal best,
  // irreversibly.
  for (const path of ['scores/*', 'badges/{uid}', 'learner_profiles/{uid}', 'matches/*']) {
    assert.ok(preserved.includes(path), `${path} must be preserved`)
    assert.ok(!removed.includes(path), `${path} must never be cascade-deleted`)
  }
  // Every entry says WHY, so the plan reads as decisions rather than as a
  // list of paths someone happened to think of.
  for (const entry of [...DELETION_PLAN.removes, ...DELETION_PLAN.writes, ...DELETION_PLAN.preserves]) {
    assert.ok(entry.why && entry.why.length > 20, `${entry.path} needs a reason`)
  }
}

console.log('  ok  gamesSeedAdminCore')
