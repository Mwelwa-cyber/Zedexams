/**
 * Every SURFACE pattern in scripts/audit-hardcoded-colors.mjs must still match
 * a real file.
 *
 * WHY THIS EXISTS
 * ---------------
 * That map decides which themed container each hard-coded colour renders
 * inside, which is what decides how it gets fixed. Its patterns are PATHS, and
 * the file's own comment already names the failure mode: *"A regex naming a
 * path that no longer exists matches nothing and drops the surface out of the
 * audit silently."*
 *
 * Knowing about a hazard is not the same as being protected from it. On
 * 2026-08-14 two migrations moved `src/components/games/` and the quiz runtime,
 * and the `.force-light-theme` row — which named both by path — silently
 * stopped matching anything at all. The audit kept running, kept printing a
 * total, and reported an entire learner surface as `other`. Nothing went red;
 * the first migration had already merged before a review bot noticed on the
 * second. That is the fifth path-classified ledger in Phase 4 to break this
 * way, and the first with no guard behind it.
 *
 * So the rule is mechanical now: a pattern that matches zero files is a FAILURE
 * rather than a quiet zero. The fix when this fires is to repoint the pattern
 * at where the code moved — never to delete the row, which would drop the
 * surface for good.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK
 * -------------------------------------
 * That every file lands in the RIGHT surface. A pattern can match something and
 * still be wrong, and no cheap check can tell "these ten files are the games
 * hub" from "these ten files are anything else". This catches the failure that
 * is both silent and total; misclassification is at least visible in the
 * audit's own output.
 *
 * Plain-node test, auto-discovered by scripts/run-all-tests.mjs.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AUDIT = 'scripts/audit-hardcoded-colors.mjs'
const source = readFileSync(join(root, AUDIT), 'utf8')

/* ── 1. Pull the SURFACE rows out of the audit ────────────────────────── */

const block = source.match(/const SURFACE = \[([\s\S]*?)\n\]/)
assert.ok(
  block,
  `could not find the SURFACE array in ${AUDIT}. If it was renamed or ` +
  'restructured, teach this guard about the new shape rather than deleting it — ' +
  'the whole point is that a surface cannot fall out of the audit unnoticed.',
)

// Each row is `[/regex/, 'label'],`. The regex may contain escaped slashes, so
// match up to the last `/` before the comma rather than the first.
const rows = [...block[1].matchAll(/^\s*\[(\/.*\/)\s*,\s*'([^']+)'\s*\],\s*$/gm)]
  .map(([, re, label]) => ({ label, re: new RegExp(re.slice(1, -1)) }))

// EVERY row must parse, counted against the array itself rather than against a
// floor. A `rows.length >= N` bound is the bug it is meant to prevent wearing a
// number: delete a row, or write one in a shape the parser above does not
// recognise, and the guard keeps passing while that surface silently leaves its
// protection — which is exactly what the `dead` assertion below says must never
// happen. Rows are counted by their opening `[` at the start of a line, since
// that is the one token every row shape shares.
const declared = (block[1].match(/^\s*\[/gm) || []).length
assert.equal(
  rows.length, declared,
  `parsed ${rows.length} of ${declared} SURFACE rows in ${AUDIT}. A row this ` +
  'guard cannot see is a row it cannot protect, so a parse gap is a failure ' +
  'rather than a smaller sample. Either the row is written in a new shape — ' +
  'teach the parser about it — or it was deleted, which is what this whole ' +
  'file exists to stop.',
)

// The count above catches a row that is PRESENT but unparseable. It cannot
// catch a DELETION, and no count derived from the array can: delete a row and
// both `rows.length` and `declared` fall by one, in step, for ever. Only a list
// written down somewhere else notices that a surface is gone — so here it is.
//
// Adding a surface is a legitimate change and SHOULD edit this set; that is the
// ratchet working, not an obstacle. Removing a name from it is the thing to
// argue for out loud, because the label leaving this file is the same event as
// that surface's colours being reported as `other` from then on.
const EXPECTED_SURFACES = new Set([
  'learner: Games/Quizzes — BOTH .force-light-theme and .learner-game-theme',
  'learner: Games/Quizzes (.force-light-theme — remapped in #2027)',
  'teacher: dashboardV2 (.tdv2 — tokenised, has is-dark)',
  'teacher: .studio-theme',
  'admin',
  'learner: reading themes (body.theme-*)',
  'marketing (public, pinned light)',
  'shared chrome',
])
const found = new Set(rows.map((r) => r.label))
const missing = [...EXPECTED_SURFACES].filter((l) => !found.has(l))
const unexpected = [...found].filter((l) => !EXPECTED_SURFACES.has(l))
assert.deepEqual(
  { missing, unexpected }, { missing: [], unexpected: [] },
  `the SURFACE row set in ${AUDIT} no longer matches this guard's baseline.\n` +
  (missing.length ? `  GONE:  ${missing.join('\n         ')}\n` : '') +
  (unexpected.length ? `  NEW:   ${unexpected.join('\n         ')}\n` : '') +
  '\nA row that disappeared takes its whole surface out of the audit — repoint ' +
  'it rather than deleting it. A row that is genuinely new should be added to ' +
  'EXPECTED_SURFACES in the same commit.',
)

/* ── 2. Every pattern must match at least one file that exists ────────── */

const EXTS = ['.js', '.jsx', '.css']
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXTS.some((e) => entry.endsWith(e))) out.push(relative(root, full).split('\\').join('/'))
  }
  return out
}

// Mirrored from the audit, deliberately, so this guard is checked against the
// SAME inputs the audit reports on. The audit filters tests out, so a pattern
// kept alive only by a leftover colocated `*.test.js` is dead FOR THE AUDIT
// while looking live here — a migration that moves the implementation and
// leaves its test behind would slip straight through. Keep the two in step: if
// the audit's filter changes, change this one with it.
const isTest = (p) => /\.(test|spec)\.[jt]sx?$/.test(p) || /(^|\/)(test|__tests__)\//.test(p)
const files = walk(join(root, 'src')).filter((f) => !isTest(f))

const isDead = ({ re }) => !files.some((f) => re.test(f))

/**
 * The production check, as a FUNCTION so the negative control below can be run
 * through it rather than beside it.
 *
 * That shape is the point. A control that calls `isDead` directly only proves
 * the predicate works — gut this function, replace `dead` with `[]`, or drop
 * the throw, and a predicate-level probe stays green while nothing is being
 * checked at all. Routed through here, every one of those regressions fails.
 */
function assertNoDeadPatterns(rowSet) {
  const dead = rowSet.filter(isDead)
  if (dead.length) {
    throw new assert.AssertionError({
      message:
        'SURFACE pattern(s) in ' + AUDIT + ' match no file on disk:\n' +
        dead.map(({ label, re }) => `  ${re}  →  '${label}'`).join('\n') +
        '\n\nThe code they classify moved. REPOINT the pattern at its new path — do ' +
        'not delete the row, or that surface leaves the audit permanently and its ' +
        "hard-coded colours are reported as 'other'.",
    })
  }
}

assertNoDeadPatterns(rows)

/* ── 3. The guard must be able to fail ────────────────────────────────── */

// A guard whose failure path is never exercised is a guard nobody has seen
// work. This is the same reasoning test:paper-golden applies to its leak check.
//
// The probe goes through `assertNoDeadPatterns` — the SAME function the real
// check is made of, not the same predicate underneath it. That distinction was
// worth a review round: a control calling `isDead` directly proves only that
// the predicate is correct, so emptying `files`, replacing `dead` with `[]`, or
// deleting the throw all leave the advertised self-check green while the guard
// checks nothing. Running the probe through the production call site means
// every one of those regressions fails HERE, loudly, on the next CI run.
const probe = { label: 'negative control', re: /^src\/components\/thisDirectoryDoesNotExist\// }
assert.throws(
  () => assertNoDeadPatterns([probe]),
  /match no file on disk/,
  'the dead-pattern check no longer fails on a pattern matching zero files. ' +
  'The guard is not guarding — fix `assertNoDeadPatterns`/`files` rather than ' +
  'this probe.',
)
assert.doesNotThrow(
  () => assertNoDeadPatterns([rows[0]]),
  'the dead-pattern check fails on a LIVE pattern, so it would go red on every ' +
  'run and get deleted as noise. Both directions are checked because a guard ' +
  'that always fires is as useless as one that never does.',
)

console.log(
  `✓ colour-audit surface map — ${rows.length} patterns, all matching real files ` +
  `(${files.length} scanned)`,
)
